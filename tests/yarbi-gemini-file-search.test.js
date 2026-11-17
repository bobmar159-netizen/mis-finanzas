'use strict';

process.env.YARBI_GEMINI_FILE_SEARCH_ENABLED = 'true';
process.env.GEMINI_API_KEY = 'synthetic-gemini-key';
process.env.GEMINI_FILE_SEARCH_MODEL = 'gemini-3.5-flash-lite';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const helper = require('../lib/yarbi-gemini-file-search');
const gemini = require('../api_handlers/assistant/gemini');

const ownerA = '00000000-0000-4000-8000-000000000001';
const ownerB = '00000000-0000-4000-8000-000000000002';
const sha = 'a'.repeat(64);
const imageSha = 'c'.repeat(64);
const storeA = 'fileSearchStores/yarbi-owner-a';
const imageStoreA = 'fileSearchStores/yarbi-owner-a-image';
const config = { supabaseUrl:'https://supabase.synthetic.invalid', supabaseKey:'synthetic-supabase-service-key' };
const identity = { user:{ id:ownerA } };
const assetRow = { source_bytes:4096, source_kind:'pdf', mime_type:'application/pdf', approval_state:'approved', learning_enabled:true, backup_complete:true };
const imageAssetRow = { source_bytes:8192, source_kind:'image', mime_type:'image/png', approval_state:'approved', learning_enabled:true, backup_complete:true };

test('migración BKE declara las columnas y límites usados por backup y File Search', () => {
  const sql = fs.readFileSync(path.join(__dirname,'..','migrations','PROPOSED_20261115_yarbi_knowledge_backup.sql'),'utf8');
  for (const name of ['yarbi_knowledge_assets','yarbi_knowledge_sections','yarbi_knowledge_file_search_stores']) assert.match(sql, new RegExp('create table if not exists public\\.' + name));
  assert.match(sql, /embedding_base64[^\n]*char_length\(embedding_base64\) = 1024/);
  assert.match(sql, /embedding_base64 is null or embedding_version is not null/);
  assert.match(sql, /yarbi_knowledge_file_search_ready_owner_updated_idx/);
  assert.match(sql, /yarbi_knowledge_schema_mismatch/);
  assert.match(sql, /force row level security/);
  assert.match(sql, /revoke all on public\.yarbi_knowledge_assets[^;]+from public, anon, authenticated/);
  assert.match(sql, /grant all on public\.yarbi_knowledge_assets[^;]+to service_role/);
});

function fakeResponse(status, data, headers = {}) {
  return { ok:status >= 200 && status < 300, status, headers:{ get:name => headers[String(name).toLowerCase()] || null }, json:async () => data };
}
function makeRes() {
  return { statusCode:200, body:null, status(code) { this.statusCode=code; return this; }, json(body) { this.body=body; return this; } };
}
function withFetch(handler, fn) {
  const previous = global.fetch;
  global.fetch = handler;
  return Promise.resolve().then(fn).finally(() => { global.fetch=previous; });
}
function parseUrl(value) { return new URL(value); }

test('File Search acepta únicamente modelos documentados y PDF dentro del límite', () => {
  assert.equal(helper.supportedModel('gemini-3.5-flash-lite'), true);
  assert.equal(helper.supportedModel('gemini-3.8-live'), false);
  assert.equal(helper.validatePdfDescriptor({ sha256:sha, title:'Norma.pdf', bytes:4096, mime_type:'application/pdf' }).bytes, 4096);
  assert.equal(helper.validatePdfDescriptor({ sha256:sha, title:'Norma.pdf', bytes:helper.MAX_PDF_BYTES + 1, mime_type:'application/pdf' }), null);
  assert.equal(helper.validatePdfDescriptor({ sha256:sha, title:'Norma.pdf', bytes:10, mime_type:'image/png' }), null);
});

