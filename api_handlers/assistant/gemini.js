'use strict';

// Pasarela acotada para las utilidades históricas del frontend. El navegador
// nunca conoce la clave maestra: sólo envía una solicitud limitada después de
// validar su sesión Supabase. No registra prompts, respuestas ni cabeceras.
const { validateServerRouteConfig } = require('../../lib/yarbi-runtime-config');
const { authenticatedOwnerIdentity } = require('../../lib/yarbi-owner-ui-auth');

const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GEMINI_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || process.env.GEMINI_CHAT_MODEL || 'gemini-3.5-flash-lite';
const MAX_TEXT = 16000;
const MAX_INLINE_BYTES = 3 * 1024 * 1024;

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
    const contents = sanitizeContents(input.contents);
    if (!contents) return res.status(400).json({ error: 'gemini_request_invalid' });
    const request = { contents, generationConfig: generationConfig(input.generationConfig) };
    const systemInstruction = input.system_instruction || input.systemInstruction;
    const systemParts = Array.isArray(systemInstruction?.parts) ? systemInstruction.parts.map(sanitizePart).filter(Boolean).slice(0, 4) : [];
    if (systemParts.length) request.system_instruction = { parts: systemParts };
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('[ASSISTANT GEMINI PROXY]', JSON.stringify({ status: response.status, category: 'provider_rejected' }));
      return res.status(502).json({ error: 'gemini_unavailable', provider_status: response.status });
    }
    return res.status(200).json({ candidates: Array.isArray(data.candidates) ? data.candidates : [] });
  } catch (_) {
    console.error('[ASSISTANT GEMINI PROXY]', JSON.stringify({ category: 'request_failed' }));
    return res.status(500).json({ error: 'gemini_proxy_failed' });
  }
};

module.exports.sanitizeContents = sanitizeContents;
module.exports.generationConfig = generationConfig;
