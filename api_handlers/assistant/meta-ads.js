'use strict';

const crypto = require('node:crypto');
const { validateServerRouteConfig } = require('../../lib/yarbi-runtime-config');
const { authenticatedOwnerIdentity } = require('../../lib/yarbi-owner-ui-auth');
const { createOAuthState, decryptAccessToken, encryptAccessToken, graphUrl, hash, isPreviewMetaRedirectAllowed, normalizeInsight, normalizeMetaAdAccount, verifyOAuthState } = require('../../lib/yarbi-meta-marketing');

const API_VERSION = /^v\d+\.\d+$/.test(String(process.env.META_API_VERSION || 'v27.0')) ? String(process.env.META_API_VERSION || 'v27.0') : 'v27.0';
const ALLOWED_SCOPES = ['ads_read'];
const APP_ID = String(process.env.META_APP_ID || '').trim();
const APP_SECRET = String(process.env.META_APP_SECRET || '');
const STATE_SECRET = String(process.env.META_OAUTH_STATE_SECRET || '');
const ENCRYPTION_KEY = String(process.env.YARBI_VAULT_KEY || '');
const REDIRECT_URI = String(process.env.META_OAUTH_REDIRECT_URI || '').trim();
const OAUTH_CONFIG_ID = String(process.env.META_OAUTH_CONFIG_ID || '').trim();
const DB_URL = String(process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
const DB_KEY = String(process.env.SUPABASE_SECRET_KEY || '');
const PUBLISHABLE_KEY = String(process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '');
const PREVIEW_REF = 'uevilhbstnmmdlgyshlv';

function responseError(res, status, code) { return res.status(status).json({ ok: false, error: code }); }
function safeConfig() {
  if (process.env.VERCEL_ENV !== 'preview') return { ok: false, code: 'meta_ads_preview_only' };
  let databaseUrl;
  try { databaseUrl = new URL(DB_URL); } catch (_) { return { ok: false, code: 'meta_ads_preview_destination_not_authorized' }; }
  if (String(process.env.YARBI_PREVIEW_SUPABASE_PROJECT_REF || '').toLowerCase() !== PREVIEW_REF || databaseUrl.hostname !== `${PREVIEW_REF}.supabase.co`) return { ok: false, code: 'meta_ads_preview_destination_not_authorized' };
  if (!APP_ID || !APP_SECRET.trim() || STATE_SECRET.length < 32 || ENCRYPTION_KEY.length < 32 || !REDIRECT_URI || !/^\d{5,30}$/.test(OAUTH_CONFIG_ID)) return { ok: false, code: 'meta_ads_oauth_not_configured' };
  const expectedHost = String(process.env.YARBI_PREVIEW_DEPLOYMENT_HOST || '').trim().toLowerCase();
  if (!isPreviewMetaRedirectAllowed({ vercelEnv: process.env.VERCEL_ENV, expectedHost, branchUrl: process.env.VERCEL_BRANCH_URL, productionUrl: process.env.VERCEL_PROJECT_PRODUCTION_URL, redirectUri: REDIRECT_URI })) return { ok: false, code: 'meta_ads_redirect_uri_invalid' };
  const runtime = validateServerRouteConfig({ requirePublicAuth: true });
  if (!runtime.ok || runtime.supabaseUrl !== DB_URL || !runtime.supabasePublishableKey) return { ok: false, code: runtime.code || 'meta_ads_runtime_invalid' };
  return { ok: true, runtime };
}

async function db(path, options = {}) {
  return fetch(`${DB_URL}/rest/v1/${path}`, {
    ...options,
    headers: { apikey: DB_KEY, Authorization: `Bearer ${DB_KEY}`, ...(options.headers || {}) }
  });
}

async function owner(req, runtime) {
  return authenticatedOwnerIdentity(req, runtime);
}

function bearer(req) { return String(req?.headers?.authorization || req?.headers?.Authorization || '').replace(/^Bearer\s+/i, '').trim(); }

function metaGraphRequest(url, accessToken, method = 'GET') {
  const proof = crypto.createHmac('sha256', APP_SECRET).update(accessToken).digest('hex');
  const target = new URL(url);
  target.searchParams.delete('access_token');
  if (accessToken) target.searchParams.set('appsecret_proof', proof);
  return fetch(target, { method, headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} });
}

