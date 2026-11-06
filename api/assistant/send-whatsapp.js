let waitUntil = promise => Promise.resolve(promise).catch(() => {});
try {
  ({ waitUntil } = require('@vercel/functions'));
} catch (_) {
  // El runtime local de pruebas no necesita instalar el paquete de Vercel.
}
const { validateServerRouteConfig } = require('../../lib/yarbi-runtime-config');

let SUPABASE_URL = '';
let SUPABASE_KEY = '';
let AI_PROCESSOR_URL = '';
const ASSISTANT_TOKEN = process.env.ASSISTANT_API_TOKEN || process.env.TOKEN_API_DE_ASISTENTE || '';

const YCLOUD_API_KEY = process.env.YCLOUD_API_KEY || process.env.YCLOUD_KEY || '';
const YCLOUD_FROM = process.env.YCLOUD_WHATSAPP_NUMBER
  || process.env.YCLOUD_PHONE_NUMBER
  || process.env.WHATSAPP_BUSINESS_PHONE
  || '';

const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN || '';
const META_PHONE_ID = process.env.META_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const META_VERSION = process.env.WHATSAPP_API_VERSION || 'v18.0';

let cachedYCloudFrom = '';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.APP_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Assistant-Token');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
}

function authorized(req) {
  const header = req.headers?.['x-assistant-token'] || req.headers?.authorization || '';
  const token = String(header).replace(/^Bearer\s+/i, '').trim();
  return Boolean(ASSISTANT_TOKEN && token && token === ASSISTANT_TOKEN);
}

function cleanPhone(value) {
  let phone = String(value || '').replace(/\D/g, '');
  if (phone.startsWith('51') && phone.length === 11) phone = phone.slice(2);
  return phone;
}

function internationalPhone(value) {
  const phone = cleanPhone(value);
  const digits = phone.length === 9 ? '51' + phone : phone;
  return /^\d{8,15}$/.test(digits) ? digits : '';
}

function e164Phone(value) {
  const digits = internationalPhone(value);
  return digits ? '+' + digits : '';
}

function safeMediaUrl(value) {
  const url = String(value || '').trim();
  return /^https?:\/\//i.test(url) ? url : '';
}

function providerError(code, detail, status) {
  const error = new Error(detail || code);
  error.code = code;
  error.providerStatus = status || 0;
  return error;
}

