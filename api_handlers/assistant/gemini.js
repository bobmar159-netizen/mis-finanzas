'use strict';

// Pasarela acotada para las utilidades históricas del frontend. El navegador
// nunca conoce la clave maestra: sólo envía una solicitud limitada después de
// validar su sesión Supabase. No registra prompts, respuestas ni cabeceras.
const { validateServerRouteConfig } = require('../../lib/yarbi-runtime-config');
const { authenticatedOwnerIdentity } = require('../../lib/yarbi-owner-ui-auth');
const fileSearch = require('../../lib/yarbi-gemini-file-search');

const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GEMINI_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || process.env.GEMINI_CHAT_MODEL || 'gemini-3.5-flash-lite';
const GEMINI_EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';
const MAX_TEXT = 16000;
const MAX_INLINE_BYTES = 3 * 1024 * 1024;
const MAX_EMBED_INPUTS = 24;
const MAX_EMBED_TEXT = 4000;
const MAX_EMBED_TOTAL_TEXT = 64000;
const EMBEDDING_DIMENSIONS = 768;
const KNOWLEDGE_BACKUP_ENABLED = String(process.env.YARBI_KNOWLEDGE_BACKUP_ENABLED || '').trim().toLowerCase() === 'true';
const KNOWLEDGE_FILE_SEARCH_ENABLED = String(process.env.YARBI_GEMINI_FILE_SEARCH_ENABLED || '').trim().toLowerCase() === 'true';
const GEMINI_FILE_SEARCH_MODEL = String(process.env.GEMINI_FILE_SEARCH_MODEL || GEMINI_MODEL).trim();
const MAX_KNOWLEDGE_SECTIONS = 8000;
const MAX_KNOWLEDGE_BATCH = 40;
const MAX_KNOWLEDGE_BATCH_CHARS = 120000;
const GEMINI_TIMEOUT_MS = Math.max(3000, Math.min(25000, Number(process.env.GEMINI_REQUEST_TIMEOUT_MS) || 17000));

