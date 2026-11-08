'use strict';

// Los borradores solo son visibles si el esquema aporta contact_id canónico.
// El esquema legado basado en clients no se puede asociar de forma verificable
// a un propietario autenticado; se rechaza cerrado antes que filtrar mal.
const { validateServerRouteConfig } = require('../../lib/yarbi-runtime-config');
const { authenticateScopedOwner, blockedOwnerInput, scopedFilter, scopedContact } = require('../../lib/yarbi-authenticated-route');

function serviceClient(config, fetchImpl) {
  return async (path, options = {}) => {
    const response = await fetchImpl(config.supabaseUrl + path, { ...options, headers: { apikey: config.supabaseKey, Authorization: `Bearer ${config.supabaseKey}`, ...(options.headers || {}) } });
    return { response, data: await response.json().catch(() => []) };
  };
}

function createDraftsHandler({ configResolver = () => validateServerRouteConfig({ requirePublicAuth: true }), authenticate = authenticateScopedOwner, fetchImpl = fetch } = {}) {
  return async function draftsHandler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
    if (blockedOwnerInput(req.query || {})) return res.status(400).json({ error: 'owner_scope_client_input_forbidden' });
    const config = configResolver();
    if (!config?.ok) return res.status(503).json({ error: 'configuration_invalid', code: config?.code || 'configuration_invalid' });
    const supabase = serviceClient(config, fetchImpl);
    const access = await authenticate(req, config, supabase, fetchImpl);
    if (!access?.ok) return res.status(access?.status || 403).json({ error: access?.code || 'owner_scope_forbidden' });
    const filter = scopedFilter(access.scope);
    if (!filter) return res.status(200).json({ status: 'ok', drafts: [] });
    const path = '/rest/v1/draft_actions?status=eq.pending_review&contact_id=' + encodeURIComponent(filter) + '&select=id,contact_id,type,status,payload,created_at,updated_at&order=created_at.desc&limit=100';
    try {
      const result = await supabase(path);
      // PostgreSQL devuelve 42703/PGRST cuando el contrato heredado no tiene
      // contact_id. Nunca se sustituye por clients(*) porque abriría datos de
      // otro propietario durante la transición.
      if (!result.response.ok) return res.status(424).json({ error: 'draft_scope_schema_unavailable' });
      const drafts = Array.isArray(result.data) ? result.data.filter(row => scopedContact(access.scope, row?.contact_id)) : [];
      return res.status(200).json({ status: 'ok', drafts });
    } catch (_) {
      return res.status(424).json({ error: 'draft_scope_schema_unavailable' });
    }
  };
}

module.exports = createDraftsHandler();
module.exports.createDraftsHandler = createDraftsHandler;