async function resolveYCloudSender() {
  const configured = e164Phone(YCLOUD_FROM);
  if (configured) return configured;
  if (cachedYCloudFrom) return cachedYCloudFrom;

  const response = await fetch('https://api.ycloud.com/v2/whatsapp/phoneNumbers?page=1&limit=100&includeTotal=true', {
    headers: { Accept: 'application/json', 'X-API-Key': YCLOUD_API_KEY }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw providerError(
      'ycloud_sender_lookup_failed',
      data?.error?.message || data?.message || 'YCloud no permitio consultar el numero emisor.',
      response.status
    );
  }

  const items = Array.isArray(data) ? data : (Array.isArray(data.items) ? data.items : []);
  const senders = [...new Set(items.map(item => e164Phone(item?.phoneNumber || item?.displayPhoneNumber)).filter(Boolean))];
  if (senders.length === 0) {
    throw providerError('ycloud_sender_missing', 'YCloud no tiene un numero de WhatsApp empresarial registrado.', 503);
  }
  if (senders.length > 1) {
    throw providerError(
      'ycloud_sender_ambiguous',
      'YCloud tiene mas de un numero. Configura YCLOUD_WHATSAPP_NUMBER en Vercel para elegir el emisor.',
      503
    );
  }
  cachedYCloudFrom = senders[0];
  return cachedYCloudFrom;
}

function buildContent(type, message, mediaUrl, includeMetaProduct) {
  const payload = { type };
  if (includeMetaProduct) payload.messaging_product = 'whatsapp';
  if (mediaUrl) {
    payload[type] = { link: mediaUrl };
    if (message) payload[type].caption = message;
  } else {
    payload.text = { preview_url: true, body: message };
  }
  return payload;
}

async function sendWithYCloud(to, type, message, mediaUrl) {
  const from = await resolveYCloudSender();
  const payload = {
    from,
    to: '+' + to,
    ...buildContent(type, message, mediaUrl, false)
  };
  const response = await fetch('https://api.ycloud.com/v2/whatsapp/messages/sendDirectly', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': YCLOUD_API_KEY },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const apiError = data?.error || {};
    throw providerError(
      apiError.code || data?.code || 'ycloud_send_failed',
      apiError.message || apiError.whatsappApiError?.message || data?.message || 'YCloud rechazo el mensaje.',
      response.status
    );
  }
  const messageId = data?.id || data?.messageId || data?.whatsappMessage?.id || data?.messages?.[0]?.id || null;
  if (!messageId) {
    throw providerError('ycloud_send_unverified', 'YCloud aceptó la petición pero no devolvió un identificador de WhatsApp verificable.', response.status);
  }
  return { provider: 'ycloud', messageId };
}

async function sendWithMeta(to, type, message, mediaUrl) {
  const payload = {
    to,
    ...buildContent(type, message, mediaUrl, true)
  };
  const response = await fetch('https://graph.facebook.com/' + META_VERSION + '/' + META_PHONE_ID + '/messages', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + META_ACCESS_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw providerError(
      data?.error?.code || 'meta_send_failed',
      data?.error?.message || 'Meta rechazo el mensaje.',
      response.status
    );
  }
  const messageId = data?.messages?.[0]?.id || null;
  if (!messageId) {
    throw providerError('meta_send_unverified', 'Meta aceptó la petición pero no devolvió un identificador de WhatsApp verificable.', response.status);
  }
  return { provider: 'meta', messageId };
}

async function rememberOutbound(messageId, to, type, message) {
  if (!SUPABASE_KEY || !messageId) return 'not_configured';
  const saved = await fetch(SUPABASE_URL + '/rest/v1/whatsapp_messages', {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=minimal'
    },
    body: JSON.stringify([{
      id: messageId,
      phone: cleanPhone(to),
      title: cleanPhone(to),
      text: message || `[${type} enviado por Yarbi]`,
      app_name: 'YCloud WhatsApp Business',
      timestamp: Date.now(),
      metadata: { direction: 'outgoing', source: 'assistant_api', status: 'accepted_by_provider' }
    }])
  });
  if (!saved.ok) throw new Error('Supabase HTTP ' + saved.status);

  if (AI_PROCESSOR_URL) {
    waitUntil(fetch(AI_PROCESSOR_URL + '/api/ai/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Assistant-Token': ASSISTANT_TOKEN },
      body: JSON.stringify({ limit: 3, requested_by: 'assistant-send', trigger_message_id: messageId })
    }).catch(error => console.warn('[WHATSAPP OUTBOUND AI]', error.message)));
  }
  return 'stored';
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' });
  const runtime = validateServerRouteConfig({ optionalProcessor: true });
  if (!runtime.ok) return res.status(503).json({ error: 'configuration_invalid', code: runtime.code });
  SUPABASE_URL = runtime.supabaseUrl;
  SUPABASE_KEY = runtime.supabaseKey;
  AI_PROCESSOR_URL = runtime.processorUrl;
  if (!YCLOUD_API_KEY && !(META_ACCESS_TOKEN && META_PHONE_ID)) {
    return res.status(503).json({
      error: 'whatsapp_not_configured',
      detail: 'Falta configurar YCloud o Meta para el envio de WhatsApp.'
    });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    if (body.confirmed !== true) return res.status(409).json({ error: 'explicit_confirmation_required' });

    const to = internationalPhone(body.to || body.phone);
    const message = String(body.message || '').trim().slice(0, 4096);
    const mediaUrl = safeMediaUrl(body.mediaUrl || body.media_url);
    const mediaType = ['image', 'video', 'document'].includes(body.mediaType || body.media_type)
      ? (body.mediaType || body.media_type)
      : '';
    const type = mediaUrl ? mediaType : 'text';

    if (!to) return res.status(400).json({ error: 'recipient_invalid' });
    if (!message && !mediaUrl) return res.status(400).json({ error: 'message_or_media_required' });
    if (mediaUrl && !mediaType) return res.status(400).json({ error: 'media_type_invalid' });

    const sent = YCLOUD_API_KEY
      ? await sendWithYCloud(to, type, message, mediaUrl)
      : await sendWithMeta(to, type, message, mediaUrl);

    let syncStatus = 'not_configured';
    try {
      syncStatus = await rememberOutbound(sent.messageId, to, type, message);
    } catch (error) {
      syncStatus = 'failed';
      console.error('[WHATSAPP OUTBOUND SYNC]', error.message);
    }

    return res.status(200).json({
      ok: true,
      accepted: true,
      deliveryConfirmed: false,
      provider: sent.provider,
      messageId: sent.messageId,
      to: cleanPhone(to),
      type,
      syncStatus
    });
  } catch (error) {
    console.error('[WHATSAPP SEND]', error.code || error.message, error.providerStatus || '');
    return res.status(502).json({
      error: error.code || 'whatsapp_send_failed',
      detail: String(error.message || 'No se pudo enviar el mensaje.').slice(0, 300),
      providerStatus: error.providerStatus || null
    });
  }
};
