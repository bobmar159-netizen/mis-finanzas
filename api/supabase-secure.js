const { validateServerRouteConfig } = require('../lib/yarbi-runtime-config');
let SUPABASE_URL = '';
let SUPABASE_SECRET_KEY = ''; // Configurado únicamente por el entorno validado.

export default async function handler(req, res) {
  // Configurar cabeceras CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Assistant-Token');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const header = req.headers?.['x-assistant-token'] || req.headers?.authorization || '';
  const token = String(header).replace(/^Bearer\s+/i, '').trim();
  const expected = process.env.ASSISTANT_API_TOKEN || process.env.TOKEN_API_DE_ASISTENTE || '';
  if (!expected || token !== expected) return res.status(401).json({ error: 'No autorizado' });

  const runtime = validateServerRouteConfig();
  if (!runtime.ok) return res.status(503).json({ error: 'configuration_invalid', code: runtime.code });
  SUPABASE_URL = runtime.supabaseUrl;
  SUPABASE_SECRET_KEY = runtime.supabaseKey;

  const { action } = req.query;

  try {
    const payload = req.body;

    if (!payload) {
      return res.status(400).json({ error: 'Falta el cuerpo de la petición' });
    }

    if (action === 'delete' || action === 'restore') {
      const header = req.headers?.['x-assistant-token'] || req.headers?.authorization || '';
      const token = String(header).replace(/^Bearer\s+/i, '').trim();
      const expected = process.env.ASSISTANT_API_TOKEN || process.env.TOKEN_API_DE_ASISTENTE || '';
      const ids = Array.isArray(payload.ids) ? payload.ids.map(value => String(value || '').trim()).filter(value => /^[A-Za-z0-9_-]+$/.test(value)).slice(0, 500) : [];
      if (!expected || token !== expected) return res.status(401).json({ error: 'No autorizado' });
      if (!ids.length) return res.status(400).json({ error: 'No hay IDs válidos' });
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
