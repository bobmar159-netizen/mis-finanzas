const { waitUntil } = require('@vercel/functions');
const { errorCode, eventIdFor, hashReference, newOperationId, recordTrace, traceConfigError, traceSecret, traceVersion } = require('../../lib/yarbi-trace');
const { validateServerRouteConfig } = require('../../lib/yarbi-runtime-config');
const { authenticatedOwnerIdentity } = require('../../lib/yarbi-owner-ui-auth');
let SUPABASE_URL = '';
let SUPABASE_KEY = '';
const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GEMINI_KEY || '';
// The deployed project intentionally does not define a model environment
// variable. Keep the default aligned with the model used by the validated
// Yarbi understanding pipeline, and use the same resolved value for the
// provider URL and the response metadata.
const GEMINI_CHAT_MODEL = process.env.GEMINI_CHAT_MODEL || process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const TRACE_HMAC_KEY = process.env.YARBI_TRACE_HMAC_KEY || '';
let traceConfigWarned = false;

function cors(res) {
  if (process.env.APP_ORIGIN) res.setHeader('Access-Control-Allow-Origin', process.env.APP_ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
}

function safeGeminiDetail(data, fallback) {
  // A provider message can include prompt fragments or request metadata. The
  // public route and server logs intentionally retain only a stable category.
  if (Number(data?.error?.code) === 429) return 'provider_rate_limited';
  if (Number(data?.error?.code) >= 500) return 'provider_unavailable';
  return fallback === 'empty_reply' ? 'empty_reply' : 'provider_rejected';
}

async function clientHistory(phone) {
  if (!SUPABASE_KEY || !phone) return [];
  const encoded = encodeURIComponent(phone);
  const urls = [
    `${SUPABASE_URL}/rest/v1/messages?select=*&phone_number=eq.${encoded}&order=created_at.desc&limit=40`,
    `${SUPABASE_URL}/rest/v1/whatsapp_messages?deleted_at=is.null&select=*&phone=eq.${encoded}&order=timestamp.desc&limit=40`
  ];
  for (const url of urls) {
    const result = await fetch(url, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
    if (result.ok) return result.json();
  }
  return [];
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const runtime = validateServerRouteConfig({ requirePublicAuth: true });
  if (!runtime.ok) return res.status(503).json({ error: 'configuration_invalid', code: runtime.code });
  if (!GEMINI_KEY) return res.status(503).json({ error: 'assistant_not_configured' });
  const identity = await authenticatedOwnerIdentity(req, runtime);
  if (!identity.ok) return res.status(identity.status).json({ error: identity.code });
  SUPABASE_URL = runtime.supabaseUrl;
  SUPABASE_KEY = runtime.supabaseKey;

  const traceStartedAt = new Date().toISOString();
  const traceSecretValue = traceSecret(TRACE_HMAC_KEY);
  const queryOperationId = traceSecretValue ? newOperationId('query', traceSecretValue) : null;
  let queryMessageRefs = [];
  let queryContactRefs = [];
  const traceQuery = event => {
    if (!traceSecretValue || !queryOperationId) {
      if (!traceConfigWarned) {
        traceConfigWarned = true;
        console.warn('[YARBI TRACE QUERY]', traceConfigError(TRACE_HMAC_KEY));
      }
      return;
    }
    const task = recordTrace({ supabaseUrl: SUPABASE_URL, supabaseKey: SUPABASE_KEY, event: {
      ...event,
      operation_id: queryOperationId,
      event_id: eventIdFor(queryOperationId, event.stage, event.event_key || 'request', traceSecretValue),
      operation_type: 'yarbi_query',
      component: 'assistant_chat',
      component_version: traceVersion(),
      message_refs: event.message_refs || queryMessageRefs,
      contact_refs: event.contact_refs || queryContactRefs
    }, traceSecret: traceSecretValue }).catch(error => console.warn('[YARBI TRACE QUERY]', errorCode(error)));
    waitUntil(task);
  };
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const text = String(body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'text_required' });
    queryContactRefs = traceSecretValue && body.phone ? [hashReference('contact', body.phone, traceSecretValue)] : [];
    const conversation = Array.isArray(body.conversation) ? body.conversation.filter(item => item && (item.role === 'user' || item.role === 'model') && item.parts?.[0]?.text).slice(-20) : [];
    const history = await clientHistory(String(body.phone || '').trim()).catch(() => []);
    queryMessageRefs = traceSecretValue ? history.map(message => hashReference('message', message?.id, traceSecretValue)).filter(Boolean).slice(0, 12) : [];
    const historyText = history.slice().reverse().map(m => `[${m.sender || m.title || 'Contacto'}] ${m.text || m.content || m.body || m.message || ''}`).join('\n');
    const conversationText = conversation.map(m => `[${m.role === 'model' ? 'Yarbi' : 'Maestro'}] ${m.parts[0].text}`).join('\n');
    const system = String(body.systemInstruction || 'Eres Yarbi, asistente de finanzas y CRM para instalaciones de gas natural en Lima. Responde en español peruano, claro y breve. Nunca envíes mensajes ni confirmes citas sin aprobación del usuario.').slice(0, 12000);
    const prompt = `${system}\n\nConversacion reciente con el Maestro:\n${conversationText || '[Sin turnos previos]'}\n\nHistorial completo del cliente:\n${historyText || '[Sin historial asociado a un telefono activo]'}\n\nAgenda y reglas actuales:\n${JSON.stringify({ agenda: body.agenda || [], rules: body.rules || '' }).slice(0, 12000)}`;
    const result = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_CHAT_MODEL)}:generateContent?key=${GEMINI_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system_instruction: { parts: [{ text: prompt }] }, contents: conversation.length ? conversation : [{ role: 'user', parts: [{ text }] }] })
    });
    const data = await result.json().catch(() => ({}));
    if (!result.ok) {
      const detail = safeGeminiDetail(data, `HTTP ${result.status}`);
      console.error('[ASSISTANT GEMINI ERROR]', JSON.stringify({ status: result.status, category: detail }));
      traceQuery({ stage: 'yarbi_query', outcome: 'failed', event_key: 'model_failed', started_at: traceStartedAt, ended_at: new Date().toISOString(), error_code: 'model_request_failed', counts: { history_messages: history.length } });
      return res.status(502).json({ error: 'gemini_error', detail });
    }
    const reply = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim();
    if (!reply) {
      traceQuery({ stage: 'yarbi_query', outcome: 'failed', event_key: 'empty_reply', started_at: traceStartedAt, ended_at: new Date().toISOString(), error_code: 'empty_reply', counts: { history_messages: history.length } });
      return res.status(502).json({ error: 'empty_gemini_reply' });
    }
    traceQuery({ stage: 'yarbi_query', outcome: 'completed', event_key: 'completed', started_at: traceStartedAt, ended_at: new Date().toISOString(), counts: { history_messages: history.length } });
    return res.status(200).json({ reply, text: reply, model: GEMINI_CHAT_MODEL });
  } catch (error) {
    console.error('[ASSISTANT CHAT]', JSON.stringify({ category: errorCode(error) || 'request_failed' }));
    traceQuery({ stage: 'yarbi_query', outcome: 'failed', event_key: 'request_failed', started_at: traceStartedAt, ended_at: new Date().toISOString(), error_code: errorCode(error) });
    return res.status(500).json({ error: 'assistant_failed' });
  }
};