async function graphJson(url, accessToken) {
  const response = await metaGraphRequest(url, accessToken);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const error = new Error('meta_graph_request_failed');
    error.status = response.status;
    error.providerCode = String(data.error?.code || '');
    throw error;
  }
  return data;
}

function nextGraphUrl(value) {
  try {
    const next = new URL(value);
    if (next.protocol !== 'https:' || next.hostname !== 'graph.facebook.com' || !next.pathname.startsWith(`/${API_VERSION}/`)) return null;
    return next;
  } catch (_) { return null; }
}

async function collectPages(url, accessToken, maxPages = 20) {
  const items = [];
  let current = new URL(url);
  let pages = 0;
  for (let page = 0; current && page < maxPages; page += 1) {
    const result = await graphJson(current, accessToken);
    if (Array.isArray(result.data)) items.push(...result.data);
    current = result.paging?.next ? nextGraphUrl(result.paging.next) : null;
    pages += 1;
  }
  return { items, pages, pagesCapped: Boolean(current) };
}

async function readConnection(ownerId) {
  const response = await db(`yarbi_meta_connections?owner_id=eq.${encodeURIComponent(ownerId)}&select=owner_id,token_ciphertext,token_expires_at,scopes,selected_ad_account_id,last_insights_sync_at,last_insights_sync_pages,last_insights_sync_pages_capped,connected_at,updated_at,revoked_at&limit=1`);
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error('meta_connection_read_failed');
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function readOwnerSettings(ownerId) {
  const response = await db(`yarbi_meta_owner_settings?owner_id=eq.${encodeURIComponent(ownerId)}&select=weekly_budget_amount,weekly_budget_currency,updated_at&limit=1`);
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error('meta_owner_settings_read_failed');
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function accessTokenFor(connection, ownerId) {
  if (!connection || connection.revoked_at || !connection.token_ciphertext) return '';
  if (connection.token_expires_at && Date.parse(connection.token_expires_at) <= Date.now()) {
    const error = new Error('meta_reauthorization_required');
    error.status = 409;
    throw error;
  }
  return decryptAccessToken(connection.token_ciphertext, { key: ENCRYPTION_KEY, ownerId });
}

async function listAndStoreAccounts(ownerId, accessToken) {
  const url = graphUrl('me/adaccounts', { fields: 'id,name,account_status,currency,timezone_name', limit: 100 }, API_VERSION);
  const pageResult = await collectPages(url, accessToken, 10);
  const accounts = pageResult.items.map(normalizeMetaAdAccount).filter(Boolean);
  if (accounts.length) {
    const response = await db('yarbi_meta_ad_accounts?on_conflict=owner_id,ad_account_id', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(accounts.map(account => ({ owner_id: ownerId, ...account, synced_at: new Date().toISOString() })))
    });
    if (!response.ok) throw new Error('meta_ad_accounts_store_failed');
  }
  return { accounts, pagesCapped: pageResult.pagesCapped };
}

function validDate(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
}
function daysBetween(start, stop) { return Math.ceil((Date.parse(`${stop}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000); }
function limaDate(value = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value); }
function insightsStartForSync(connection) {
  if (!connection?.last_insights_sync_at || connection.last_insights_sync_pages_capped) return limaDate(new Date(Date.now() - 29 * 86400000));
  const latest = new Date(connection.last_insights_sync_at);
  if (!Number.isFinite(latest.getTime())) return limaDate(new Date(Date.now() - 29 * 86400000));
  latest.setUTCDate(latest.getUTCDate() - 3);
  return limaDate(latest);
}

async function callback(req, res, config) {
  const params = req.query || {};
  if (params.error || params.error_reason || params.error_code) return res.status(400).send('No se autorizó la conexión Meta. Puedes cerrar esta ventana e intentarlo desde Yarbi.');
  const rawState = String(params.state || '');
  const verified = verifyOAuthState(rawState, { secret: STATE_SECRET });
  if (!verified.ok || !params.code) return res.status(400).send('La autorización Meta expiró o no es válida. Inicia la conexión desde Yarbi.');
  const stateHash = hash(rawState);
  const claimed = await db(`yarbi_meta_oauth_states?state_hash=eq.${stateHash}&owner_id=eq.${encodeURIComponent(verified.ownerId)}&consumed_at=is.null&expires_at=gt.${encodeURIComponent(new Date().toISOString())}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ consumed_at: new Date().toISOString() })
  });
  const claimedRows = await claimed.json().catch(() => []);
  if (!claimed.ok || !Array.isArray(claimedRows) || claimedRows.length !== 1) return res.status(400).send('La autorización ya fue usada o expiró. Inicia una nueva conexión desde Yarbi.');

  const codeParams = { client_id: APP_ID, client_secret: APP_SECRET, redirect_uri: REDIRECT_URI, code: String(params.code) };
  const shortToken = await graphJson(graphUrl('oauth/access_token', codeParams, API_VERSION), '');
  if (!shortToken.access_token) return res.status(502).send('Meta no completó la autorización.');
  const longToken = await graphJson(graphUrl('oauth/access_token', { grant_type: 'fb_exchange_token', client_id: APP_ID, client_secret: APP_SECRET, fb_exchange_token: shortToken.access_token }, API_VERSION), shortToken.access_token);
  const accessToken = String(longToken.access_token || shortToken.access_token);
  if (!accessToken) return res.status(502).send('Meta no entregó una sesión válida.');
  const permissions = await graphJson(graphUrl('me/permissions', {}, API_VERSION), accessToken);
  const granted = (Array.isArray(permissions.data) ? permissions.data : []).filter(item => item.status === 'granted').map(item => String(item.permission));
  if (!granted.includes('ads_read')) return res.status(403).send('Meta no concedió el permiso de lectura ads_read. Revoca y vuelve a conectar con el permiso mínimo solicitado.');
  const accountResult = await listAndStoreAccounts(verified.ownerId, accessToken);
  const tokenExpiresAt = Number(longToken.expires_in || shortToken.expires_in) > 0 ? new Date(Date.now() + Number(longToken.expires_in || shortToken.expires_in) * 1000).toISOString() : null;
  const connection = {
    owner_id: verified.ownerId,
    token_ciphertext: encryptAccessToken(accessToken, { key: ENCRYPTION_KEY, ownerId: verified.ownerId }),
    token_expires_at: tokenExpiresAt,
    scopes: granted,
    selected_ad_account_id: null,
    connected_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    revoked_at: null
  };
  const stored = await db('yarbi_meta_connections?on_conflict=owner_id', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(connection) });
  if (!stored.ok) throw new Error('meta_connection_store_failed');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Meta conectado</title><body style="font:16px system-ui;max-width:34rem;margin:15vh auto;padding:1rem;color:#172033"><h1>Conexión Meta guardada</h1><p>Yarbi recibió permiso de lectura ads_read. Se encontraron ${accountResult.accounts.length} cuenta(s) publicitaria(s)${accountResult.pagesCapped ? '; la lista de cuentas requiere otra consulta' : ''}.</p><p>Regresa a Yarbi para elegir la cuenta y sincronizar métricas.</p><script>setTimeout(()=>window.close(),1200)</script></body></html>`);
}

async function handle(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const previewOrigin = `https://${String(process.env.YARBI_PREVIEW_DEPLOYMENT_HOST || '').trim().toLowerCase()}`;
  if (req.headers?.origin === previewOrigin && previewOrigin !== 'https://') res.setHeader('Access-Control-Allow-Origin', previewOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const config = safeConfig();
  if (!config.ok) return responseError(res, 503, config.code);
  const action = String(req.query?.action || '').trim();
  try {
    if (action === 'callback' && req.method === 'GET') return await callback(req, res, config);
    if (!['GET', 'POST'].includes(req.method)) return responseError(res, 405, 'method_not_allowed');
    const authenticated = await owner(req, config.runtime);
    if (!authenticated.ok) return responseError(res, authenticated.status, authenticated.code);
    const ownerId = authenticated.user.id;

    if (action === 'save-budget' && req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const amount = Number(body.weekly_budget_amount);
      if (!Number.isFinite(amount) || amount < 0 || amount > 1000000 || !/^\d{1,8}(?:\.\d{1,2})?$/.test(String(body.weekly_budget_amount))) return responseError(res, 400, 'meta_weekly_budget_invalid');
      const row = { owner_id: ownerId, weekly_budget_amount: Number(amount.toFixed(2)), weekly_budget_currency: 'PEN', updated_at: new Date().toISOString() };
      const saved = await db('yarbi_meta_owner_settings?on_conflict=owner_id', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(row) });
      return saved.ok ? res.status(200).json({ ok: true, weekly_budget_amount: row.weekly_budget_amount, weekly_budget_currency: 'PEN' }) : responseError(res, 502, 'meta_weekly_budget_save_failed');
    }

    if (action === 'connect' && req.method === 'POST') {
      const state = createOAuthState({ ownerId, secret: STATE_SECRET });
      const verifiedState = verifyOAuthState(state, { secret: STATE_SECRET });
      const stored = await db('yarbi_meta_oauth_states', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ state_hash: hash(state), owner_id: ownerId, expires_at: verifiedState.expiresAt }) });
      if (!stored.ok) return responseError(res, 502, 'meta_oauth_state_store_failed');
      const url = new URL(`https://www.facebook.com/${API_VERSION}/dialog/oauth`);
      url.searchParams.set('client_id', APP_ID);
      url.searchParams.set('redirect_uri', REDIRECT_URI);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('config_id', OAUTH_CONFIG_ID);
      url.searchParams.set('state', state);
      return res.status(200).json({ ok: true, authorization_url: url.toString(), permissions: ALLOWED_SCOPES });
    }

    const connection = await readConnection(ownerId);
    if (action === 'status' && req.method === 'GET') {
      const settings = await readOwnerSettings(ownerId);
      const accountsResponse = await db(`yarbi_meta_ad_accounts?owner_id=eq.${encodeURIComponent(ownerId)}&select=ad_account_id,name,currency,timezone_name,account_status,synced_at&order=name.asc`);
      const accounts = await accountsResponse.json().catch(() => []);
      if (!accountsResponse.ok) return responseError(res, 502, 'meta_accounts_read_failed');
      const expired = Boolean(connection?.token_expires_at && Date.parse(connection.token_expires_at) <= Date.now());
      return res.status(200).json({ ok: true, connected: Boolean(connection && !connection.revoked_at && connection.token_ciphertext), needs_reauthorization: expired, scopes: connection?.scopes || [], token_expires_at: connection?.token_expires_at || null, selected_ad_account_id: connection?.selected_ad_account_id || null, last_insights_sync_at: connection?.last_insights_sync_at || null, last_insights_sync_pages: connection?.last_insights_sync_pages || 0, insights_sync_partial: Boolean(connection?.last_insights_sync_pages_capped), weekly_budget_amount: Number(settings?.weekly_budget_amount ?? 200), weekly_budget_currency: settings?.weekly_budget_currency || 'PEN', accounts });
    }

    if (action === 'disconnect' && req.method === 'POST') {
      let providerRevoked = false;
      try {
        if (connection && !connection.revoked_at && connection.token_ciphertext) {
          const accessToken = await accessTokenFor(connection, ownerId);
          const revokeUrl = graphUrl('me/permissions', {}, API_VERSION);
          const revokeResponse = await metaGraphRequest(revokeUrl, accessToken, 'DELETE');
          const revokeBody = await revokeResponse.json().catch(() => ({}));
          providerRevoked = revokeResponse.ok && revokeBody.success !== false;
        }
      } catch (_) { providerRevoked = false; }
      const result = await db(`yarbi_meta_connections?owner_id=eq.${encodeURIComponent(ownerId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ token_ciphertext: {}, scopes: [], selected_ad_account_id: null, revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
      return result.ok ? res.status(200).json({ ok: true, disconnected: true, provider_revoked: providerRevoked }) : responseError(res, 502, 'meta_disconnect_failed');
    }

    if (action === 'select-account' && req.method === 'POST') {
      if (!connection || connection.revoked_at) return responseError(res, 409, 'meta_ads_not_connected');
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const accountId = String(body.ad_account_id || '').trim();
      const accountLookup = await db(`yarbi_meta_ad_accounts?owner_id=eq.${encodeURIComponent(ownerId)}&ad_account_id=eq.${encodeURIComponent(accountId)}&select=ad_account_id&limit=1`);
      const rows = await accountLookup.json().catch(() => []);
      if (!/^act_\d{4,32}$/.test(accountId) || !accountLookup.ok || !rows.length) return responseError(res, 400, 'meta_ad_account_not_owned');
      const saved = await db(`yarbi_meta_connections?owner_id=eq.${encodeURIComponent(ownerId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ selected_ad_account_id: accountId, updated_at: new Date().toISOString() }) });
      return saved.ok ? res.status(200).json({ ok: true, selected_ad_account_id: accountId }) : responseError(res, 502, 'meta_ad_account_save_failed');
    }

    if (action === 'sync' && req.method === 'POST') {
      if (!connection || connection.revoked_at || !connection.selected_ad_account_id) return responseError(res, 409, 'meta_ad_account_not_selected');
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const until = String(body.until || limaDate());
      const since = String(body.since || insightsStartForSync(connection));
      if (!validDate(since) || !validDate(until) || daysBetween(since, until) < 0 || daysBetween(since, until) > 92) return responseError(res, 400, 'meta_insights_range_invalid');
      const accessToken = await accessTokenFor(connection, ownerId);
      const insightsUrl = graphUrl(`${connection.selected_ad_account_id}/insights`, {
        level: 'ad',
        fields: 'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,date_start,date_stop,spend,impressions,clicks,actions,cost_per_action_type',
        time_range: JSON.stringify({ since, until }),
        time_increment: 1,
        limit: 500
      }, API_VERSION);
      const pageResult = await collectPages(insightsUrl, accessToken, 20);
      const rows = pageResult.items.map(row => normalizeInsight(row, connection.selected_ad_account_id, ownerId)).filter(Boolean);
      if (rows.length) {
        const saved = await db('yarbi_meta_insights_daily?on_conflict=owner_id,ad_account_id,date_start,ad_id', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows) });
        if (!saved.ok) return responseError(res, 502, 'meta_insights_store_failed');
      }
      const syncStamp = new Date().toISOString();
      const syncSaved = await db(`yarbi_meta_connections?owner_id=eq.${encodeURIComponent(ownerId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ last_insights_sync_at: syncStamp, last_insights_sync_pages: pageResult.pages, last_insights_sync_pages_capped: pageResult.pagesCapped, updated_at: syncStamp }) });
      if (!syncSaved.ok) return responseError(res, 502, 'meta_sync_cursor_store_failed');
      return res.status(200).json({ ok: true, source: 'meta_marketing_api', api_version: API_VERSION, ad_account_id: connection.selected_ad_account_id, since, until, synced_rows: rows.length, pages: pageResult.pages, pages_capped: pageResult.pagesCapped });
    }

    if (action === 'insights' && req.method === 'GET') {
      if (!connection?.selected_ad_account_id || connection.revoked_at) return responseError(res, 409, 'meta_ad_account_not_selected');
      const since = String(req.query?.since || limaDate(new Date(Date.now() - 29 * 86400000)));
      const until = String(req.query?.until || limaDate());
      if (!validDate(since) || !validDate(until) || daysBetween(since, until) < 0 || daysBetween(since, until) > 92) return responseError(res, 400, 'meta_insights_range_invalid');
      const result = await db(`yarbi_meta_insights_daily?owner_id=eq.${encodeURIComponent(ownerId)}&ad_account_id=eq.${encodeURIComponent(connection.selected_ad_account_id)}&date_start=gte.${since}&date_start=lte.${until}&select=date_start,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,actions,cost_per_action_type,synced_at&order=date_start.asc&limit=10000`);
      const insights = await result.json().catch(() => []);
      if (!result.ok) return responseError(res, 502, 'meta_insights_read_failed');
      const totals = insights.reduce((sum, row) => ({ spend: sum.spend + Number(row.spend || 0), impressions: sum.impressions + Number(row.impressions || 0), clicks: sum.clicks + Number(row.clicks || 0) }), { spend: 0, impressions: 0, clicks: 0 });
      return res.status(200).json({ ok: true, source: 'meta_marketing_api', ad_account_id: connection.selected_ad_account_id, since, until, totals, insights, partial: Boolean(connection.last_insights_sync_pages_capped), last_sync_pages: connection.last_insights_sync_pages || 0 });
    }
    return responseError(res, 400, 'meta_ads_action_invalid');
  } catch (error) {
    console.warn('[YARBI META ADS]', String(error?.providerCode || error?.message || 'meta_ads_operation_failed').slice(0, 80));
    return responseError(res, error?.status === 429 ? 429 : (error?.status === 409 ? 409 : 502), error?.status === 429 ? 'meta_rate_limited' : (error?.status === 409 ? 'meta_reauthorization_required' : 'meta_ads_operation_failed'));
  }
}

module.exports = handle;
