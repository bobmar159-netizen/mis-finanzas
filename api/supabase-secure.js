const { validateServerRouteConfig } = require('../lib/yarbi-runtime-config');
const { authenticateScopedOwner, blockedOwnerInput, scopedContact } = require('../lib/yarbi-authenticated-route');
let SUPABASE_URL = '';
let SUPABASE_SECRET_KEY = ''; // Configurado únicamente por el entorno validado.

async function supabaseRequest(path, options = {}) {
  const response = await fetch(SUPABASE_URL + path, {
    ...options,
    headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}`, ...(options.headers || {}) }
  });
  return { response, data: await response.json().catch(() => []) };
}

async function assertScopedMessages(ids, scope) {
  const rows = await supabaseRequest('/rest/v1/whatsapp_messages?id=in.(' + ids.map(encodeURIComponent).join(',') + ')&select=id,contact_id');
  if (!rows.response.ok || !Array.isArray(rows.data) || rows.data.length !== ids.length) return false;
  return rows.data.every(row => scopedContact(scope, row.contact_id));
}

export default async function handler(req, res) {
  // Configurar cabeceras CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const runtime = validateServerRouteConfig({ requirePublicAuth: true });
  if (!runtime.ok) return res.status(503).json({ error: 'configuration_invalid', code: runtime.code });
  SUPABASE_URL = runtime.supabaseUrl;
  SUPABASE_SECRET_KEY = runtime.supabaseKey;

  const access = await authenticateScopedOwner(req, runtime, supabaseRequest);
  if (!access.ok) return res.status(access.status).json({ error: access.code });

  const { action } = req.query;

  try {
    const payload = req.body;

    if (!payload) {
      return res.status(400).json({ error: 'Falta el cuerpo de la petición' });
    }
    if (blockedOwnerInput(payload)) return res.status(400).json({ error: 'owner_scope_client_input_forbidden' });

    if (action === 'delete' || action === 'restore') {
      const ids = Array.isArray(payload.ids) ? payload.ids.map(value => String(value || '').trim()).filter(value => /^[A-Za-z0-9_-]+$/.test(value)).slice(0, 500) : [];
      if (!ids.length) return res.status(400).json({ error: 'No hay IDs válidos' });
      if (!(await assertScopedMessages(ids, access.scope))) return res.status(403).json({ error: 'owner_scope_forbidden' });
      const query = ids.join(',');
      const restoring = action === 'restore';
      const stateFilter = restoring ? 'deleted_at=not.is.null' : 'deleted_at=is.null';
      const supaRes = await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_messages?id=in.(${query})&${stateFilter}`, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_SECRET_KEY,
          'Authorization': `Bearer ${SUPABASE_SECRET_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({ deleted_at: restoring ? null : new Date().toISOString() })
      });
      const changed = await supaRes.json().catch(() => []);
      if (!supaRes.ok) return res.status(supaRes.status).json({ error: restoring ? 'Error al restaurar en Supabase' : 'Error al archivar en Supabase', detail: changed });
      return res.status(200).json({
        status: 'success',
        mode: restoring ? 'restore' : 'soft_delete',
        restored: restoring && Array.isArray(changed) ? changed.length : 0,
        archived: !restoring && Array.isArray(changed) ? changed.length : 0,
        deleted: 0
      });
    } else if (action === 'import' || action === 'rules' || action === 'visual') {
      const items = Array.isArray(payload) ? payload : [payload];
      if (!items.length || !items.every(item => scopedContact(access.scope, item?.contact_id))) {
        return res.status(403).json({ error: 'owner_scope_forbidden' });
      }

      // Insertar en la tabla de Supabase usando la clave secreta segura
      const supaRes = await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_messages`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_SECRET_KEY,
          'Authorization': `Bearer ${SUPABASE_SECRET_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify(items)
      });

      if (supaRes.ok) {
        return res.status(200).json({ status: 'success', message: 'Datos guardados en Supabase de forma segura.' });
      } else {
        const errText = await supaRes.text();
        console.error('[SUPABASE SECURE ERROR]', errText);
        return res.status(supaRes.status).json({ error: 'Error al insertar en Supabase', detail: errText });
      }
    } else {
      return res.status(400).json({ error: 'Acción no válida' });
    }
  } catch (err) {
    console.error('[SUPABASE SECURE EXCEPTION]', err);
    return res.status(500).json({ error: err.message });
  }
}