test('File Search admite PNG/JPEG con límites multimodales y rechaza tipos/dimensiones no soportados', () => {
  const image={ sha256:sha, title:'Detalle.png', bytes:8192, kind:'image', mime_type:'image/png', width:4096, height:2048 };
  assert.deepEqual(helper.validateFileSearchDescriptor(image), { sha256:sha, title:'Detalle.png', bytes:8192, mimeType:'image/png', kind:'image', width:4096, height:2048 });
  assert.equal(helper.validateFileSearchDescriptor({ ...image, mime_type:'image/webp' }), null);
  assert.equal(helper.validateFileSearchDescriptor({ ...image, width:4097 }), null);
  assert.equal(helper.validateFileSearchDescriptor({ ...image, bytes:helper.MAX_IMAGE_BYTES + 1 }), null);
  assert.equal(helper.validateFileSearchDescriptor({ sha256:sha, title:'Norma.pdf', bytes:4096, mime_type:'application/pdf' }).kind, 'pdf');
});

test('File Search valida URL de carga y metadatos de cita sin exponer claves', () => {
  assert.equal(helper.validResumableUploadUrl('https://generativelanguage.googleapis.com/upload/v1beta/session?upload_id=synth'), true);
  assert.equal(helper.validResumableUploadUrl('https://generativelanguage.googleapis.com/upload/v1beta/session?key=secret'), false);
  assert.equal(helper.validResumableUploadUrl('http://generativelanguage.googleapis.com/upload/session'), false);
  assert.equal(helper.documentHasSourceSha({ custom_metadata:[{ key:'source_sha256', string_value:sha }] }, sha), true);
  assert.equal(helper.documentHasSourceSha({ display_name:'[[YARBI_SOURCE_' + sha.slice(0,20) + ']] Norma.pdf' }, sha), true);
});

test('File Search parsea el formato Interactions y conserva cita, página y metadatos', () => {
  const parsed = helper.interactionsTextAndCitations({ steps:[{ type:'model_output', content:[{ type:'text', text:'{"found":true}', annotations:[{ type:'file_citation', file_name:'Norma.pdf', source:'Se permite bajo condiciones.', page_number:8, custom_metadata:{ source_sha256:sha } }] }] }] });
  assert.equal(parsed.outputText, '{"found":true}');
  assert.deepEqual(parsed.citations[0], { sha256:sha, fileName:'Norma.pdf', documentUri:'', source:'Se permite bajo condiciones.', page:8 });
  assert.equal(helper.parseFileSearchAnswer(parsed.outputText).found, true);
  assert.equal(helper.parseFileSearchAnswer('respuesta sin JSON'), null);
});

test('la referencia de sección solo se acepta si aparece en la cita del proveedor', () => {
  const evidence=[{ source:'Numeral 7.3: La válvula común podrá alimentar dos artefactos.' }];
  assert.equal(helper.referenceSupportedByCitation('Numeral 7.3', evidence), true);
  assert.equal(helper.referenceSupportedByCitation('Capítulo 9.8', evidence), false);
});