function cors(res) {
  if (process.env.APP_ORIGIN) res.setHeader('Access-Control-Allow-Origin', process.env.APP_ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
}
function bodyOf(req) {
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  return req.body && typeof req.body === 'object' ? req.body : {};
}
function text(value, limit = MAX_TEXT) { return String(value || '').slice(0, limit); }
function sanitizePart(part) {
  if (!part || typeof part !== 'object') return null;
  if (typeof part.text === 'string') return { text: text(part.text) };
  const data = part.inline_data || part.inlineData;
  if (!data || typeof data !== 'object') return null;
  const mimeType = text(data.mime_type || data.mimeType, 120);
  const encoded = text(data.data, Math.ceil(MAX_INLINE_BYTES * 4 / 3));
  if (!/^(?:image\/(jpeg|png|webp)|audio\/(mpeg|mp4|wav|ogg|aac|webm)|video\/(mp4|webm|quicktime)|application\/pdf)$/i.test(mimeType) || !encoded || Buffer.byteLength(encoded, 'base64') > MAX_INLINE_BYTES) return null;
  return { inline_data: { mime_type: mimeType, data: encoded } };
}
function sanitizeContents(value) {
  const source = Array.isArray(value) ? value.slice(-20) : [];
  const contents = source.map(item => {
    const role = item?.role === 'model' ? 'model' : 'user';
    const parts = (Array.isArray(item?.parts) ? item.parts : []).map(sanitizePart).filter(Boolean).slice(0, 12);
    return parts.length ? { role, parts } : null;
  }).filter(Boolean);
  return contents.length ? contents : null;
}
function generationConfig(value) {
  const source = value && typeof value === 'object' ? value : {};
  const result = {};
  const temperature = Number(source.temperature);
  const maxOutputTokens = Number(source.maxOutputTokens);
  if (Number.isFinite(temperature)) result.temperature = Math.max(0, Math.min(1, temperature));
  if (Number.isFinite(maxOutputTokens)) result.maxOutputTokens = Math.max(1, Math.min(2048, Math.floor(maxOutputTokens)));
  if (source.responseMimeType === 'application/json') result.responseMimeType = 'application/json';
  return result;
}
function sanitizeEmbeddingRequest(input) {
  if (input?.operation !== 'embed') return null;
  const taskType = ['RETRIEVAL_DOCUMENT', 'RETRIEVAL_QUERY', 'QUESTION_ANSWERING', 'FACT_VERIFICATION'].includes(String(input.taskType || ''))
    ? String(input.taskType)
    : 'RETRIEVAL_QUERY';
  const texts = (Array.isArray(input.texts) ? input.texts : [])
    .slice(0, MAX_EMBED_INPUTS)
    .map(value => text(value, MAX_EMBED_TEXT).trim())
    .filter(Boolean);
  if (!texts.length || texts.reduce((sum, value) => sum + value.length, 0) > MAX_EMBED_TOTAL_TEXT) return null;
  return {
    taskType,
    texts,
    title: taskType === 'RETRIEVAL_DOCUMENT' ? text(input.title, 240).trim() : '',
    outputDimensionality: EMBEDDING_DIMENSIONS
  };
}
async function fetchWithTimeout(url, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function validKnowledgeSha(value) { return /^[a-f0-9]{64}$/i.test(String(value || '')); }
function boundedText(value, limit) { return String(value == null ? '' : value).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, limit); }
function knowledgePath(ownerId, sha, suffix = '') {
  return 'yarbi_knowledge_assets?owner_account_id=eq.' + encodeURIComponent(ownerId)
    + '&source_sha256=eq.' + encodeURIComponent(sha) + suffix;
}
function knowledgeCoverageComplete(count, firstIndex, lastIndex, expected) {
  const total = Number(expected);
  return Number(count) === total && Number(firstIndex) === 0 && Number(lastIndex) === total - 1;
}
async function knowledgeStoreRequest(config, path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(config.supabaseUrl + '/rest/v1/' + path, {
      method:options.method || 'GET',
      headers:{
        apikey:config.supabaseKey,
        Authorization:'Bearer ' + config.supabaseKey,
        ...(options.body ? { 'Content-Type':'application/json' } : {}),
        ...(options.prefer ? { Prefer:options.prefer } : {}),
        ...(options.range ? { Range:options.range } : {})
      },
      ...(options.body ? { body:JSON.stringify(options.body) } : {}),
      signal:controller.signal
    });
    if (!response.ok) throw new Error('knowledge_store_failed');
    if (options.countOnly) {
      const match = String(response.headers.get('content-range') || '').match(/\/(\d+)$/);
      if (!match) throw new Error('knowledge_store_count_unavailable');
      return Number(match[1]);
    }
    if (response.status === 204) return null;
    return response.json().catch(() => null);
  } finally {
    clearTimeout(timeout);
  }
}
function fileSearchAssetPath(ownerId, sha, suffix = '') {
  return 'yarbi_knowledge_file_search_stores?owner_account_id=eq.' + encodeURIComponent(ownerId)
    + '&source_sha256=eq.' + encodeURIComponent(sha) + suffix;
}
async function fileSearchDocumentExists(storeName, sha) {
  if (!fileSearch.validStoreName(storeName) || !fileSearch.validSha(sha)) return false;
  const listed = await fileSearchProviderRequest('v1beta/' + storeName + '/documents?pageSize=100');
  if (!listed.response.ok) throw new Error('knowledge_file_search_document_check_failed');
  const documents = Array.isArray(listed.data?.documents) ? listed.data.documents
    : Array.isArray(listed.data?.fileSearchDocuments) ? listed.data.fileSearchDocuments : [];
  return documents.some(document => fileSearch.documentHasSourceSha(document, sha));
}
async function createFileSearchStore(sha) {
  const created = await fileSearchProviderRequest('v1beta/fileSearchStores', { method:'POST', body:{
    display_name:'Yarbi · ' + sha.slice(0, 16), embedding_model:'models/gemini-embedding-2'
  } });
  if (!created.response.ok || !fileSearch.validStoreName(created.data?.name)) throw new Error('knowledge_file_search_store_create_failed');
  return created.data.name;
}
async function startFileSearchUpload(config, ownerId, descriptor, storeName) {
  await knowledgeStoreRequest(config, fileSearchAssetPath(ownerId, descriptor.sha256), { method:'PATCH', prefer:'return=minimal', body:{
    title:descriptor.title, source_bytes:descriptor.bytes, index_state:'uploading', updated_at:new Date().toISOString()
  } });
  const uploadPath = 'upload/v1beta/' + storeName + ':uploadToFileSearchStore';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let uploadResponse;
  try {
    uploadResponse = await fetch('https://generativelanguage.googleapis.com/' + uploadPath, {
      method:'POST', signal:controller.signal,
      headers:{
        'x-goog-api-key':GEMINI_KEY,
        'X-Goog-Upload-Protocol':'resumable', 'X-Goog-Upload-Command':'start',
        'X-Goog-Upload-Header-Content-Length':String(descriptor.bytes),
        'X-Goog-Upload-Header-Content-Type':descriptor.mimeType, 'Content-Type':'application/json'
      },
      body:JSON.stringify({
        displayName:'[[YARBI_SOURCE_' + descriptor.sha256.slice(0, 20) + ']] ' + descriptor.title,
        customMetadata:[{ key:'source_sha256', stringValue:descriptor.sha256 }]
      })
    });
  } finally { clearTimeout(timeout); }
  const uploadUrl = String(uploadResponse.headers.get('x-goog-upload-url') || '');
  if (!uploadResponse.ok || !fileSearch.validResumableUploadUrl(uploadUrl)) {
    await knowledgeStoreRequest(config, fileSearchAssetPath(ownerId, descriptor.sha256), { method:'PATCH', prefer:'return=minimal', body:{ index_state:'failed', updated_at:new Date().toISOString() } });
    throw new Error('knowledge_file_search_upload_session_failed');
  }
  return { status:200, body:{ ok:true, status:'uploading', source_sha256:descriptor.sha256, upload_url:uploadUrl } };
}
async function fileSearchProviderRequest(path, options = {}) {
  if (!GEMINI_KEY) throw new Error('file_search_not_configured');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(GEMINI_TIMEOUT_MS, 18000));
  try {
    const headers = { 'Content-Type':'application/json', 'x-goog-api-key':GEMINI_KEY, ...(options.headers || {}) };
    const response = await fetch('https://generativelanguage.googleapis.com/' + path, {
      method:options.method || 'GET', headers,
      ...(options.body !== undefined ? { body:JSON.stringify(options.body) } : {}), signal:controller.signal
    });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  } finally { clearTimeout(timeout); }
}
async function fileSearchUploadSession(config, ownerId, input, retry = 0) {
  const descriptor = fileSearch.validateFileSearchDescriptor(input);
  if (!descriptor) return { status:400, body:{ error:'knowledge_file_search_source_invalid' } };
  const approvedRows = await knowledgeStoreRequest(config, knowledgePath(ownerId, descriptor.sha256,
    '&select=source_bytes,source_kind,mime_type,approval_state,learning_enabled,backup_complete&limit=1'));
  const approved = Array.isArray(approvedRows) && approvedRows.length === 1 ? approvedRows[0] : null;
  if (!approved || approved.source_kind !== descriptor.kind || String(approved.mime_type || '').toLowerCase() !== descriptor.mimeType
    || approved.approval_state !== 'approved' || approved.learning_enabled !== true
    || approved.backup_complete !== true || Number(approved.source_bytes) !== descriptor.bytes) {
    return { status:409, body:{ error:'knowledge_file_search_source_not_approved' } };
  }
  const mappingPath = fileSearchAssetPath(ownerId, descriptor.sha256, '&select=store_name,index_state,active,updated_at');
  let rows = await knowledgeStoreRequest(config, mappingPath);
  let mapping = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
  if (mapping && !fileSearch.validStoreName(mapping.store_name)) throw new Error('knowledge_file_search_mapping_invalid');
  if (mapping?.index_state === 'ready') {
    return { status:200, body:{ ok:true, status:'ready', active:mapping.active === true, already_indexed:true, source_sha256:descriptor.sha256 } };
  }
  if (mapping && await fileSearchDocumentExists(mapping.store_name, descriptor.sha256)) {
    await knowledgeStoreRequest(config, fileSearchAssetPath(ownerId, descriptor.sha256), { method:'PATCH', prefer:'return=minimal', body:{ index_state:'ready', updated_at:new Date().toISOString() } });
    return { status:200, body:{ ok:true, status:'ready', active:mapping.active === true, already_indexed:true, source_sha256:descriptor.sha256 } };
  }
  if (mapping && mapping.index_state === 'uploading') {
    const updatedAt = Date.parse(mapping.updated_at || '');
    const stale = !Number.isFinite(updatedAt) || Date.now() - updatedAt >= 15 * 60 * 1000;
    if (!stale) return { status:200, body:{ ok:true, status:'uploading', pending:true, source_sha256:descriptor.sha256 } };
  }
  let storeName = mapping?.store_name || '';
  let previousStoreName = '';
  if (!mapping) {
    const candidate = await createFileSearchStore(descriptor.sha256);
    const inserted = await knowledgeStoreRequest(config, 'yarbi_knowledge_file_search_stores?on_conflict=owner_account_id,source_sha256', {
      method:'POST', prefer:'resolution=ignore-duplicates,return=representation', body:[{
        owner_account_id:ownerId, source_sha256:descriptor.sha256, title:descriptor.title, source_bytes:descriptor.bytes,
        store_name:candidate, index_state:'uploading', active:true, updated_at:new Date().toISOString()
      }]
    });
    if (Array.isArray(inserted) && inserted.length === 1) storeName = candidate;
    else {
      await fileSearchProviderRequest('v1beta/' + candidate + '?force=true', { method:'DELETE' }).catch(() => {});
      if (retry < 1) return fileSearchUploadSession(config, ownerId, input, retry + 1);
      throw new Error('knowledge_file_search_mapping_conflict');
    }
  } else {
    previousStoreName = mapping.store_name;
    const candidate = await createFileSearchStore(descriptor.sha256);
    const compareUpdatedAt = mapping.updated_at ? '&updated_at=eq.' + encodeURIComponent(mapping.updated_at) : '';
    const replaced = await knowledgeStoreRequest(config,
      fileSearchAssetPath(ownerId, descriptor.sha256, '&store_name=eq.' + encodeURIComponent(mapping.store_name) + compareUpdatedAt + '&select=store_name'),
      { method:'PATCH', prefer:'return=representation', body:{ store_name:candidate, title:descriptor.title, source_bytes:descriptor.bytes, index_state:'uploading', updated_at:new Date().toISOString() } });
    if (!Array.isArray(replaced) || replaced.length !== 1) {
      await fileSearchProviderRequest('v1beta/' + candidate + '?force=true', { method:'DELETE' }).catch(() => {});
      if (retry < 1) return fileSearchUploadSession(config, ownerId, input, retry + 1);
      throw new Error('knowledge_file_search_mapping_conflict');
    }
    storeName = candidate;
  }
  if (previousStoreName) await fileSearchProviderRequest('v1beta/' + previousStoreName + '?force=true', { method:'DELETE' }).catch(() => {});
  return startFileSearchUpload(config, ownerId, descriptor, storeName);
}
async function handleFileSearchOperation(req, res, config, identity, input) {
  const cleanupOperation = ['knowledge_file_search_upload_complete','knowledge_file_search_upload_failed','knowledge_file_search_status','knowledge_file_search_set_learning','knowledge_file_search_delete'].includes(input.operation);
  if (!KNOWLEDGE_FILE_SEARCH_ENABLED && !cleanupOperation) return res.status(503).json({ error:'knowledge_file_search_disabled' });
  if (input.operation !== 'knowledge_file_search_status' && !GEMINI_KEY) return res.status(503).json({ error:'knowledge_file_search_not_configured' });
  if (['knowledge_file_search_upload_start','knowledge_file_search_query'].includes(input.operation) && !fileSearch.supportedModel(GEMINI_FILE_SEARCH_MODEL)) return res.status(503).json({ error:'knowledge_file_search_model_unsupported' });
  const ownerId = identity.user.id;
  if (input.operation === 'knowledge_file_search_upload_start') {
    const result = await fileSearchUploadSession(config, ownerId, input);
    return res.status(result.status).json(result.body);
  }
  if (input.operation === 'knowledge_file_search_upload_complete') {
    const sha = String(input.sha256 || '').toLowerCase();
    const operationName = String(input.operation_name || '');
    const validOperationName = /^(?:operations\/[A-Za-z0-9._-]{1,180}|fileSearchStores\/[A-Za-z0-9_-]{1,160}\/(?:operations|upload\/operations)\/[A-Za-z0-9._-]{1,180})$/.test(operationName);
    if (!fileSearch.validSha(sha) || !validOperationName) return res.status(400).json({ error:'knowledge_file_search_operation_invalid' });
    const rows = await knowledgeStoreRequest(config, fileSearchAssetPath(ownerId, sha, '&select=store_name,index_state,active'));
    const mapping = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    if (!mapping || !fileSearch.validStoreName(mapping.store_name)) return res.status(404).json({ error:'knowledge_file_search_source_not_found' });
    const operationStore = operationName.match(/^fileSearchStores\/([A-Za-z0-9_-]{1,160})\//)?.[1] || '';
    if (operationStore && operationStore !== mapping.store_name.slice('fileSearchStores/'.length)) return res.status(404).json({ error:'knowledge_file_search_operation_not_found' });
    const operation = await fileSearchProviderRequest('v1beta/' + operationName);
    if (!operation.response.ok) throw new Error('knowledge_file_search_operation_check_failed');
    if (operation.data?.error) {
      await knowledgeStoreRequest(config, fileSearchAssetPath(ownerId, sha), { method:'PATCH', prefer:'return=minimal', body:{ index_state:'failed', updated_at:new Date().toISOString() } });
      return res.status(200).json({ ok:true, status:'failed', source_sha256:sha });
    }
    const done = operation.data?.done === true;
    const indexed = done ? await fileSearchDocumentExists(mapping.store_name, sha) : false;
    if (indexed) await knowledgeStoreRequest(config, fileSearchAssetPath(ownerId, sha), { method:'PATCH', prefer:'return=minimal', body:{ index_state:'ready', updated_at:new Date().toISOString() } });
    return res.status(200).json({ ok:true, status:indexed ? 'ready' : 'uploading', source_sha256:sha });
  }
  if (input.operation === 'knowledge_file_search_upload_failed') {
    const sha = String(input.sha256 || '').toLowerCase();
    if (!fileSearch.validSha(sha)) return res.status(400).json({ error:'knowledge_file_search_request_invalid' });
    const rows = await knowledgeStoreRequest(config, fileSearchAssetPath(ownerId, sha, '&select=store_name'));
    const mapping = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    if (!mapping || !fileSearch.validStoreName(mapping.store_name)) return res.status(404).json({ error:'knowledge_file_search_source_not_found' });
    const indexed = await fileSearchDocumentExists(mapping.store_name, sha);
    const status = indexed ? 'ready' : 'failed';
    await knowledgeStoreRequest(config, fileSearchAssetPath(ownerId, sha), { method:'PATCH', prefer:'return=minimal', body:{ index_state:status, updated_at:new Date().toISOString() } });
    return res.status(200).json({ ok:true, status, source_sha256:sha });
  }
  if (input.operation === 'knowledge_file_search_status') {
    const requestedSha = String(input.sha256 || '').toLowerCase();
    if (requestedSha && !fileSearch.validSha(requestedSha)) return res.status(400).json({ error:'knowledge_file_search_request_invalid' });
    if (requestedSha) {
      const rows = await knowledgeStoreRequest(config, fileSearchAssetPath(ownerId, requestedSha, '&select=source_sha256,title,source_bytes,index_state,active,updated_at,store_name'));
      const source = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
      if (!source) return res.status(404).json({ error:'knowledge_file_search_source_not_found' });
      if (source.index_state === 'uploading' && GEMINI_KEY && await fileSearchDocumentExists(source.store_name, requestedSha)) {
        await knowledgeStoreRequest(config, fileSearchAssetPath(ownerId, requestedSha), { method:'PATCH', prefer:'return=minimal', body:{ index_state:'ready', updated_at:new Date().toISOString() } });
        source.index_state = 'ready';
      }
      delete source.store_name;
      return res.status(200).json({ ok:true, source });
    }
    const rows = await knowledgeStoreRequest(config, 'yarbi_knowledge_file_search_stores?owner_account_id=eq.' + encodeURIComponent(ownerId)
      + '&select=source_sha256,title,source_bytes,index_state,active,updated_at&order=updated_at.desc&limit=100');
    return res.status(200).json({ ok:true, sources:Array.isArray(rows) ? rows : [] });
  }
  if (input.operation === 'knowledge_file_search_set_learning') {
    const sha = String(input.sha256 || '').toLowerCase();
    if (!fileSearch.validSha(sha) || typeof input.learning_enabled !== 'boolean') return res.status(400).json({ error:'knowledge_file_search_request_invalid' });
    const result = await knowledgeStoreRequest(config, fileSearchAssetPath(ownerId, sha), { method:'PATCH', prefer:'return=representation', body:{ active:input.learning_enabled, updated_at:new Date().toISOString() } });
    if (!Array.isArray(result) || result.length !== 1) return res.status(404).json({ error:'knowledge_file_search_source_not_found' });
    return res.status(200).json({ ok:true, active:input.learning_enabled });
  }
  if (input.operation === 'knowledge_file_search_delete') {
    const sha = String(input.sha256 || '').toLowerCase();
    if (!fileSearch.validSha(sha)) return res.status(400).json({ error:'knowledge_file_search_request_invalid' });
    const rows = await knowledgeStoreRequest(config, fileSearchAssetPath(ownerId, sha, '&select=store_name'));
    const mapping = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    if (!mapping) return res.status(200).json({ ok:true, deleted:false });
    if (!fileSearch.validStoreName(mapping.store_name)) throw new Error('knowledge_file_search_mapping_invalid');
    const deleted = await fileSearchProviderRequest('v1beta/' + mapping.store_name + '?force=true', { method:'DELETE' });
    if (!deleted.response.ok) throw new Error('knowledge_file_search_delete_failed');
    await knowledgeStoreRequest(config, fileSearchAssetPath(ownerId, sha), { method:'DELETE', prefer:'return=minimal' });
    return res.status(200).json({ ok:true, deleted:true });
  }
  if (input.operation === 'knowledge_file_search_query') {
    const question = boundedText(input.query, 1200);
    const context = boundedText(input.context, 1800);
    if (!question) return res.status(400).json({ error:'knowledge_file_search_query_invalid' });
    const [rows, approvedRows] = await Promise.all([
      knowledgeStoreRequest(config, 'yarbi_knowledge_file_search_stores?owner_account_id=eq.' + encodeURIComponent(ownerId)
        + '&active=eq.true&index_state=eq.ready&select=source_sha256,title,store_name&order=updated_at.desc&limit=100'),
      knowledgeStoreRequest(config, 'yarbi_knowledge_assets?owner_account_id=eq.' + encodeURIComponent(ownerId)
        + '&approval_state=eq.approved&learning_enabled=eq.true&backup_complete=eq.true&source_kind=in.(pdf,image)&select=source_sha256&limit=8000')
    ]);
    const approvedHashes = new Set((Array.isArray(approvedRows) ? approvedRows : []).map(row => String(row.source_sha256 || '').toLowerCase()).filter(fileSearch.validSha));
    const sources = (Array.isArray(rows) ? rows : []).filter(row => approvedHashes.has(String(row.source_sha256 || '').toLowerCase())
      && fileSearch.validSha(row.source_sha256) && fileSearch.validStoreName(row.store_name));
    if (!sources.length) return res.status(200).json({ ok:true, found:false, code:'knowledge_file_search_empty', citations:[] });
    const schema = { type:'object', properties:{
      found:{ type:'boolean' }, answer:{ type:'string' }, exact_quote:{ type:'string' }, reference:{ type:'string' },
      plain_explanation:{ type:'string' }, caveat:{ type:'string' }
    }, required:['found','answer','exact_quote','reference','plain_explanation','caveat'] };
    const interaction = await fileSearchProviderRequest('v1beta/interactions', {
      method:'POST', headers:{ 'Api-Revision':'2026-05-20' }, body:{ model:GEMINI_FILE_SEARCH_MODEL, input:fileSearch.fileSearchPrompt(question, context),
        tools:[{ type:'file_search', file_search_store_names:sources.map(row => row.store_name) }],
        response_format:{ type:'text', mime_type:'application/json', schema } }
    });
    const { response, data } = interaction;
    if (!response.ok) {
      console.error('[YARBI FILE SEARCH]', JSON.stringify({ status:response.status, category:'provider_rejected' }));
      return res.status(502).json({ error:'knowledge_file_search_unavailable' });
    }
    const extracted = fileSearch.interactionsTextAndCitations(data);
    const parsed = fileSearch.parseFileSearchAnswer(extracted.outputText);
    const citations = extracted.citations.map(citation => {
      const matched = sources.find(row => row.source_sha256 === citation.sha256)
        || sources.find(row => citation.fileName.includes('[[YARBI_SOURCE_' + row.source_sha256.slice(0, 20) + ']]'));
      if (!matched) return null;
      return { source_sha256:matched.source_sha256, title:boundedText(matched.title || citation.fileName, 140), page:citation.page, source:boundedText(citation.source, 1000) };
    }).filter(Boolean);
    const uniqueCitations = [...new Map(citations.map(item => [item.source_sha256 + ':' + (item.page || ''), item])).values()].slice(0, 8);
    const found = Boolean(parsed?.found && parsed.answer && uniqueCitations.length);
    const reference = found && fileSearch.referenceSupportedByCitation(parsed.reference, uniqueCitations) ? parsed.reference : '';
    return res.status(200).json({ ok:true, found,
      answer:found ? parsed.answer : '', exact_quote:found ? parsed.exactQuote : '', reference,
      plain_explanation:found ? parsed.explanation : '', caveat:boundedText(parsed?.caveat || 'No llegó una cita verificable de las fuentes aprobadas.', 600),
      citations:uniqueCitations
    });
  }
  return null;
}
function validateKnowledgeSync(input, ownerId) {
  const asset = input?.asset && typeof input.asset === 'object' && !Array.isArray(input.asset) ? input.asset : null;
  const sections = Array.isArray(input?.sections) ? input.sections : [];
  const sha = String(asset?.sha256 || '').toLowerCase();
  const sectionCount = Number(asset?.section_count);
  if (!asset || !validKnowledgeSha(sha) || !boundedText(asset.title, 140)
    || !['pdf','text','image','audio','video'].includes(String(asset.kind || ''))
    || !Number.isSafeInteger(Number(asset.bytes)) || Number(asset.bytes) < 0 || Number(asset.bytes) > 125829120
    || !Number.isSafeInteger(sectionCount) || sectionCount < 1 || sectionCount > MAX_KNOWLEDGE_SECTIONS
    || sections.length < 1 || sections.length > MAX_KNOWLEDGE_BATCH) return null;
  let chars = 0;
  const seen = new Set();
  const rows = [];
  for (const section of sections) {
    const index = Number(section?.index);
    const sourceSectionId = boundedText(section?.id, 160);
    const label = boundedText(section?.label, 240);
    const content = String(section?.text == null ? '' : section.text).replace(/\u0000/g, '').trim();
    if (!Number.isSafeInteger(index) || index < 0 || index >= sectionCount || !sourceSectionId || !label || !content || content.length > 2200 || seen.has(index)) return null;
    seen.add(index); chars += content.length;
    const vector = String(section?.embedding_base64 || '');
    let embedding = null;
    let embeddingVersion = '';
    if (vector) {
      embeddingVersion = boundedText(section?.embedding_version, 80);
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(vector) || Buffer.from(vector, 'base64').length !== EMBEDDING_DIMENSIONS || !embeddingVersion) return null;
      embedding = vector;
    }
    rows.push({ owner_account_id:ownerId, source_sha256:sha, section_index:index, source_section_id:sourceSectionId, section_label:label, section_text:content, embedding_base64:embedding, embedding_version:embedding ? embeddingVersion : null });
  }
  if (chars > MAX_KNOWLEDGE_BATCH_CHARS) return null;
  return {
    asset:{ owner_account_id:ownerId, source_sha256:sha, title:boundedText(asset.title, 140), mime_type:boundedText(asset.mime_type, 120) || 'application/octet-stream', source_kind:String(asset.kind), source_bytes:Number(asset.bytes), extraction_version:boundedText(asset.extraction_version, 80) || null, embedding_version:boundedText(asset.embedding_version, 80) || null, section_count:sectionCount, approval_state:'approved', learning_enabled:asset.learning_enabled !== false, updated_at:new Date().toISOString() },
    sections:rows
  };
}
async function handleKnowledgeOperation(req, res, config, identity, input) {
  if (!KNOWLEDGE_BACKUP_ENABLED) return res.status(503).json({ error:'knowledge_backup_disabled' });
  const ownerId = identity.user.id;
  if (input.operation === 'knowledge_list') {
    const rows = await knowledgeStoreRequest(config, 'yarbi_knowledge_assets?owner_account_id=eq.' + encodeURIComponent(ownerId)
      + '&backup_complete=eq.true'
      + '&select=source_sha256,title,mime_type,source_kind,source_bytes,extraction_version,embedding_version,section_count,approval_state,learning_enabled,backup_complete,approved_at,updated_at'
      + '&order=updated_at.desc&limit=80');
    return res.status(200).json({ ok:true, assets:Array.isArray(rows) ? rows : [] });
  }
  if (input.operation === 'knowledge_fetch') {
    const sha = String(input.source_sha256 || '').toLowerCase();
    const offset = Number(input.offset || 0);
    const limit = Math.max(1, Math.min(MAX_KNOWLEDGE_BATCH, Number(input.limit) || MAX_KNOWLEDGE_BATCH));
    if (!validKnowledgeSha(sha) || !Number.isSafeInteger(offset) || offset < 0 || offset > MAX_KNOWLEDGE_SECTIONS) return res.status(400).json({ error:'knowledge_request_invalid' });
    const sourceRows = await knowledgeStoreRequest(config, knowledgePath(ownerId, sha, '&select=backup_complete,section_count'));
    if (!Array.isArray(sourceRows) || sourceRows.length !== 1 || sourceRows[0].backup_complete !== true) return res.status(409).json({ error:'knowledge_cloud_backup_incomplete' });
    const rows = await knowledgeStoreRequest(config, 'yarbi_knowledge_sections?owner_account_id=eq.' + encodeURIComponent(ownerId)
      + '&source_sha256=eq.' + encodeURIComponent(sha)
      + '&select=section_index,source_section_id,section_label,section_text,embedding_base64,embedding_version'
      + '&order=section_index.asc&limit=' + limit + '&offset=' + offset);
    return res.status(200).json({ ok:true, sections:Array.isArray(rows) ? rows : [], offset, limit });
  }
  if (input.operation === 'knowledge_sync') {
    const payload = validateKnowledgeSync(input, ownerId);
    if (!payload) return res.status(400).json({ error:'knowledge_sync_invalid' });
    // El primer fragmento inicia una generación nueva de respaldo. Mientras se
    // recibe el resto, la fuente no aparece en la lista recuperable.
    if (payload.sections.some(section => section.section_index === 0)) payload.asset.backup_complete = false;
    await knowledgeStoreRequest(config, 'yarbi_knowledge_assets?on_conflict=owner_account_id,source_sha256', { method:'POST', prefer:'resolution=merge-duplicates,return=minimal', body:[payload.asset] });
    if (payload.sections.some(section => section.section_index === 0)) {
      // La extracción/segmentación puede cambiar aunque el PDF tenga el mismo
      // SHA. Eliminar índices anteriores evita que filas sobrantes impidan
      // completar el nuevo respaldo. El propietario conserva la copia local.
      await knowledgeStoreRequest(config, 'yarbi_knowledge_sections?owner_account_id=eq.' + encodeURIComponent(ownerId)
        + '&source_sha256=eq.' + encodeURIComponent(payload.asset.source_sha256), { method:'DELETE', prefer:'return=minimal' });
    }
    const sectionPath = 'yarbi_knowledge_sections?on_conflict=owner_account_id,source_sha256,section_index';
    await knowledgeStoreRequest(config, sectionPath, { method:'POST', prefer:'resolution=merge-duplicates,return=minimal', body:payload.sections });
    const storedCount = await knowledgeStoreRequest(config,
      'yarbi_knowledge_sections?owner_account_id=eq.' + encodeURIComponent(ownerId)
        + '&source_sha256=eq.' + encodeURIComponent(payload.asset.source_sha256)
        + '&select=section_index',
      { countOnly:true, prefer:'count=exact', range:'0-0' });
    let backupComplete = false;
    if (storedCount === payload.asset.section_count) {
      const sourcePath = 'yarbi_knowledge_sections?owner_account_id=eq.' + encodeURIComponent(ownerId)
        + '&source_sha256=eq.' + encodeURIComponent(payload.asset.source_sha256)
        + '&select=section_index&order=section_index.asc&limit=1';
      const firstRows = await knowledgeStoreRequest(config, sourcePath);
      const lastRows = await knowledgeStoreRequest(config, sourcePath.replace('section_index.asc', 'section_index.desc'));
      backupComplete = knowledgeCoverageComplete(storedCount, firstRows?.[0]?.section_index, lastRows?.[0]?.section_index, payload.asset.section_count);
    }
    if (backupComplete) {
      await knowledgeStoreRequest(config, knowledgePath(ownerId, payload.asset.source_sha256), {
        method:'PATCH', prefer:'return=minimal', body:{ backup_complete:true, updated_at:new Date().toISOString() }
      });
    }
    return res.status(200).json({ ok:true, source_sha256:payload.asset.source_sha256, synced_sections:payload.sections.length, section_count:payload.asset.section_count, backup_complete:backupComplete, stored_section_count:storedCount });
  }
  if (input.operation === 'knowledge_delete') {
    const sha = String(input.source_sha256 || '').toLowerCase();
    if (!validKnowledgeSha(sha)) return res.status(400).json({ error:'knowledge_request_invalid' });
    const fileRows = await knowledgeStoreRequest(config, fileSearchAssetPath(ownerId, sha, '&select=store_name'));
    const fileStore = Array.isArray(fileRows) && fileRows.length === 1 ? fileRows[0] : null;
    if (fileStore) {
      if (!GEMINI_KEY) return res.status(503).json({ error:'knowledge_file_search_delete_not_configured' });
      if (!fileSearch.validStoreName(fileStore.store_name)) return res.status(500).json({ error:'knowledge_file_search_mapping_invalid' });
      const deleted = await fileSearchProviderRequest('v1beta/' + fileStore.store_name + '?force=true', { method:'DELETE' });
      if (!deleted.response.ok && deleted.response.status !== 404) return res.status(502).json({ error:'knowledge_file_search_delete_failed' });
      await knowledgeStoreRequest(config, fileSearchAssetPath(ownerId, sha), { method:'DELETE', prefer:'return=minimal' });
    }
    await knowledgeStoreRequest(config, knowledgePath(ownerId, sha), { method:'DELETE', prefer:'return=minimal' });
    return res.status(200).json({ ok:true, deleted:true });
  }
  if (input.operation === 'knowledge_set_learning') {
    const sha = String(input.source_sha256 || '').toLowerCase();
    if (!validKnowledgeSha(sha) || typeof input.learning_enabled !== 'boolean') return res.status(400).json({ error:'knowledge_request_invalid' });
    const updated = await knowledgeStoreRequest(config, knowledgePath(ownerId, sha), { method:'PATCH', prefer:'return=representation', body:{ learning_enabled:input.learning_enabled, updated_at:new Date().toISOString() } });
    if (!Array.isArray(updated) || updated.length !== 1) return res.status(404).json({ error:'knowledge_source_not_found' });
    await knowledgeStoreRequest(config, fileSearchAssetPath(ownerId, sha), { method:'PATCH', prefer:'return=minimal', body:{ active:input.learning_enabled, updated_at:new Date().toISOString() } }).catch(() => {});
    return res.status(200).json({ ok:true, learning_enabled:input.learning_enabled });
  }
  return null;
}

