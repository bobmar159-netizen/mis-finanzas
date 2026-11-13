'use strict';

// Adaptador mínimo y aislado para el procesamiento histórico. No sabe de CRM,
// Agenda, Finanzas ni de acciones comerciales; solo interpreta el contrato
// preparado por yarbi-historical-intelligence y devuelve JSON para revisión.
const { HISTORICAL_INTELLIGENCE_RESPONSE_SCHEMA } = require('./yarbi-historical-intelligence');
const { classifyGeminiInvalidArgument, schemaSha256 } = require('./yarbi-gemini-request-forensics');

const GEMINI_HOST = 'generativelanguage.googleapis.com';
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const DEFAULT_TIMEOUT_MS = 10000;

function text(value, limit = 240) { return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, limit); }
function timeout(value) { const parsed = Number(value); return Math.min(12000, Math.max(750, Math.round(Number.isFinite(parsed) ? parsed : DEFAULT_TIMEOUT_MS))); }

function responseError(response, providerBody, { model, schemaHash } = {}) {
  const error = new Error('historical_intelligence_provider_unavailable');
  error.code = response?.status === 429 ? 'historical_intelligence_rate_limited'
    : response?.status >= 500 ? 'historical_intelligence_provider_unavailable'
      : response?.status ? 'historical_intelligence_provider_rejected' : 'historical_intelligence_provider_unavailable';
  const classified = classifyGeminiInvalidArgument(providerBody);
  // Se preservan únicamente señales técnicas aptas para trazabilidad. Nunca el
  // mensaje del proveedor, el prompt, el chat ni una clave.
  error.provider_diagnostic = Object.freeze({
    provider: 'gemini',
    http_status: Number(response?.status) || classified.http_status || null,
    provider_status: classified.provider_status,
    category: classified.category,
    signals: classified.signals,
    schema_sha256: text(schemaHash, 64).toLowerCase() || null,
    model: text(model, 120) || null
  });
  return error;
}

function parseProviderResult(body) {
  const raw = body?.candidates?.[0]?.content?.parts?.map(part => String(part?.text || '')).join('').trim();
  if (!raw) {
    const error = new Error('historical_intelligence_response_invalid');
    error.code = error.message;
    throw error;
  }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (_) { const error = new Error('historical_intelligence_response_invalid'); error.code = error.message; throw error; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    || !Array.isArray(parsed.contact_context_observations)
    || !Array.isArray(parsed.reply_style_patterns)
    || typeof parsed.requires_owner_review !== 'boolean') {
    const error = new Error('historical_intelligence_response_invalid');
    error.code = error.message;
    throw error;
  }
  return parsed;
}

function createHistoricalGeminiInterpreter({ apiKey, model = DEFAULT_MODEL, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const key = text(apiKey, 512);
  const selectedModel = text(model, 120) || DEFAULT_MODEL;
  if (!key) { const error = new Error('historical_intelligence_provider_unavailable'); error.code = error.message; throw error; }
  if (typeof fetchImpl !== 'function') throw new TypeError('historical_intelligence_fetch_unavailable');
  const responseSchema = HISTORICAL_INTELLIGENCE_RESPONSE_SCHEMA;
  const responseSchemaHash = schemaSha256(responseSchema);
  return {
    provider: 'gemini', model: selectedModel, response_schema_sha256: responseSchemaHash,
    async interpretHistoricalSegment(request) {
      if (!request || request.response_mime_type !== 'application/json' || request.response_json_schema !== responseSchema || !text(request.prompt, 20000)) {
        const error = new Error('historical_intelligence_request_invalid'); error.code = error.message; throw error;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout(timeoutMs));
      const url = `https://${GEMINI_HOST}/v1beta/models/${encodeURIComponent(selectedModel)}:generateContent`;
      try {
        const response = await fetchImpl(url, {
          method: 'POST', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
            generationConfig: { temperature: 0, responseMimeType: 'application/json', responseJsonSchema: responseSchema }
          })
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw responseError(response, body, { model: selectedModel, schemaHash: responseSchemaHash });
        return parseProviderResult(body);
      } catch (error) {
        if (error?.name === 'AbortError') { const timeoutError = new Error('historical_intelligence_timeout'); timeoutError.code = timeoutError.message; throw timeoutError; }
        throw error;
      } finally { clearTimeout(timer); }
    }
  };
}

module.exports = { GEMINI_HOST, DEFAULT_MODEL, DEFAULT_TIMEOUT_MS, createHistoricalGeminiInterpreter, parseProviderResult };
