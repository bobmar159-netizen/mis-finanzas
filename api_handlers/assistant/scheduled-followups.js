const { validateServerRouteConfig } = require('../../lib/yarbi-runtime-config');
let SUPABASE_URL = '';
let SUPABASE_KEY = '';
const ASSISTANT_TOKEN = process.env.ASSISTANT_API_TOKEN || process.env.TOKEN_API_DE_ASISTENTE || '';
const CRON_SECRET = process.env.CRON_SECRET || '';
let BASE_URL = '';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.APP_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Assistant-Token');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function tokenFrom(req) {
  return String(req.headers?.['x-assistant-token'] || req.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim();
}

function assistantAuthorized(req) {
  const token = tokenFrom(req);
  return Boolean(ASSISTANT_TOKEN && token && token === ASSISTANT_TOKEN);
}

function cronAuthorized(req) {
  const token = tokenFrom(req);
  return Boolean(CRON_SECRET && token && token === CRON_SECRET);
}

function cleanPhone(value) {
  let phone = String(value || '').replace(/\D/g, '');
  if (phone.startsWith('51') && phone.length === 11) phone = phone.slice(2);
  return phone;
}

function supabaseHeaders(extra = {}) {
  return { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json', ...extra };
}

async function supabaseJson(path, options = {}) {
  const response = await fetch(SUPABASE_URL + path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.message || data?.hint || 'Supabase HTTP ' + response.status);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function updateScheduled(id, status, patch = {}) {
  const rows = await supabaseJson('/rest/v1/yarbi_scheduled_messages?id=eq.' + encodeURIComponent(id), {
    method: 'PATCH',
    headers: supabaseHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify({ status, updated_at: new Date().toISOString(), ...patch })
  });
  return Array.isArray(rows) ? rows[0] : null;
}

async function claimScheduled(id) {
  const rows = await supabaseJson('/rest/v1/yarbi_scheduled_messages?id=eq.' + encodeURIComponent(id) + '&status=eq.scheduled', {
    method: 'PATCH',
    headers: supabaseHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify({ status: 'sending', attempts: 1, updated_at: new Date().toISOString() })
  });
  return Array.isArray(rows) ? rows[0] : null;
}

async function dispatchOne(row) {
  const response = await fetch(BASE_URL + '/api/assistant/send-whatsapp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Assistant-Token': ASSISTANT_TOKEN },
    body: JSON.stringify({ to: row.recipient_phone, message: row.message, confirmed: true })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok !== true || !String(data?.messageId || '').trim()) {
    throw new Error(String(data?.detail || data?.error || 'El proveedor no confirmó el envío.').slice(0, 300));
  }
  return data;
}

async function dispatchDue(limit = 12) {
  const now = new Date().toISOString();
  const rows = await supabaseJson('/rest/v1/yarbi_scheduled_messages?status=eq.scheduled&scheduled_for=lte.' + encodeURIComponent(now) + '&order=scheduled_for.asc&limit=' + Math.min(Math.max(Number(limit) || 12, 1), 30), {
    headers: supabaseHeaders()
  });
  const result = { due: Array.isArray(rows) ? rows.length : 0, sent: 0, failed: 0, skipped: 0 };
  for (const row of (Array.isArray(rows) ? rows : [])) {
    const claimed = await claimScheduled(row.id);
    if (!claimed) { result.skipped += 1; continue; }
    try {
      const sent = await dispatchOne(claimed);
      await updateScheduled(claimed.id, 'sent', { provider: sent.provider || '', provider_message_id: sent.messageId || '', sent_at: new Date().toISOString(), error_detail: null });
      result.sent += 1;
    } catch (error) {
      await updateScheduled(claimed.id, 'failed', { error_detail: String(error.message || error).slice(0, 300) });
      result.failed += 1;
    }
  }
  return result;
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  // Vercel Cron invoca GET con Authorization: Bearer CRON_SECRET.
  if (req.method === 'GET') {
    if (!cronAuthorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized_cron' });
    const runtime = validateServerRouteConfig({ requireProcessor: true });
    if (!runtime.ok) return res.status(503).json({ ok: false, error: 'configuration_invalid', code: runtime.code });
    SUPABASE_URL = runtime.supabaseUrl;
    SUPABASE_KEY = runtime.supabaseKey;
    BASE_URL = runtime.processorUrl;
    try { return res.status(200).json({ ok: true, ...(await dispatchDue(12)) }); }
    catch (error) { console.error('[SCHEDULED FOLLOWUPS]', error.message); return res.status(502).json({ ok: false, error: 'dispatch_failed', detail: String(error.message || error).slice(0, 300) }); }
  }

  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  if (!assistantAuthorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  const runtime = validateServerRouteConfig();
  if (!runtime.ok) return res.status(503).json({ ok: false, error: 'configuration_invalid', code: runtime.code });
  SUPABASE_URL = runtime.supabaseUrl;
  SUPABASE_KEY = runtime.supabaseKey;
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const phone = cleanPhone(body.to || body.phone);
    const message = String(body.message || '').trim().slice(0, 4096);
    const scheduledFor = new Date(String(body.scheduled_for || body.scheduledFor || ''));
    if (!/^\d{8,15}$/.test(phone)) return res.status(400).json({ ok: false, error: 'recipient_invalid' });
    if (message.length < 5) return res.status(400).json({ ok: false, error: 'message_invalid' });
    if (Number.isNaN(scheduledFor.getTime()) || scheduledFor.getTime() < Date.now() + 30 * 1000) return res.status(400).json({ ok: false, error: 'scheduled_time_invalid', detail: 'El envío debe programarse al menos 30 segundos en el futuro.' });
    const rows = await supabaseJson('/rest/v1/yarbi_scheduled_messages', {
      method: 'POST',
      headers: supabaseHeaders({ Prefer: 'return=representation' }),
      body: JSON.stringify([{ recipient_phone: phone, client_name: String(body.client_name || body.clientName || '').trim().slice(0, 160), message, scheduled_for: scheduledFor.toISOString(), record_key: String(body.record_key || body.recordKey || '').slice(0, 180), service: String(body.service || '').slice(0, 260), source: 'crm_followup' }])
    });
    const row = Array.isArray(rows) ? rows[0] : null;
    return res.status(201).json({ ok: true, id: row?.id || '', scheduled_for: row?.scheduled_for || scheduledFor.toISOString(), status: 'scheduled' });
  } catch (error) {
    console.error('[SCHEDULED FOLLOWUP CREATE]', error.message);
    return res.status(502).json({ ok: false, error: 'schedule_create_failed', detail: String(error.message || error).slice(0, 300) });
  }
};
