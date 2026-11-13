'use strict';

// Adaptador aislado para redactar borradores confirmables. Solo recibe la
// solicitud reducida de yarbi-owner-reply-draft; no conoce WhatsApp, CRM,
// contactos distintos ni puede enviar mensajes.
const { REPLY_DRAFT_SCHEMA } = require('./yarbi-owner-reply-draft');
const { classifyGeminiInvalidArgument, schemaSha256 } = require('./yarbi-gemini-request-forensics');

const GEMINI_HOST = 'generativelanguage.googleapis.com';
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const DEFAULT_TIMEOUT_MS = 10000;

function text(value, limit = 240) { return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, limit); }
function timeout(value) { const parsed = Number(value); return Math.min(12000, Math.max(750, Math.round(Number.isFinite(parsed) ? parsed : DEFAULT_TIMEOUT_MS))); }
function replyError(response, body, { model, schemaHash } = {}) {
  const classified = classifyGeminiInvalidArgument(body);
  const error = new Error('owner_reply_draft_provider_unavailable');
  error.code = response?.status === 429 ? 'owner_reply_draft_rate_limited'
    : response?.status >= 500 ? 'owner_reply_draft_provider_unavailable'
      : response?.status ? 'owner_reply_draft_provider_rejected' : 'owner_reply_draft_provider_unavailable';
  error.provider_diagnostic = Object.freeze({
    provider:'gemini', http_status:Number(response?.status) || classified.http_status || null,
    provider_status:classified.provider_status, category:classified.category, signals:classified.signals,
    schema_sha256:text(schemaHash, 64).toLowerCase() || null, model:text(model, 120) || null
  });
  return error;
}
function parse(body) {
  const raw = body?.candidates?.[0]?.content?.parts?.map(part => String(part?.text || '')).join('').trim();
  if (!raw) throw Object.assign(new Error('owner_reply_draft_response_invalid'), { code:'owner_reply_draft_response_invalid' });
  try { return JSON.parse(raw); }
  catch (_) { throw Object.assign(new Error('owner_reply_draft_response_invalid'), { code:'owner_reply_draft_response_invalid' }); }
}
function createOwnerReplyDraftGemini({ apiKey, model = DEFAULT_MODEL, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const key = text(apiKey, 512); const selectedModel = text(model, 120) || DEFAULT_MODEL;
  if (!key) throw Object.assign(new Error('owner_reply_draft_provider_unavailable'), { code:'owner_reply_draft_provider_unavailable' });
  if (typeof fetchImpl !== 'function') throw new TypeError('owner_reply_draft_fetch_unavailable');
  const responseSchemaHash = schemaSha256(REPLY_DRAFT_SCHEMA);
  return {
    provider:'gemini', model:selectedModel, response_schema_sha256:responseSchemaHash,
    async createDraft(request) {
      if (!request || request.schema !== 'yarbi.owner-reply-draft-request.v1'
        || request.response_mime_type !== 'application/json'
        || request.response_json_schema !== REPLY_DRAFT_SCHEMA
        || request.execute !== false || request.automatic_send_allowed !== false
        || !text(request.prompt, 20000)) throw Object.assign(new Error('owner_reply_draft_request_invalid'), { code:'owner_reply_draft_request_invalid' });
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeout(timeoutMs));
      try {
        const response = await fetchImpl(`https://${GEMINI_HOST}/v1beta/models/${encodeURIComponent(selectedModel)}:generateContent`, {
          method:'POST', signal:controller.signal, headers:{ 'Content-Type':'application/json', 'x-goog-api-key':key },
          body:JSON.stringify({ contents:[{ role:'user', parts:[{ text:request.prompt }] }], generationConfig:{ temperature:0, responseMimeType:'application/json', responseJsonSchema:REPLY_DRAFT_SCHEMA } })
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw replyError(response, body, { model:selectedModel, schemaHash:responseSchemaHash });
        return parse(body);
      } catch (caught) {
        if (caught?.name === 'AbortError') throw Object.assign(new Error('owner_reply_draft_timeout'), { code:'owner_reply_draft_timeout' });
        throw caught;
      } finally { clearTimeout(timer); }
    }
  };
}

module.exports = { GEMINI_HOST, DEFAULT_MODEL, DEFAULT_TIMEOUT_MS, createOwnerReplyDraftGemini };
