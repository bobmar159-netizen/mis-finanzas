'use strict';

// Superficie de lectura interactiva de WhatsApp. Está separada del webhook:
// los proveedores conservan sus firmas en /api/webhook y el navegador solo
// llega aquí con una sesión Supabase y alcance canónico de contactos.
const { validateServerRouteConfig } = require('../../lib/yarbi-runtime-config');
const { authenticateScopedOwner, blockedOwnerInput, scopedContact, scopedFilter } = require('../../lib/yarbi-authenticated-route');

function first(value) { return Array.isArray(value) ? value[0] : value; }
function cleanPhone(value) { return String(first(value) || '').replace(/\D/g, '').slice(0, 20); }
function timestamp(value) {
  const raw = String(first(value) || '').trim();
  if (!/^\d{1,16}$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
function limit(value) {
  const parsed = Number.parseInt(String(first(value) || ''), 10);
  return Math.min(Math.max(Number.isFinite(parsed) ? parsed : 50, 1), 5000);
}
function offset(value) {
  const parsed = Number.parseInt(String(first(value) || ''), 10);
  return Math.min(Math.max(Number.isFinite(parsed) ? parsed : 0, 0), 100000);
}

function serviceClient(config, fetchImpl) {
  return async (path, options = {}) => {
    const response = await fetchImpl(config.supabaseUrl + path, {
      ...options,
      headers: { apikey: config.supabaseKey, Authorization: `Bearer ${config.supabaseKey}`, ...(options.headers || {}) }
    });
    return { response, data: await response.json().catch(() => []) };
  };
}

function messageQuery(query, scope) {
  const contactFilter = scopedFilter(scope);
  if (!contactFilter) return null;
  const params = new URLSearchParams();
  params.set('select', 'id,contact_id,phone,title,text,maps_url,app_name,timestamp,created_at,deleted_at,metadata');
  params.set('contact_id', contactFilter);
  params.set('deleted_at', ['1', 'true', 'yes'].includes(String(first(query.include_deleted) || '').toLowerCase()) ? 'not.is.null' : 'is.null');
  const phone = cleanPhone(query.phone);
  const since = timestamp(query.since);
  const fromTimestamp = timestamp(query.from_timestamp);
  if (phone) params.set('phone', `eq.${phone}`);
  if (since !== null) params.set('timestamp', `gt.${since}`);
  if (fromTimestamp !== null) params.set('timestamp', `gte.${fromTimestamp}`);
  params.set('order', `timestamp.${String(first(query.order) || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc'}`);
  params.set('limit', String(limit(query.limit)));
  params.set('offset', String(offset(query.offset)));
  return '/rest/v1/whatsapp_messages?' + params.toString();
}

function createWhatsAppMessagesHandler({ configResolver = () => validateServerRouteConfig({ requirePublicAuth: true }), authenticate = authenticateScopedOwner, fetchImpl = fetch } = {}) {
  return async function whatsappMessagesHandler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
    const query = req.query || {};
    if (blockedOwnerInput(query)) return res.status(400).json({ error: 'owner_scope_client_input_forbidden' });
    if (String(first(query.action) || '').trim()) return res.status(410).json({ error: 'interactive_whatsapp_action_moved' });
    const config = configResolver();
    if (!config?.ok) return res.status(503).json({ error: 'configuration_invalid', code: config?.code || 'configuration_invalid' });
    const supabase = serviceClient(config, fetchImpl);
    const access = await authenticate(req, config, supabase, fetchImpl);
    if (!access?.ok) return res.status(access?.status || 403).json({ error: access?.code || 'owner_scope_forbidden' });
    const path = messageQuery(query, access.scope);
    if (!path) return res.status(200).json({ status: 'ok', source: 'supabase-backend', messages: [] });
    try {
      const result = await supabase(path);
      if (!result.response.ok) return res.status(result.response.status).json({ error: 'whatsapp_messages_unavailable' });
      const messages = Array.isArray(result.data) ? result.data.filter(row => scopedContact(access.scope, row?.contact_id)) : [];
      return res.status(200).json({ status: 'ok', source: 'supabase-backend', messages });
    } catch (_) {
      return res.status(502).json({ error: 'whatsapp_messages_unavailable' });
    }
  };
}

module.exports = createWhatsAppMessagesHandler();
module.exports.createWhatsAppMessagesHandler = createWhatsAppMessagesHandler;
module.exports.messageQuery = messageQuery;
