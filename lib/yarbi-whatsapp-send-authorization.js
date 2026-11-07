'use strict';

// A confirmation boolean from a browser is not an authorization.  This module
// creates a short-lived, server-signed authorization that binds one outbound
// operation to one owner, provider, recipient and immutable content digest.
// It deliberately never carries the recipient or message in clear text.
const crypto = require('node:crypto');

const PROVIDERS = new Set(['ycloud', 'meta_cloud']);
const MAX_TTL_MS = 10 * 60 * 1000;
const DEFAULT_TTL_MS = 5 * 60 * 1000;

function text(value, limit = 4096) { return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, limit); }
function key(value) { return typeof value === 'string' ? value : String(value ?? ''); }
function hmac(secret, value) { return crypto.createHmac('sha256', key(secret)).update(String(value), 'utf8').digest('hex'); }
function digest(secret, value) { return hmac(secret, JSON.stringify(value)); }
function b64(value) { return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url'); }
function unb64(value) { try { return JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8')); } catch (_) { return null; } }
function timingEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8'); const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function normalizePhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  const e164 = digits.length === 9 ? `51${digits}` : digits;
  return /^\d{8,15}$/.test(e164) ? e164 : '';
}
function normalizeProvider(value) { const result = text(value, 32).toLowerCase(); return PROVIDERS.has(result) ? result : ''; }
function normalizeType(value, mediaUrl) {
  if (!mediaUrl) return 'text';
  const type = text(value, 24).toLowerCase();
  return ['image', 'video', 'document'].includes(type) ? type : '';
}
function binding({ secret, provider, to, type, message, mediaUrl }) {
  const recipient = normalizePhone(to);
  const media = text(mediaUrl, 2048);
  const normalizedType = normalizeType(type, media);
  const normalizedProvider = normalizeProvider(provider);
  const normalizedMessage = text(message, 4096);
  if (!key(secret).trim() || !recipient || !normalizedProvider || !normalizedType || (!normalizedMessage && !media)) return null;
  return {
    provider: normalizedProvider,
    recipient_fingerprint: hmac(secret, `recipient:${recipient}`),
    content_fingerprint: digest(secret, { type: normalizedType, message: normalizedMessage, media_url: media || null }),
    type: normalizedType
  };
}

function createSendAuthorization({ secret, ownerId, provider, to, type, message, mediaUrl, operationId = crypto.randomUUID(), now = Date.now(), ttlMs = DEFAULT_TTL_MS } = {}) {
  const owner = text(ownerId, 100);
  const parsedTtl = Math.max(1, Math.min(Number(ttlMs) || DEFAULT_TTL_MS, MAX_TTL_MS));
  const requestBinding = binding({ secret, provider, to, type, message, mediaUrl });
  if (!owner || !requestBinding || !/^[0-9a-f-]{16,}$/i.test(text(operationId, 80))) return { ok: false, code: 'whatsapp_send_authorization_request_invalid' };
  const payload = {
    v: 1,
    operation_id: text(operationId, 80),
    owner_id: owner,
    provider: requestBinding.provider,
    recipient_fingerprint: requestBinding.recipient_fingerprint,
    content_fingerprint: requestBinding.content_fingerprint,
    type: requestBinding.type,
    issued_at: Math.floor(Number(now)),
    expires_at: Math.floor(Number(now) + parsedTtl)
  };
  const encoded = b64(payload);
  return { ok: true, authorization: payload, token: `${encoded}.${hmac(secret, encoded)}` };
}

function verifySendAuthorization({ token, secret, ownerId, provider, to, type, message, mediaUrl, now = Date.now() } = {}) {
  const [encoded, signature, extra] = text(token, 16000).split('.');
  if (!encoded || !signature || extra || !timingEqual(hmac(secret, encoded), signature)) return { ok: false, code: 'whatsapp_send_authorization_invalid' };
  const authorization = unb64(encoded);
  if (!authorization || authorization.v !== 1 || !authorization.operation_id || !authorization.owner_id) return { ok: false, code: 'whatsapp_send_authorization_invalid' };
  if (Number(now) > Number(authorization.expires_at) || Number(authorization.expires_at) <= Number(authorization.issued_at)) return { ok: false, code: 'whatsapp_send_authorization_expired' };
  const requestBinding = binding({ secret, provider, to, type, message, mediaUrl });
  if (!requestBinding || text(ownerId, 100) !== authorization.owner_id || authorization.provider !== requestBinding.provider || authorization.type !== requestBinding.type || !timingEqual(authorization.recipient_fingerprint, requestBinding.recipient_fingerprint) || !timingEqual(authorization.content_fingerprint, requestBinding.content_fingerprint)) return { ok: false, code: 'whatsapp_send_authorization_binding_mismatch' };
  return { ok: true, authorization, token_fingerprint: hmac(secret, `authorization:${token}`) };
}

module.exports = { DEFAULT_TTL_MS, MAX_TTL_MS, PROVIDERS, binding, createSendAuthorization, normalizePhone, verifySendAuthorization };
