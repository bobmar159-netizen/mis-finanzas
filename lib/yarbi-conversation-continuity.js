'use strict';

const crypto = require('node:crypto');

const SCHEMA = 'yarbi.owner-conversation-token.v1';
const MAX_AGE_MS = 20 * 60 * 1000;
const OWNER = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function plain(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function b64(value) { return Buffer.from(value).toString('base64url'); }
function fromB64(value) { try { return JSON.parse(Buffer.from(String(value || ''), 'base64url').toString('utf8')); } catch (_) { return null; } }
function sign(payload, secret) { return crypto.createHmac('sha256', String(secret || '')).update(payload).digest('base64url'); }
function safeState(value) {
  const input = plain(value) ? value : {};
  const constraints = plain(input.active_constraints) ? input.active_constraints : {};
  const accepted = {};
  for (const key of ['name', 'district', 'service', 'location', 'recency']) {
    const item = plain(constraints[key]) ? constraints[key] : null;
    if (!item) continue;
    const text = String(item.value || '').trim().slice(0, 120);
    const days = Number.isFinite(Number(item.days)) ? Math.max(0, Math.min(3650, Number(item.days))) : undefined;
    const dayPart = ['morning', 'afternoon', 'night'].includes(String(item.day_part || '')) ? item.day_part : undefined;
    if (text || days !== undefined || dayPart) accepted[key] = { ...(text ? { value: text } : {}), ...(days !== undefined ? { days } : {}), ...(dayPart ? { day_part: dayPart } : {}) };
  }
  return { task: String(input.task || '').trim().slice(0, 80) || null, intent: String(input.intent || '').trim().slice(0, 80) || null, active_constraints: accepted };
}
function safeCandidates(value) { return [...new Set((Array.isArray(value) ? value : []).map(item => Number(item?.contact_id || item)).filter(id => Number.isSafeInteger(id) && id > 0))].slice(0, 12); }

function createConversationToken({ ownerId, state, candidateIds, secret, now = Date.now() } = {}) {
  if (!OWNER.test(String(ownerId || '')) || String(secret || '').length < 32) return null;
  const payload = b64(JSON.stringify({ schema: SCHEMA, owner_id: String(ownerId).toLowerCase(), issued_at: Number(now), state: safeState(state), candidate_ids: safeCandidates(candidateIds) }));
  return `${payload}.${sign(payload, secret)}`;
}

function readConversationToken({ token, ownerId, secret, now = Date.now() } = {}) {
  const [payload, signature, extra] = String(token || '').split('.');
  if (!payload || !signature || extra || !OWNER.test(String(ownerId || '')) || String(secret || '').length < 32) return { ok: false, code: 'conversation_token_invalid' };
  const expected = sign(payload, secret);
  if (expected.length !== signature.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return { ok: false, code: 'conversation_token_invalid' };
  const value = fromB64(payload);
  if (!plain(value) || value.schema !== SCHEMA || value.owner_id !== String(ownerId).toLowerCase() || !Number.isFinite(Number(value.issued_at)) || Number(now) - Number(value.issued_at) > MAX_AGE_MS || Number(value.issued_at) > Number(now) + 60_000) return { ok: false, code: 'conversation_token_expired' };
  return { ok: true, state: safeState(value.state), candidate_ids: safeCandidates(value.candidate_ids) };
}

module.exports = { SCHEMA, MAX_AGE_MS, createConversationToken, readConversationToken, safeState, safeCandidates };
