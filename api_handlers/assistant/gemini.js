'use strict';

// Pasarela acotada para las utilidades históricas del frontend. El navegador
// nunca conoce la clave maestra: sólo envía una solicitud limitada después de
// validar su sesión Supabase. No registra prompts, respuestas ni cabeceras.
const { validateServerRouteConfig } = require('../../lib/yarbi-runtime-config');
const { authenticatedOwnerIdentity } = require('../../lib/yarbi-owner-ui-auth');

const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GEMINI_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || process.env.GEMINI_CHAT_MODEL || 'gemini-3.5-flash-lite';
const GEMINI_EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';
const MAX_TEXT = 16000;
const MAX_INLINE_BYTES = 3 * 1024 * 1024;
const MAX_EMBED_INPUTS = 24;
const MAX_EMBED_TEXT = 4000;
const MAX_EMBED_TOTAL_TEXT = 64000;
const EMBEDDING_DIMENSIONS = 768;
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

module.exports = async function geminiHandler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const config = validateServerRouteConfig({ requirePublicAuth: true });
  if (!config.ok) return res.status(503).json({ error: 'configuration_invalid', code: config.code });
  if (!GEMINI_KEY) return res.status(503).json({ error: 'assistant_not_configured' });
  const identity = await authenticatedOwnerIdentity(req, config);
  if (!identity.ok) return res.status(identity.status).json({ error: identity.code });
  try {
    const input = bodyOf(req);
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
