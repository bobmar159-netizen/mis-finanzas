'use strict';

const crypto = require('node:crypto');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GRAPH_HOST = 'graph.facebook.com';

function hash(value) { return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex'); }
function hmac(secret, value) { return crypto.createHmac('sha256', String(secret)).update(String(value), 'utf8').digest('base64url'); }
function constantEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createOAuthState({ ownerId, secret, now = Date.now(), nonce = crypto.randomBytes(24).toString('base64url') } = {}) {
  if (!UUID.test(String(ownerId || '')) || !String(secret || '').trim()) throw new Error('meta_oauth_state_configuration_invalid');
  const payload = Buffer.from(JSON.stringify({ v: 1, owner_id: ownerId, iat: now, exp: now + 10 * 60 * 1000, nonce })).toString('base64url');
  return `${payload}.${hmac(secret, payload)}`;
}

function verifyOAuthState(value, { secret, now = Date.now() } = {}) {
  const [payload, signature, extra] = String(value || '').split('.');
  if (!payload || !signature || extra || !constantEqual(hmac(secret || '', payload), signature)) return { ok: false, code: 'meta_oauth_state_invalid' };
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (data.v !== 1 || !UUID.test(String(data.owner_id || '')) || !/^[A-Za-z0-9_-]{24,80}$/.test(data.nonce || '') || !Number.isFinite(data.iat) || !Number.isFinite(data.exp)) return { ok: false, code: 'meta_oauth_state_invalid' };
    if (data.iat > now + 30000 || data.exp <= now || data.exp - data.iat > 10 * 60 * 1000) return { ok: false, code: 'meta_oauth_state_expired' };
    return { ok: true, ownerId: data.owner_id, nonce: data.nonce, expiresAt: new Date(data.exp).toISOString() };
  } catch (_) { return { ok: false, code: 'meta_oauth_state_invalid' }; }
}

function encryptAccessToken(token, { key, ownerId, now = new Date().toISOString() } = {}) {
  if (!String(token || '') || !String(key || '').trim() || !UUID.test(String(ownerId || ''))) throw new Error('meta_token_encryption_configuration_invalid');
  const encryptionKey = crypto.createHash('sha256').update(String(key), 'utf8').digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  cipher.setAAD(Buffer.from(`yarbi-meta-marketing-v1:${ownerId}`, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(String(token), 'utf8'), cipher.final()]);
  return { version: 1, algorithm: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: ciphertext.toString('base64'), updated_at: now };
}

function decryptAccessToken(payload, { key, ownerId } = {}) {
  if (payload?.version !== 1 || payload?.algorithm !== 'aes-256-gcm' || !key || !UUID.test(String(ownerId || ''))) throw new Error('meta_token_ciphertext_invalid');
  const encryptionKey = crypto.createHash('sha256').update(String(key), 'utf8').digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(payload.iv, 'base64'));
  decipher.setAAD(Buffer.from(`yarbi-meta-marketing-v1:${ownerId}`, 'utf8'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(payload.data, 'base64')), decipher.final()]).toString('utf8');
}

function graphUrl(path, params = {}, version = 'v27.0') {
  if (!/^v\d+\.\d+$/.test(version)) throw new Error('meta_api_version_invalid');
  const url = new URL(`https://${GRAPH_HOST}/${version}/${String(path || '').replace(/^\/+/, '')}`);
  Object.entries(params).forEach(([key, value]) => { if (value !== undefined && value !== null) url.searchParams.set(key, String(value)); });
  return url;
}

function isPreviewMetaRedirectAllowed({ vercelEnv, expectedHost, branchUrl, productionUrl, redirectUri } = {}) {
  const normalizedHost = value => String(value || '').trim().toLowerCase().replace(/\.$/, '');
  const expected = normalizedHost(expectedHost);
  const branch = normalizedHost(branchUrl);
  const production = normalizedHost(productionUrl);
  let redirect;
  try { redirect = new URL(String(redirectUri || '')); } catch (_) { return false; }
  return String(vercelEnv || '') === 'preview'
    && Boolean(expected)
    && Boolean(branch)
    && expected === branch
    && expected !== production
    && redirect.protocol === 'https:'
    && normalizedHost(redirect.hostname) === expected
    && redirect.pathname === '/api/assistant/meta-ads'
    && redirect.search === '?action=callback';
}

function normalizeMetaAdAccount(value) {
  if (!value || typeof value !== 'object') return null;
  const id = String(value.id || '').replace(/^act_/, '').trim();
  if (!/^\d{4,32}$/.test(id)) return null;
  return { ad_account_id: `act_${id}`, name: String(value.name || `Cuenta act_${id}`).slice(0, 240), currency: String(value.currency || '').slice(0, 12) || null, timezone_name: String(value.timezone_name || '').slice(0, 80) || null, account_status: Number.isInteger(Number(value.account_status)) ? Number(value.account_status) : null };
}

function normalizeInsight(row, accountId, ownerId) {
  const adId = String(row?.ad_id || '').trim();
  const date = String(row?.date_start || '').trim();
  const spend = Number(row?.spend || 0);
  const impressions = Number(row?.impressions || 0);
  const clicks = Number(row?.clicks || 0);
  if (!/^\d{1,32}$/.test(adId) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || ![spend, impressions, clicks].every(Number.isFinite) || spend < 0 || impressions < 0 || clicks < 0) return null;
  return {
    owner_id: ownerId,
    ad_account_id: accountId,
    date_start: date,
    date_stop: String(row.date_stop || date).slice(0, 10),
    campaign_id: String(row.campaign_id || '').slice(0, 64) || null,
    campaign_name: String(row.campaign_name || '').slice(0, 240) || null,
    adset_id: String(row.adset_id || '').slice(0, 64) || null,
    adset_name: String(row.adset_name || '').slice(0, 240) || null,
    ad_id: adId,
    ad_name: String(row.ad_name || '').slice(0, 240) || null,
    spend: Number(spend.toFixed(2)),
    impressions: Math.trunc(impressions),
    clicks: Math.trunc(clicks),
    actions: Array.isArray(row.actions) ? row.actions : [],
    cost_per_action_type: Array.isArray(row.cost_per_action_type) ? row.cost_per_action_type : [],
    synced_at: new Date().toISOString()
  };
}

module.exports = { GRAPH_HOST, constantEqual, createOAuthState, decryptAccessToken, encryptAccessToken, graphUrl, hash, isPreviewMetaRedirectAllowed, normalizeInsight, normalizeMetaAdAccount, verifyOAuthState };
