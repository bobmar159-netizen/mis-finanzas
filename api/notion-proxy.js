const { validateServerRouteConfig } = require('../lib/yarbi-runtime-config');
const { authenticateScopedOwner, blockedOwnerInput, scopedContact } = require('../lib/yarbi-authenticated-route');

function cleanMethod(value) {
  const method = String(value || 'GET').toUpperCase();
  return ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(method) ? method : null;
}

function approvedNotionUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.hostname !== 'api.notion.com' || !url.pathname.startsWith('/v1/')) return null;
    return url;
  } catch (_) { return null; }
}

function numeric(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function serviceClient(config, fetchImpl) {
  return async path => {
    const response = await fetchImpl(config.supabaseUrl + path, { headers: { apikey: config.supabaseKey, Authorization: `Bearer ${config.supabaseKey}` } });
    return { response, data: await response.json().catch(() => []) };
  };
}

function createNotionProxyHandler({ configResolver = () => validateServerRouteConfig({ requirePublicAuth: true }), authenticate = authenticateScopedOwner, fetchImpl = fetch, env = process.env } = {}) {
  return async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Notion-Version');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body || '{}'); } catch (_) { return null; } })() : (req.body || {});
    if (!body || blockedOwnerInput(body)) return res.status(400).json({ error: 'owner_scope_client_input_forbidden' });
    // El navegador nunca puede suministrar ni reenviar una clave de Notion.
    if (body.headers?.Authorization || body.headers?.authorization) return res.status(400).json({ error: 'notion_client_credential_forbidden' });
    const target = approvedNotionUrl(body.url);
    const method = cleanMethod(body.method);
    if (!target || !method) return res.status(400).json({ error: 'notion_request_invalid' });
    const config = configResolver();
    if (!config?.ok) return res.status(503).json({ error: 'configuration_invalid', code: config?.code || 'configuration_invalid' });
    const access = await authenticate(req, config, serviceClient(config, fetchImpl), fetchImpl);
    if (!access?.ok) return res.status(access?.status || 403).json({ error: access?.code || 'owner_scope_forbidden' });
    // No existe una relación canónica que asocie recursos Notion a un dueño.
    // Exigimos un contacto dentro del scope y fallamos cerrados hasta que exista
    // esa proyección, antes que reutilizar un token compartido contra datos no
    // atribuibles al propietario autenticado.
    const contactId = numeric(body.contact_id);
    if (!contactId || !scopedContact(access.scope, contactId)) return res.status(403).json({ error: 'notion_owner_scope_required' });
    if (!String(env.NOTION_TOKEN || '').trim()) return res.status(503).json({ error: 'notion_server_configuration_missing' });
    return res.status(424).json({ error: 'notion_contact_projection_unavailable' });
  };
}

module.exports = createNotionProxyHandler();
module.exports.createNotionProxyHandler = createNotionProxyHandler;