test('subida válida crea store por propietario y no entrega la API key al navegador', async () => {
  const calls=[];
  await withFetch(async (url, options={}) => {
    const target=parseUrl(url); calls.push({ url:target, options });
    if (target.origin === config.supabaseUrl) {
      if (target.pathname.endsWith('/yarbi_knowledge_assets')) return fakeResponse(200, [assetRow]);
      if (target.pathname.endsWith('/yarbi_knowledge_file_search_stores') && options.method === 'GET') return fakeResponse(200, []);
      if (target.pathname.endsWith('/yarbi_knowledge_file_search_stores') && options.method === 'POST') return fakeResponse(201, JSON.parse(options.body));
      if (options.method === 'PATCH') return fakeResponse(204, null);
      throw new Error('unexpected synthetic Supabase call');
    }
    if (target.pathname === '/v1beta/fileSearchStores') return fakeResponse(200, { name:storeA });
    if (target.pathname.startsWith('/upload/')) return fakeResponse(200, {}, { 'x-goog-upload-url':'https://generativelanguage.googleapis.com/upload/v1beta/session?upload_id=synthetic' });
    throw new Error('unexpected synthetic Google call');
  }, async () => {
    const res=makeRes();
    await gemini.handleFileSearchOperation({}, res, config, identity, { operation:'knowledge_file_search_upload_start', sha256:sha, title:'Norma.pdf', bytes:4096, mime_type:'application/pdf' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, 'uploading');
    assert.equal(res.body.upload_url.includes('synthetic-gemini-key'), false);
    assert.equal(res.body.upload_url.includes('key='), false);
    const session = calls.find(call => call.url.pathname.startsWith('/upload/'));
    assert.equal(session.url.search, '');
    assert.equal(session.options.headers['x-goog-api-key'], 'synthetic-gemini-key');
    const uploadMetadata = JSON.parse(session.options.body);
    assert.equal(uploadMetadata.displayName, '[[YARBI_SOURCE_' + sha.slice(0,20) + ']] Norma.pdf');
    assert.deepEqual(uploadMetadata.customMetadata, [{ key:'source_sha256', stringValue:sha }]);
    assert.equal(Object.hasOwn(uploadMetadata, 'display_name'), false);
    assert.equal(Object.hasOwn(uploadMetadata, 'custom_metadata'), false);
    const insert = calls.find(call => call.url.pathname.endsWith('/yarbi_knowledge_file_search_stores') && call.options.method === 'POST');
    assert.equal(JSON.parse(insert.options.body)[0].owner_account_id, ownerA);
  });
});

test('subida de imagen requiere imagen aprobada del mismo owner y pasa su MIME al upload resumible', async () => {
  const calls=[];
  await withFetch(async (url, options={}) => {
    const target=parseUrl(url); calls.push({ url:target, options });
    if (target.origin === config.supabaseUrl) {
      if (target.pathname.endsWith('/yarbi_knowledge_assets')) return fakeResponse(200, [imageAssetRow]);
      if (target.pathname.endsWith('/yarbi_knowledge_file_search_stores') && options.method === 'GET') return fakeResponse(200, []);
      if (target.pathname.endsWith('/yarbi_knowledge_file_search_stores') && options.method === 'POST') return fakeResponse(201, JSON.parse(options.body));
      if (options.method === 'PATCH') return fakeResponse(204, null);
      throw new Error('unexpected synthetic Supabase call');
    }
    if (target.pathname === '/v1beta/fileSearchStores') return fakeResponse(200, { name:storeA });
    if (target.pathname.startsWith('/upload/')) return fakeResponse(200, {}, { 'x-goog-upload-url':'https://generativelanguage.googleapis.com/upload/v1beta/image-session?upload_id=synthetic' });
    throw new Error('unexpected synthetic Google call');
  }, async () => {
    const res=makeRes();
    await gemini.handleFileSearchOperation({}, res, config, identity, {
      operation:'knowledge_file_search_upload_start', sha256:sha, title:'Detalle.png', bytes:8192,
      kind:'image', mime_type:'image/png', width:2048, height:1024
    });
    assert.equal(res.statusCode, 200);
    const session=calls.find(call => call.url.pathname.startsWith('/upload/'));
    assert.equal(session.options.headers['X-Goog-Upload-Header-Content-Type'], 'image/png');
    const rowQuery=calls.find(call => call.url.pathname.endsWith('/yarbi_knowledge_assets'));
    assert.match(rowQuery.url.search, /source_kind/);
  });
});

test('subida inválida o no aprobada no realiza escrituras ni llamadas a Gemini', async () => {
  let providerCalls=0;
  let fetchCalls=0;
  await withFetch(async (url, options={}) => {
    fetchCalls += 1;
    const target=parseUrl(url);
    if (target.origin !== config.supabaseUrl) { providerCalls += 1; return fakeResponse(500, {}); }
    if (target.pathname.endsWith('/yarbi_knowledge_assets')) return fakeResponse(200, []);
    throw new Error('unexpected database write before approval');
  }, async () => {
    const beforeInvalidImage=fetchCalls;
    const invalidImage=makeRes();
    await gemini.handleFileSearchOperation({}, invalidImage, config, identity, { operation:'knowledge_file_search_upload_start', sha256:sha, title:'Plano.png', bytes:4096, kind:'image', mime_type:'image/png', width:4097, height:1024 });
    assert.equal(invalidImage.statusCode, 400);
    assert.equal(fetchCalls, beforeInvalidImage, 'dimensiones inválidas se rechazan antes de consultar Supabase o Gemini');
    const invalid=makeRes();
    await gemini.handleFileSearchOperation({}, invalid, config, identity, { operation:'knowledge_file_search_upload_start', sha256:'bad', title:'Norma.pdf', bytes:4096, mime_type:'application/pdf' });
    assert.equal(invalid.statusCode, 400);
    const unapproved=makeRes();
    await gemini.handleFileSearchOperation({}, unapproved, config, identity, { operation:'knowledge_file_search_upload_start', sha256:sha, title:'Norma.pdf', bytes:4096, mime_type:'application/pdf' });
    assert.equal(unapproved.statusCode, 409);
    assert.equal(unapproved.body.error, 'knowledge_file_search_source_not_approved');
    assert.equal(providerCalls, 0);
  });
});

test('pregunta File Search usa stores aprobados del owner autenticado y devuelve cita verificada', async () => {
  const calls=[];
  const rows=[
    { owner_account_id:ownerA, source_sha256:sha, title:'NTP 111.011.pdf', store_name:storeA, active:true, index_state:'ready' },
    { owner_account_id:ownerA, source_sha256:imageSha, title:'Diagrama.png', store_name:imageStoreA, active:true, index_state:'ready' },
    { owner_account_id:ownerB, source_sha256:'b'.repeat(64), title:'Privado.pdf', store_name:'fileSearchStores/owner-b', active:true, index_state:'ready' }
  ];
  await withFetch(async (url, options={}) => {
    const target=parseUrl(url); calls.push({ url:target, options });
    if (target.origin === config.supabaseUrl) {
      const ownerFilter=target.searchParams.get('owner_account_id');
      if (target.pathname.endsWith('/yarbi_knowledge_file_search_stores')) return fakeResponse(200, rows.filter(row => 'eq.'+row.owner_account_id === ownerFilter));
      if (target.pathname.endsWith('/yarbi_knowledge_assets')) return fakeResponse(200, [{ source_sha256:sha }, { source_sha256:imageSha }]);
      throw new Error('unexpected database query');
    }
    if (target.pathname === '/v1beta/interactions') return fakeResponse(200, { steps:[{ type:'model_output', content:[{
      type:'text', text:JSON.stringify({ found:true, answer:'Sí, bajo las condiciones citadas.', exact_quote:'La válvula común podrá alimentar dos artefactos.', reference:'Capítulo 9.8', plain_explanation:'Una válvula puede servir a ambos si se cumplen las condiciones.', caveat:'' }),
      annotations:[{ type:'file_citation', file_name:'NTP 111.011.pdf', source:'Numeral 7.3: La válvula común podrá alimentar dos artefactos.', page_number:22, custom_metadata:{ source_sha256:sha } }]
    }] }] });
    throw new Error('unexpected synthetic Google call');
  }, async () => {
    const res=makeRes();
    await gemini.handleFileSearchOperation({}, res, config, identity, { operation:'knowledge_file_search_query', query:'¿Una válvula puede servir para dos artefactos?', context:'', store_name:'fileSearchStores/attacker-store' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.found, true);
    assert.equal(res.body.citations[0].source_sha256, sha);
    assert.equal(res.body.citations[0].page, 22);
    assert.equal(res.body.reference, '', 'el modelo no puede añadir un capítulo no presente en la evidencia citada');
    const interaction=calls.find(call => call.url.pathname === '/v1beta/interactions');
    const payload=JSON.parse(interaction.options.body);
    assert.deepEqual(payload.tools[0].file_search_store_names, [storeA, imageStoreA]);
    assert.equal(payload.tools[0].file_search_store_names.includes('fileSearchStores/attacker-store'), false);
    const allowedKindsQuery=calls.find(call => call.url.pathname.endsWith('/yarbi_knowledge_assets'));
    assert.equal(allowedKindsQuery.url.searchParams.get('source_kind'), 'in.(pdf,image)');
    assert.equal(interaction.options.headers['x-goog-api-key'], 'synthetic-gemini-key');
    assert.equal(interaction.options.headers['Api-Revision'], '2026-05-20');
  });
});

test('operación completada solo marca lista la fuente cuando el documento aparece en el store', async () => {
  const calls=[];
  await withFetch(async (url, options={}) => {
    const target=parseUrl(url); calls.push(target);
    if (target.origin === config.supabaseUrl) {
      if (target.pathname.endsWith('/yarbi_knowledge_file_search_stores') && options.method === 'GET') return fakeResponse(200, [{ store_name:storeA, index_state:'uploading', active:true }]);
      if (options.method === 'PATCH') return fakeResponse(204, null);
      throw new Error('unexpected database operation');
    }
    if (target.pathname === '/v1beta/operations/upload-1') return fakeResponse(200, { done:true });
    if (target.pathname === '/v1beta/' + storeA + '/documents') return fakeResponse(200, { documents:[{ custom_metadata:[{ key:'source_sha256', string_value:sha }] }] });
    throw new Error('unexpected provider operation');
  }, async () => {
    const res=makeRes();
    await gemini.handleFileSearchOperation({}, res, config, identity, { operation:'knowledge_file_search_upload_complete', sha256:sha, operation_name:'operations/upload-1' });
    assert.equal(res.body.status, 'ready');
    assert.ok(calls.some(url => url.pathname === '/v1beta/' + storeA + '/documents'));
  });
});

test('subida duplicada reciente queda pendiente y no crea otro store ni reenvía el PDF', async () => {
  const calls=[];
  await withFetch(async (url, options={}) => {
    const target=parseUrl(url); calls.push(target);
    if (target.origin === config.supabaseUrl) {
      if (target.pathname.endsWith('/yarbi_knowledge_assets')) return fakeResponse(200, [assetRow]);
      if (target.pathname.endsWith('/yarbi_knowledge_file_search_stores')) return fakeResponse(200, [{ store_name:storeA, index_state:'uploading', active:true, updated_at:new Date().toISOString() }]);
    }
    if (target.pathname === '/v1beta/' + storeA + '/documents') return fakeResponse(200, { documents:[] });
    throw new Error('duplicate upload attempted');
  }, async () => {
    const res=makeRes();
    await gemini.handleFileSearchOperation({}, res, config, identity, { operation:'knowledge_file_search_upload_start', sha256:sha, title:'Norma.pdf', bytes:4096, mime_type:'application/pdf' });
    assert.equal(res.body.status, 'uploading');
    assert.equal(res.body.pending, true);
    assert.equal(calls.some(url => url.pathname === '/v1beta/fileSearchStores'), false);
    assert.equal(calls.some(url => url.pathname.startsWith('/upload/')), false);
  });
});

test('File Search está apagado por defecto y no hace llamadas externas', () => {
  const script = `const g=require('./api_handlers/assistant/gemini');let n=0;global.fetch=async()=>{n++;throw Error('network forbidden')};const r={statusCode:200,status(c){this.statusCode=c;return this},json(x){this.body=x;return this}};g.handleFileSearchOperation({},r,{supabaseUrl:'https://synthetic.invalid',supabaseKey:'x'},{user:{id:'00000000-0000-4000-8000-000000000001'}},{operation:'knowledge_file_search_query',query:'norma'}).then(()=>{process.stdout.write(JSON.stringify({status:r.statusCode,calls:n,error:r.body.error}))})`;
  const child=spawnSync(process.execPath, ['-e', script], { cwd:path.join(__dirname,'..'), encoding:'utf8', env:{ ...process.env, YARBI_GEMINI_FILE_SEARCH_ENABLED:'false', GEMINI_API_KEY:'synthetic-gemini-key' } });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { status:503, calls:0, error:'knowledge_file_search_disabled' });
});

test('handler conserva autenticación antes de permitir cualquier operación de búsqueda', () => {
  const source=fs.readFileSync(path.join(__dirname,'..','api_handlers','assistant','gemini.js'),'utf8');
  assert.ok(source.indexOf('const identity = await authenticatedOwnerIdentity(req, config);') < source.indexOf('const result = await handleFileSearchOperation(req, res, config, identity, input)'));
});