module.exports = async function geminiHandler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const config = validateServerRouteConfig({ requirePublicAuth: true });
  if (!config.ok) return res.status(503).json({ error: 'configuration_invalid', code: config.code });
  const identity = await authenticatedOwnerIdentity(req, config);
  if (!identity.ok) return res.status(identity.status).json({ error: identity.code });
  try {
    const input = bodyOf(req);
    if (['knowledge_file_search_upload_start','knowledge_file_search_upload_complete','knowledge_file_search_upload_failed','knowledge_file_search_status','knowledge_file_search_set_learning','knowledge_file_search_delete','knowledge_file_search_query'].includes(input.operation)) {
      const result = await handleFileSearchOperation(req, res, config, identity, input);
      if (result) return result;
    }
    if (['knowledge_sync','knowledge_list','knowledge_fetch','knowledge_delete','knowledge_set_learning'].includes(input.operation)) {
      const result = await handleKnowledgeOperation(req, res, config, identity, input);
      if (result) return result;
    }
    if (!GEMINI_KEY) return res.status(503).json({ error: 'assistant_not_configured' });
    if (input.operation === 'embed') {
      const embedding = sanitizeEmbeddingRequest(input);
      if (!embedding) return res.status(400).json({ error: 'embedding_request_invalid' });
      const modelName = `models/${GEMINI_EMBEDDING_MODEL}`;
      const requests = embedding.texts.map(value => ({
        model: modelName,
        content: { parts: [{ text: value }] },
        taskType: embedding.taskType,
        ...(embedding.title ? { title: embedding.title } : {}),
        outputDimensionality: embedding.outputDimensionality
      }));
      const response = await fetchWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_EMBEDDING_MODEL)}:batchEmbedContents?key=${encodeURIComponent(GEMINI_KEY)}`,
        { requests }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        console.error('[ASSISTANT GEMINI EMBEDDINGS]', JSON.stringify({ status: response.status, category: 'provider_rejected' }));
        return res.status(502).json({ error: 'embedding_unavailable', provider_status: response.status });
      }
      const embeddings = (Array.isArray(data.embeddings) ? data.embeddings : []).map(item =>
        (Array.isArray(item?.values) ? item.values : []).map(Number).filter(Number.isFinite)
      );
      if (embeddings.length !== requests.length || embeddings.some(values => values.length !== EMBEDDING_DIMENSIONS)) {
        return res.status(502).json({ error: 'embedding_response_invalid' });
      }
      return res.status(200).json({ embeddings, model: GEMINI_EMBEDDING_MODEL, dimensions: EMBEDDING_DIMENSIONS });
    }
    const contents = sanitizeContents(input.contents);
    if (!contents) return res.status(400).json({ error: 'gemini_request_invalid' });
    const request = { contents, generationConfig: generationConfig(input.generationConfig) };
    const systemInstruction = input.system_instruction || input.systemInstruction;
    const systemParts = Array.isArray(systemInstruction?.parts) ? systemInstruction.parts.map(sanitizePart).filter(Boolean).slice(0, 4) : [];
    if (systemParts.length) request.system_instruction = { parts: systemParts };
    const response = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`,
      request
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('[ASSISTANT GEMINI PROXY]', JSON.stringify({ status: response.status, category: 'provider_rejected' }));
      return res.status(502).json({ error: 'gemini_unavailable', provider_status: response.status });
    }
    return res.status(200).json({ candidates: Array.isArray(data.candidates) ? data.candidates : [] });
  } catch (error) {
    if (error?.name === 'AbortError') {
      console.error('[ASSISTANT GEMINI PROXY]', JSON.stringify({ category: 'provider_timeout' }));
      return res.status(504).json({ error: 'gemini_timeout' });
    }
    console.error('[ASSISTANT GEMINI PROXY]', JSON.stringify({ category: 'request_failed' }));
    return res.status(500).json({ error: 'gemini_proxy_failed' });
  }
};

module.exports.sanitizeContents = sanitizeContents;
module.exports.generationConfig = generationConfig;
module.exports.sanitizeEmbeddingRequest = sanitizeEmbeddingRequest;
module.exports.validateKnowledgeSync = validateKnowledgeSync;
module.exports.knowledgeCoverageComplete = knowledgeCoverageComplete;
module.exports.fileSearchUploadSession = fileSearchUploadSession;
module.exports.handleFileSearchOperation = handleFileSearchOperation;
