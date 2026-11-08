/**
 * API ROUTE / WEBHOOK DE WHATSAPP BUSINESS & PROCESADOR DE IA YARBI
 * Meta Cloud API Webhook + Supabase CRM + Gemini LLM Extraction
 */

const { waitUntil } = require('@vercel/functions');
const { processLocationInput, extractCoordinatesFromMapsUrl } = require('../lib/location-resolver');
const whatsappMessagesHandler = require('../lib/whatsapp-messages');
const { errorCode, eventIdFor, hashReference, operationIdFromReference, recordTerminalTrace, traceConfigError, traceSecret, traceVersion } = require('../lib/yarbi-trace');
const { validateRuntimeConfig } = require('../lib/yarbi-runtime-config');
const { adaptCommercialEvidence, attachCommercialEvidence, createVerifiedWebhookEvidenceEvent } = require('../lib/yarbi-commercial-evidence');
const { authenticateYCloudWebhook, extractYCloudInteractiveSelection } = require('../lib/yarbi-ycloud-webhook-auth');
const { sanitizeWebhookReceipt, sanitizeWebhookIdentity, sanitizeWebhookProcessing, sanitizeExtraction } = require('../lib/yarbi-webhook-log');
const { normalizeWhatsAppBusinessEvent } = require('../lib/yarbi-whatsapp-business');

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || '';
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim();
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || '';
const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GEMINI_KEY || '';
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN || '';
const YCLOUD_API_KEY = process.env.YCLOUD_API_KEY || process.env.YCLOUD_KEY || '';
const YCLOUD_WEBHOOK_SECRET = process.env.YCLOUD_WEBHOOK_SECRET || '';
// Exclusivo del procesador interno en segundo plano. No autentica navegador ni
// consultas interactivas; esas rutas usan Supabase Auth en handlers separados.
const INTERNAL_PROCESSOR_TOKEN = process.env.ASSISTANT_API_TOKEN || process.env.TOKEN_API_DE_ASISTENTE || '';
const GEMINI_ANALYSIS_MODEL = process.env.GEMINI_ANALYSIS_MODEL || 'gemini-3.1-flash-lite';
const GEMINI_AUDIO_MODEL = process.env.GEMINI_AUDIO_MODEL || GEMINI_ANALYSIS_MODEL;
const ENABLE_LEGACY_WEBHOOK_EXTRACTION = process.env.ENABLE_LEGACY_WEBHOOK_EXTRACTION === 'true';
const TRACE_HMAC_KEY = process.env.YARBI_TRACE_HMAC_KEY || '';
let traceConfigWarned = false;

function whatsappBusinessOperationsEnabled() {
  return process.env.YARBI_WHATSAPP_BUSINESS_OPERATIONS_ENABLED === 'true';
}

// Delivery/read receipts are intentionally feature-gated until the proposed
// F08 operation ledger has been reviewed and applied.  A receipt never turns
// a provider acknowledgement into a fabricated delivery state.
async function recordWhatsAppDeliveryReceipt({ event, runtime }) {
  if (!whatsappBusinessOperationsEnabled()) return { status: 'disabled' };
  if (!event?.provider_message_id || !['delivered', 'read', 'failed'].includes(event.status)) return { status: 'ignored' };
  const terminalField = event.status === 'read' ? 'read_at' : event.status === 'delivered' ? 'delivered_at' : 'failed_at';
  const allowed = event.status === 'read' ? 'provider_accepted,delivered' : 'provider_accepted';
  const response = await fetch(`${runtime.supabaseUrl}/rest/v1/yarbi_whatsapp_send_operations?provider=eq.${encodeURIComponent(event.provider)}&provider_message_id=eq.${encodeURIComponent(event.provider_message_id)}&status=in.(${allowed})`, {
    method: 'PATCH',
    headers: { apikey: runtime.supabaseKey, Authorization: `Bearer ${runtime.supabaseKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ status: event.status, [terminalField]: new Date().toISOString(), updated_at: new Date().toISOString() })
  });
  return { status: response.ok ? 'recorded' : 'unavailable' };
}

// YCloud firma los bytes originales. Vercel no debe parsear el cuerpo de este
// endpoint antes de que podamos verificar la firma.
export const config = { api: { bodyParser: false } };

async function readRawRequestBody(req) {
  if (Buffer.isBuffer(req?.rawBody)) return req.rawBody;
  if (typeof req?.rawBody === 'string') return Buffer.from(req.rawBody, 'utf8');
  if (Buffer.isBuffer(req?.body)) return req.body;
  if (typeof req?.body === 'string') return Buffer.from(req.body, 'utf8');
  if (!req || typeof req[Symbol.asyncIterator] !== 'function') return null;
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function parseWebhookJson(rawBody) {
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
    const error = new Error('webhook_body_missing');
    error.code = 'webhook_body_missing';
    throw error;
  }
  try {
    return JSON.parse(rawBody.toString('utf8'));
  } catch (_) {
    const error = new Error('webhook_json_invalid');
    error.code = 'webhook_json_invalid';
    throw error;
  }
}

// La URL interna debe configurarse de forma explícita. Nunca se infiere ni se
// sustituye por un alias histórico: una configuración incompleta debe fallar.
function internalProcessorBaseUrl() {
  const configured = String(process.env.AI_PROCESSOR_URL || '').trim();
  return configured ? configured.replace(/\/$/, '') : '';
}

function traceWhatsApp(event) {
  const secret = traceSecret(TRACE_HMAC_KEY);
  if (!SUPABASE_KEY || !secret) {
    if (!traceConfigWarned) {
      traceConfigWarned = true;
      console.warn('[YARBI TRACE WEBHOOK]', traceConfigError(TRACE_HMAC_KEY));
    }
    return Promise.resolve({ ok: false, reason: 'trace_config_missing' });
  }
  // Esta operación termina al guardar el mensaje canónico. El procesador IA
  // corre después con otra operation_id, así que no se cierra prematuramente.
  return recordTerminalTrace({
    supabaseUrl: SUPABASE_URL,
    supabaseKey: SUPABASE_KEY,
    traceSecret: secret,
    event,
    closeEventKey: `whatsapp-close:${event.event_id}`
  })
    .then(result => {
      if (!result?.ok) console.warn('[YARBI TRACE WEBHOOK CLOSE]', result?.reason || 'trace_close_failed', result?.error_code || '');
      return result;
    })
    .catch(error => {
      // La trazabilidad nunca altera el ingreso ni el procesamiento de WhatsApp.
      console.warn('[YARBI TRACE WEBHOOK]', errorCode(error));
      return { ok: false, reason: 'trace_failed' };
    });
}

function scheduleCanonicalProcessing(messageId) {
  if (!INTERNAL_PROCESSOR_TOKEN || !messageId) return;
  const baseUrl = internalProcessorBaseUrl();
  const task = fetch(baseUrl + '/api/ai/process', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Assistant-Token': INTERNAL_PROCESSOR_TOKEN },
    body: JSON.stringify({ limit: 25, priority_message_id: messageId, requested_by: 'whatsapp-webhook-background' })
  }).then(async response => {
    const result = await response.json().catch(() => ({}));
    console.log('[YARBI BACKGROUND PROCESSOR]', response.status, JSON.stringify({ status: result.status || '', processed: result.messages_processed || 0 }));
  }).catch(error => {
    console.warn('[YARBI BACKGROUND PROCESSOR] El mensaje permanece en la cola durable:', errorCode(error));
  });
  waitUntil(task);
}

function audioSummaryErrorInfo(error) {
  const detail = String(error?.message || error || 'Error desconocido').slice(0, 300);
  let code = 'audio_summary_failed';
  if (/YCloud media HTTP\s+\d+/i.test(detail)) code = 'ycloud_media_http';
  else if (/Gemini audio HTTP\s+\d+/i.test(detail)) code = 'gemini_audio_http';
  else if (/sin enlace YCloud|credenciales Meta/i.test(detail)) code = 'audio_source_unavailable';
  else if (/excede 16 MB/i.test(detail)) code = 'audio_too_large';
  else if (/no conserva un enlace/i.test(detail)) code = 'audio_link_not_preserved';
  else if (/resumen estructurado/i.test(detail)) code = 'audio_summary_invalid';
  return { code, detail };
}

async function markStoredWhatsAppAudioSummaryFailure(messageId, error) {
  const id = String(messageId || '').trim().slice(0, 240);
  if (!id || !SUPABASE_KEY) return { status: 'not_recorded' };
  const failure = audioSummaryErrorInfo(error);
  const unavailable = /no conserva|no es una nota|no se pudo leer|sin enlace YCloud|credenciales Meta/i.test(failure.detail);
  const status = unavailable ? 'unavailable' : 'failed';
  const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
  const currentResponse = await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_messages?id=eq.${encodeURIComponent(id)}&select=metadata&limit=1`, { headers });
  const currentRows = await currentResponse.json().catch(() => []);
  const currentMetadata = Array.isArray(currentRows) && currentRows[0]?.metadata && typeof currentRows[0].metadata === 'object'
    ? currentRows[0].metadata
    : {};
  const metadata = {
    ...currentMetadata,
    media_type: 'audio',
    audio_summary_status: status,
    audio_summary_error_code: failure.code,
    audio_summary_error: failure.detail,
    audio_summary_updated_at: new Date().toISOString()
  };
  const patch = await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_messages?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ metadata })
  });
  if (!patch.ok) throw new Error('No se pudo registrar el estado final de la nota de voz');
  return { status, error_code: failure.code };
}

async function requeueCanonicalAnalysis(messageId) {
  const id = String(messageId || '').trim().slice(0, 240);
  if (!id) return false;
  const response = await fetch(`${SUPABASE_URL}/rest/v1/ai_message_analysis?message_id=eq.${encodeURIComponent(id)}&analysis_version=eq.1`, {
    method: 'PATCH',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'pending', error_message: null, completed_at: null, analyzed_at: null, next_retry_at: null, locked_at: null, lock_token: null })
  });
  if (!response.ok) throw new Error('No se pudo reencolar la memoria de la nota de voz');
  scheduleCanonicalProcessing(id);
  return true;
}

function scheduleStoredVoiceNoteRetry(messageId) {
  const task = new Promise(resolve => setTimeout(resolve, 1200))
    .then(() => retryStoredWhatsAppAudioSummary(messageId))
    .catch(async error => {
      const recorded = await markStoredWhatsAppAudioSummaryFailure(messageId, error).catch(() => ({ status: 'not_recorded' }));
      console.warn('[AUDIO SUMMARY RETRY ERROR]', JSON.stringify({ ...audioSummaryErrorInfo(error), recorded_status: recorded.status }));
    });
  waitUntil(task);
}

function cleanPhone(value) {
  let phone = String(value || '').replace(/\D/g, '');
  if (phone.startsWith('51') && phone.length === 11) phone = phone.slice(2);
  return phone;
}

function isPlaceholderName(value) {
  return !value || /^(cliente whatsapp|cliente|sin nombre|unknown)$/i.test(String(value).trim());
}

function isTrustedYCloudMediaLink(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && url.hostname === 'api.ycloud.com' && url.pathname.startsWith('/v2/whatsapp/media/download/');
  } catch (_) {
    return false;
  }
}

async function downloadWhatsAppAudio(audio) {
  const media = audio || {};
  const maxBytes = 16 * 1024 * 1024;

  // YCloud documenta audio.link como la fuente canónica para mensajes
  // entrantes, enviados desde WhatsApp Business e historial de coexistencia.
  if (isTrustedYCloudMediaLink(media.link)) {
    const headers = YCLOUD_API_KEY ? { 'X-API-Key': YCLOUD_API_KEY } : {};
    const response = await fetch(media.link, { headers });
    if (!response.ok) throw new Error('YCloud media HTTP ' + response.status);
    const declaredBytes = Number(response.headers.get('content-length') || 0);
    if (declaredBytes > maxBytes) throw new Error('Audio YCloud excede 16 MB');
    const data = await response.arrayBuffer();
    if (data.byteLength > maxBytes) throw new Error('Audio YCloud excede 16 MB');
    return { data, source: 'ycloud-link' };
  }

  // Compatibilidad exclusiva para webhooks directos de Meta Cloud.
  if (media.id && META_ACCESS_TOKEN) {
    const mediaRes = await fetch(`https://graph.facebook.com/v18.0/${media.id}`, {
      headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` }
    });
    if (!mediaRes.ok) throw new Error('Meta media metadata HTTP ' + mediaRes.status);
    const mediaData = await mediaRes.json();
    if (!mediaData.url) throw new Error('Meta no devolvió URL de audio');
    const audioRes = await fetch(mediaData.url, {
      headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` }
    });
    if (!audioRes.ok) throw new Error('Meta media download HTTP ' + audioRes.status);
    const declaredBytes = Number(audioRes.headers.get('content-length') || 0);
    if (declaredBytes > maxBytes) throw new Error('Audio Meta excede 16 MB');
    const data = await audioRes.arrayBuffer();
    if (data.byteLength > maxBytes) throw new Error('Audio Meta excede 16 MB');
    return { data, source: 'meta-media-id' };
  }

  throw new Error('Audio sin enlace YCloud confiable ni credenciales Meta');
}

function parseGeminiJson(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try { return JSON.parse(raw); } catch (_) {}
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)); } catch (_) {}
  }
  return null;
}

function compactAudioField(value, maxLength = 180) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function formatAudioSummary(data, direction) {
  const role = direction === 'outgoing' ? 'Maestro' : 'cliente';
  const summary = compactAudioField(data && data.resumen, 260);
  const labels = [
    ['servicio', 'Servicio'],
    ['fecha', 'Fecha'],
    ['hora', 'Hora'],
    ['ubicacion', 'Ubicación'],
    ['precio', 'Precio'],
    ['compromiso', 'Compromiso'],
    ['pendiente', 'Pendiente'],
    ['intencion', 'Intención']
  ];
  const facts = labels
    .map(([key, label]) => [label, compactAudioField(data && data[key], 140)])
    .filter(([, value]) => value && !/^(no|ninguno|ninguna|no indicado|no se menciona|null)$/i.test(value))
    .map(([label, value]) => label + ': ' + value);
  if (!summary && !facts.length) return '';
  return '🎤 Nota de voz del ' + role + ': ' + (summary || 'se detectaron datos comerciales') + (facts.length ? '. Datos clave: ' + facts.join(' · ') : '');
}

async function summarizeWhatsAppAudio(audio, direction) {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY no configurada');
  const downloaded = await downloadWhatsAppAudio(audio);
  const base64Audio = Buffer.from(downloaded.data).toString('base64');
  const speaker = direction === 'outgoing' ? 'el dueño del negocio' : 'un cliente';
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_AUDIO_MODEL}:generateContent?key=${GEMINI_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: `Escucha esta nota de voz de WhatsApp enviada por ${speaker}. Devuelve SOLO JSON válido en español con estas claves: resumen, servicio, fecha, hora, ubicacion, precio, compromiso, pendiente, intencion. Resume únicamente lo importante para CRM y seguimiento. No transcribas literalmente, no inventes datos y deja cadena vacía cuando un dato no aparezca. El resumen debe ser breve, factual y sin citas textuales.` },
          { inline_data: { mime_type: audio.mime_type || 'audio/ogg', data: base64Audio } }
        ]
      }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.1 }
    })
  });
  if (!response.ok) throw new Error('Gemini audio HTTP ' + response.status);
  const payload = await response.json();
  const raw = payload.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '';
  const parsed = parseGeminiJson(raw);
  const summary = formatAudioSummary(parsed, direction);
  if (!summary) throw new Error('Gemini no devolvió resumen estructurado');
  return { summary, source: downloaded.source };
}


async function retryStoredWhatsAppAudioSummary(messageId) {
  const id = String(messageId || '').trim().slice(0, 240);
  if (!id) throw new Error('Falta el identificador de la nota de voz');
  const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
  const [sourceResponse, canonicalResponse] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/messages?id=eq.${encodeURIComponent(id)}&select=id,sender,content,media_type,raw_payload&limit=1`, { headers }),
    fetch(`${SUPABASE_URL}/rest/v1/whatsapp_messages?id=eq.${encodeURIComponent(id)}&deleted_at=is.null&select=id,text,metadata&limit=1`, { headers })
  ]);
  const sourceRows = await sourceResponse.json().catch(() => []);
  const canonicalRows = await canonicalResponse.json().catch(() => []);
  if (!sourceResponse.ok) throw new Error('No se pudo leer el audio original');
  const source = Array.isArray(sourceRows) ? sourceRows[0] : null;
  const canonical = Array.isArray(canonicalRows) ? canonicalRows[0] : null;
  if (!source || String(source.media_type || '').toLowerCase() !== 'audio') throw new Error('El mensaje solicitado no es una nota de voz disponible');
  const current = String(canonical?.text || source.content || '').trim();
  if (/^🎤\s*Nota de voz/i.test(current)) return { status: 'already_ready', message_id: id, summary: current };
  const rawPayload = source.raw_payload && typeof source.raw_payload === 'object' ? source.raw_payload : {};
  if (!rawPayload.audio) throw new Error('La nota antigua no conserva un enlace de audio recuperable');
  const direction = rawPayload?._yarbi?.direction === 'outgoing' || source.sender === 'operator' ? 'outgoing' : 'incoming';
  let result;
  try {
    result = await summarizeWhatsAppAudio(rawPayload.audio, direction);
  } catch (error) {
    await markStoredWhatsAppAudioSummaryFailure(id, error).catch(() => null);
    throw error;
  }
  const now = new Date().toISOString();
  const metadata = {
    ...(canonical?.metadata && typeof canonical.metadata === 'object' ? canonical.metadata : {}),
    media_type: 'audio',
    audio_summary_status: 'ready',
    audio_summary_source: result.source,
    audio_summary_updated_at: now,
    audio_summary_error_code: null,
    audio_summary_error: null
  };
  const [sourcePatch, canonicalPatch] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/messages?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: result.summary })
    }),
    fetch(`${SUPABASE_URL}/rest/v1/whatsapp_messages?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: result.summary, metadata })
    })
  ]);
  if (!sourcePatch.ok || !canonicalPatch.ok) throw new Error('Se resumió el audio, pero no se pudo actualizar su memoria');
  await requeueCanonicalAnalysis(id);
  if (typeof whatsappMessagesHandler.invalidateMemoryCache === 'function') whatsappMessagesHandler.invalidateMemoryCache();
  return { status: 'summarized', message_id: id, summary: result.summary, source: result.source };
}
async function loadRecentClientHistory(phone) {
  if (!SUPABASE_KEY || !phone) return [];
  const encoded = encodeURIComponent(phone);
  const urls = [
    SUPABASE_URL + '/rest/v1/messages?select=id,sender,content,created_at&phone_number=eq.' + encoded + '&order=created_at.desc&limit=80',
    SUPABASE_URL + '/rest/v1/whatsapp_messages?deleted_at=is.null&select=id,title,text,timestamp&phone=eq.' + encoded + '&order=timestamp.desc&limit=80'
  ];
  const rows = [];
  for (const url of urls) {
    try {
      const result = await fetch(url, { headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY } });
      if (result.ok) {
        const data = await result.json();
        if (Array.isArray(data)) rows.push(...data);
      }
    } catch (_) {}
  }
  const unique = new Map();
  rows.forEach((row) => {
    const value = row.content || row.text || '';
    const at = row.created_at || row.timestamp || '';
    const key = row.id || (String(at) + '|' + String(value));
    if (!unique.has(key)) unique.set(key, { ...row, _historyText: value, _historyAt: at });
  });
  return Array.from(unique.values()).sort((a, b) => String(a._historyAt).localeCompare(String(b._historyAt))).slice(-80);
}
export default async function handler(req, res) {
  // Configurar cabeceras CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // La verificación de Meta no toca recursos comerciales ni Supabase.
  if (req.method === 'GET' && req.query['hub.mode'] === 'subscribe') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('[WEBHOOK] Verificado exitosamente por Meta!');
      return res.status(200).send(challenge);
    }
    console.warn('[WEBHOOK] Falló la verificación de token');
    return res.status(403).json({ error: 'Token de verificación no válido' });
  }

  const runtime = validateRuntimeConfig({ requireProcessor: req.method === 'POST' });
  if (!runtime.ok) return res.status(503).json({ error: 'configuration_invalid', code: runtime.code });

    // Se conserva el cuerpo original para HMAC. Ningún POST de usuario comparte
    // este handler: un proveedor debe aportar una firma válida antes de causar
    // efectos. Los flujos interactivos están en rutas autenticadas separadas.
  let postBody = req.body;
  let ycloudAuthentication = { authenticated: false, code: 'not_post' };
  if (req.method === 'POST') {
    const rawBody = await readRawRequestBody(req);
    const signature = req.headers?.['ycloud-signature'] || req.headers?.['YCloud-Signature'];
    if (signature) {
      ycloudAuthentication = authenticateYCloudWebhook({ rawBody, headers: req.headers, secret: YCLOUD_WEBHOOK_SECRET });
      if (!ycloudAuthentication.authenticated) {
        console.warn('[WEBHOOK AUTH REJECTED]', ycloudAuthentication.code);
        return res.status(401).json({ error: 'webhook_unauthorized', code: ycloudAuthentication.code });
      }
      try {
        postBody = parseWebhookJson(rawBody);
      } catch (error) {
        return res.status(400).json({ error: 'webhook_invalid_body', code: error.code || 'webhook_json_invalid' });
      }
    } else {
      console.warn('[WEBHOOK AUTH REJECTED] ycloud_signature_missing');
      return res.status(401).json({ error: 'webhook_unauthorized', code: 'ycloud_signature_missing' });
    }
    req.body = postBody;
  }

  // La memoria CRM comparte esta función para respetar el límite Hobby de Vercel.
  const requestPath = String(req.url || '').split('?')[0];
  if (['memory', 'memory-overview'].includes(String(req.query?.action || ''))) {
    // La memoria interactiva ahora vive en /api/assistant/memory, donde la
    // sesión y el scope canónico se validan antes de cualquier lectura.
    return res.status(410).json({ error: 'interactive_memory_moved', route: '/api/assistant/memory' });
  }

  // 2. Consulta de borradores de acciones y mensajes para el Frontend (GET /api/webhook?action=get_drafts)
  if (req.method === 'GET' && req.query['action'] === 'get_drafts') {
    res.setHeader('Location', '/api/assistant/drafts');
    return res.status(307).json({ status: 'moved', route: '/api/assistant/drafts' });
  }

  // Diagnóstico seguro: confirma si WhatsApp Cloud guardó una ubicación para este cliente.
  if (req.method === 'GET' && req.query['action'] === 'location_debug') {
    return res.status(410).json({ error: 'interactive_location_debug_moved' });
  }
  // 3. Consulta de mensajes tradicionales (GET /api/webhook?action=get)
  if (req.method === 'GET' && req.query['action'] === 'get') {
    res.setHeader('Location', '/api/whatsapp/messages');
    return res.status(307).json({ status: 'moved', route: '/api/whatsapp/messages' });
  }

  // Reintento solicitado explícitamente desde Yarbi para una nota ya guardada.
  if (req.method === 'POST' && String(postBody?.action || '') === 'summarize-voice-note') {
    return res.status(410).json({ error: 'interactive_audio_summary_moved' });
  }
  // 4. Recepción de mensajes en tiempo real (POST /api/webhook)
  if (req.method === 'POST') {
    if (!ycloudAuthentication.authenticated) {
      return res.status(401).json({ error: 'webhook_unauthorized', code: 'ycloud_signature_required' });
    }
    try {
      const body = postBody;
      console.log('[WEBHOOK RECEIVED]', JSON.stringify(sanitizeWebhookReceipt(body)));

      const businessEvent = normalizeWhatsAppBusinessEvent({ provider: ycloudAuthentication.authenticated ? 'ycloud' : 'meta_cloud', payload: body });
      if (businessEvent.outcome === 'delivery_status') {
        const receipt = await recordWhatsAppDeliveryReceipt({ event: businessEvent, runtime });
        return res.status(200).json({ status: 'delivery_status_received', delivery_state: businessEvent.status || 'unknown', persisted: receipt.status === 'recorded' });
      }

      // Normaliza Meta Cloud, mensajes entrantes de YCloud, historial de
      // coexistencia y mensajes enviados desde WhatsApp Business.
      const ycloudEventType = String(body && body.type || '');
      const ycloudSourceMessage = (
        ycloudEventType === 'whatsapp.inbound_message.received' ? body.whatsappInboundMessage
          : ycloudEventType === 'whatsapp.smb.history'
            ? (body.whatsappMessage || body.whatsappInboundMessage)
            : ycloudEventType === 'whatsapp.smb.message.echoes'
              ? body.whatsappMessage
            : null
      );
      const ycloudIsHistorical = ycloudEventType === 'whatsapp.smb.history';
      const ycloudIsOutbound = ycloudEventType === 'whatsapp.smb.message.echoes'
        || (ycloudIsHistorical && ['sent', 'delivered', 'read'].includes(String(ycloudSourceMessage && ycloudSourceMessage.status || '').toLowerCase()));
      const value = body && body.entry && body.entry[0] && body.entry[0].changes && body.entry[0].changes[0]
        ? body.entry[0].changes[0].value
        : (ycloudSourceMessage ? {
            messages: [{
              id: ycloudSourceMessage.id,
              wamid: ycloudSourceMessage.wamid,
              from: ycloudIsOutbound ? ycloudSourceMessage.to : ycloudSourceMessage.from,
              timestamp: ycloudSourceMessage.sendTime
                ? String(Math.floor(new Date(ycloudSourceMessage.sendTime).getTime() / 1000))
                : undefined,
              type: ycloudSourceMessage.type,
              text: ycloudSourceMessage.text,
              image: ycloudSourceMessage.image,
              video: ycloudSourceMessage.video,
              audio: ycloudSourceMessage.audio,
              document: ycloudSourceMessage.document,
              sticker: ycloudSourceMessage.sticker,
              location: ycloudSourceMessage.location,
              interactive: ycloudSourceMessage.interactive,
              _yarbiDirection: ycloudIsOutbound ? 'outgoing' : 'incoming',
              _yarbiHistorical: ycloudIsHistorical,
              _yarbiYcloudEvent: ycloudEventType
            }],
            contacts: [{
              profile: {
                name: ycloudSourceMessage.customerProfile?.name,
                username: ycloudSourceMessage.customerProfile?.username
              },
              wa_id: ycloudIsOutbound ? ycloudSourceMessage.to : ycloudSourceMessage.from,
              from_user_id: ycloudSourceMessage.fromUserId || ycloudSourceMessage.from_user_id || null
            }]
          } : null);

      if (value) {
        if (value.messages && value.messages[0]) {
          const msg = value.messages[0];
          const messageId = msg.id || ('meta_' + Date.now());
          const messageDirection = msg._yarbiDirection === 'outgoing' ? 'outgoing' : 'incoming';
          const isHistoricalMessage = Boolean(msg._yarbiHistorical);
          const messageSourceEvent = String(msg._yarbiYcloudEvent || 'meta.cloud');
          const messageSourceLabel = messageSourceEvent === 'whatsapp.smb.history'
            ? 'YCloud Coexistence · Historial'
            : messageSourceEvent === 'whatsapp.smb.message.echoes'
              ? 'YCloud Coexistence · Enviado desde WhatsApp Business'
              : 'WhatsApp Business API (Cloud)';
          const senderPhone = cleanPhone(msg.from);
          const contacts = Array.isArray(value.contacts) ? value.contacts : [];
          const contact = contacts.find(item => cleanPhone(item && item.wa_id) === senderPhone) || contacts[0] || {};
          const rawProfileName = contact.profile && contact.profile.name ? String(contact.profile.name).trim() : '';
          const profileName = isPlaceholderName(rawProfileName) ? '' : rawProfileName;
          const rawProfileUsername = contact.profile && contact.profile.username ? String(contact.profile.username).trim().replace(/^@+/, '') : '';
          const profileUsername = rawProfileUsername && !isPlaceholderName(rawProfileUsername) ? rawProfileUsername : '';
          const fromUserId = String(contact.from_user_id || '').trim();
          const identityAliases = [...new Set([
            profileName,
            profileUsername ? '@' + profileUsername : '',
            profileUsername,
            fromUserId
          ].filter(Boolean))];
          const identityLabel = profileName || (profileUsername ? '@' + profileUsername : '') || senderPhone || 'Cliente WhatsApp';
          if (!senderPhone) return res.status(200).json({ status: 'ignored_without_customer_phone', sourceEvent: messageSourceEvent });
          // attachCommercialEvidence recibe el resultado completo del adaptador
          // (outcome + evidence), no la evidencia aislada. Mantener ese contrato
          // evita que un evento autenticado parezca aceptado pero no llegue al
          // mensaje canónico que consumirá el procesador.
          let commercialEvidence = null;
          // `event.id` firmado es la identidad de entrega del proveedor. Se
          // conserva y se consulta aparte de `msg.id`: ambos deben coincidir
          // en una reentrega normal, pero el primero evita repetir efectos si
          // un payload repetido llegara con otra representación del mensaje.
          const signedYcloudEventId = ycloudAuthentication.authenticated && body?.id != null
            ? String(body.id).trim().slice(0, 200)
            : '';
          if (ycloudAuthentication.authenticated && messageDirection === 'incoming' && !isHistoricalMessage && ycloudEventType === 'whatsapp.inbound_message.received') {
            const interactiveSelection = extractYCloudInteractiveSelection(body);
            const verifiedEvent = createVerifiedWebhookEvidenceEvent({
              providerVerified: true,
              eventId: body?.id,
              messageId,
              occurredAt: body?.createTime || msg.timestamp,
              interactive: interactiveSelection
            });
            const adaptation = adaptCommercialEvidence(verifiedEvent);
            if (adaptation.outcome === 'accepted') commercialEvidence = adaptation;
          }
          console.log('[WEBHOOK IDENTITY]', JSON.stringify(sanitizeWebhookIdentity({
            identitySource: profileName ? 'cloud_profile' : (profileUsername ? 'cloud_username' : 'phone_fallback'),
            senderPhone,
            profileName,
            profileUsername,
            fromUserId
          })));

          if (SUPABASE_KEY && messageId) {
            try {
              // La deduplicación debe consultar la misma fuente cuya
              // persistencia confirma la recepción. Un registro legacy puede
              // existir aunque whatsapp_messages haya fallado; usarlo aquí
              // impediría la reentrega válida del proveedor.
              const duplicateUrl = SUPABASE_URL + '/rest/v1/whatsapp_messages?id=eq.' + encodeURIComponent(messageId) + '&select=id&limit=1';
              const duplicateRes = await fetch(duplicateUrl, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } });
              if (duplicateRes.ok && (await duplicateRes.json()).length > 0) {
                console.log('[WEBHOOK] Mensaje duplicado ignorado');
                return res.status(200).json({ status: 'duplicate_ignored' });
              }
              if (signedYcloudEventId) {
                const eventDuplicateUrl = SUPABASE_URL + '/rest/v1/whatsapp_messages?metadata->>ycloud_event_id=eq.' + encodeURIComponent(signedYcloudEventId) + '&select=id&limit=1';
                const eventDuplicateRes = await fetch(eventDuplicateUrl, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } });
                if (eventDuplicateRes.ok && (await eventDuplicateRes.json()).length > 0) {
                  console.log('[WEBHOOK] Evento YCloud duplicado ignorado');
                  return res.status(200).json({ status: 'duplicate_ignored' });
                }
              }
            } catch (duplicateError) {
              console.warn('[WEBHOOK DUPLICATE CHECK WARN]', errorCode(duplicateError));
            }
          }

          let messageText = '';
          let mediaType = msg.type || 'text';
          let locationObj = null;
          let audioSummaryStatus = null;
          let audioSummarySource = '';
          let audioSummaryError = null;

          // A) Procesamiento de Mensajes de Voz / Audio
          if (msg.type === 'audio' && msg.audio) {
            console.log('[WEBHOOK AUDIO] Resumiendo nota de voz:', JSON.stringify({ direction: messageDirection, sourceEvent: messageSourceEvent, hasYcloudLink: isTrustedYCloudMediaLink(msg.audio.link), hasMediaId: Boolean(msg.audio.id) }));
            try {
              const audioSummary = await summarizeWhatsAppAudio(msg.audio, messageDirection);
              messageText = audioSummary.summary;
              audioSummaryStatus = 'ready';
              audioSummarySource = audioSummary.source || '';
              console.log('[WEBHOOK AUDIO] Resumen CRM generado:', JSON.stringify({ direction: messageDirection, source: audioSummary.source, chars: messageText.length }));
            } catch(aErr) {
              audioSummaryStatus = 'pending';
              audioSummaryError = audioSummaryErrorInfo(aErr);
              console.error('[AUDIO SUMMARY ERROR]', errorCode(aErr));
            }
            if (!messageText) { audioSummaryStatus = 'pending'; messageText = '[Nota de voz pendiente de resumen]'; }
          } else if (msg.type === 'location' && msg.location) {
            // B) Ubicación Nativa de WhatsApp
            mediaType = 'location';
            locationObj = {
              latitude: msg.location.latitude,
              longitude: msg.location.longitude,
              name: msg.location.name,
              address: msg.location.address
            };
            messageText = `📍 Ubicación compartida por WhatsApp: ${msg.location.name || ''} ${msg.location.address || ''}`;
          } else if (msg.type === 'text' && msg.text) {
            messageText = msg.text.body;
          } else {
            messageText = `Mensaje de WhatsApp (${msg.type || 'multimedia'})`;
          }

          // C) Resolver Ubicación (Google Maps URL o Coordenadas)
          const locResult = await processLocationInput(locationObj || messageText);
          const hasExactLocation = Boolean(locResult && locResult.lat != null && locResult.lng != null);
          const finalMapsUrl = hasExactLocation ? locResult.resolvedUrl : '';
          // Un distrito solo se conserva si venía literalmente en la dirección
          // nativa o en el enlace expandido. Las coordenadas solas no bastan
          // para adivinarlo.
          const verifiedLocationDistrict = String(locResult?.district || '').trim();

          console.log('[WEBHOOK PROCESSING]', JSON.stringify(sanitizeWebhookProcessing({
            direction: messageDirection,
            messageType: mediaType,
            hasLocation: Boolean(finalMapsUrl || verifiedLocationDistrict),
            audioSummaryStatus
          })));

          // D) Consultar el cliente sin mutarlo. La creación, asociación o
          // actualización ocurre únicamente después del compromiso canónico.
          let clientId = null;
          let existingClientName = '';
          let notesContext = '';
          try {
            const clientRes = await fetch(`${SUPABASE_URL}/rest/v1/clients?phone_number=eq.${senderPhone}&select=*`, {
              headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
            });
            if (clientRes.ok) {
              const clients = await clientRes.json();
              if (clients && clients.length > 0) {
                clientId = clients[0].id;
                existingClientName = clients[0].name || '';
                notesContext = clients[0].notes_context || '';
              }
            }
          } catch(cErr) {
            console.error('[SUPABASE CLIENT LOOKUP ERROR]', errorCode(cErr));
          }

          // E) Guardar primero en la fuente canónica. Esta tabla no recibe
          // client_id en el contrato actual, por lo que una identidad pendiente
          // es válida y no requiere migración.
          const traceStartedAt = new Date().toISOString();
          const whatsappSaveResponse = await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_messages`, {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_KEY,
              'Authorization': `Bearer ${SUPABASE_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'resolution=merge-duplicates'
            },
            body: JSON.stringify([{
              id: messageId,
              phone: senderPhone,
              title: identityLabel,
              text: messageText,
              maps_url: finalMapsUrl || null,
              app_name: messageSourceLabel,
            metadata: attachCommercialEvidence({ direction: messageDirection, historical: isHistoricalMessage, source_event: messageSourceEvent, ycloud_event_id: body?.id || null, ycloud_message_id: msg.id || null, wamid: msg.wamid || null, media_type: mediaType, profile_name: profileName || null, profile_username: profileUsername || null, from_user_id: fromUserId || null, identity_aliases: identityAliases, identity_source: profileName ? 'cloud_profile' : (profileUsername ? 'cloud_username' : 'phone_fallback'), location_district: verifiedLocationDistrict || null, location_district_source: verifiedLocationDistrict ? 'maps_or_native_address' : null, audio_summary_status: audioSummaryStatus, audio_summary_source: audioSummarySource || null, audio_summary_error_code: audioSummaryError?.code || null, audio_summary_error: audioSummaryError?.detail || null, audio_summary_updated_at: audioSummaryStatus ? new Date().toISOString() : null }, commercialEvidence),
              timestamp: msg.timestamp ? (parseInt(msg.timestamp) * 1000) : Date.now()
            }])
          }).catch(e => { console.warn('[SUPABASE WA MSG SAVE WARN]', errorCode(e)); return null; });
          const traceSecretValue = traceSecret(TRACE_HMAC_KEY);
          // La fuente canónica es el compromiso de durabilidad de esta ruta.
          // Si no se conserva, responder éxito impediría que Meta/YCloud reintente
          // y además permitiría efectos posteriores sobre un mensaje inexistente.
          if (!whatsappSaveResponse?.ok) {
            const operationId = traceSecretValue ? operationIdFromReference('whatsapp', messageId, traceSecretValue) : null;
            if (operationId && traceSecretValue) {
              const traceTask = traceWhatsApp({
                operation_id: operationId,
                event_id: eventIdFor(operationId, 'whatsapp_storage_failed', `store:${messageId}:failed`, traceSecretValue),
                operation_type: 'whatsapp_receive',
                stage: 'whatsapp_storage_failed',
                outcome: 'failed',
                started_at: traceStartedAt,
                ended_at: new Date().toISOString(),
                component: 'webhook',
                component_version: traceVersion(),
                message_refs: [hashReference('message', messageId, traceSecretValue)],
                error_code: 'canonical_message_storage_failed',
                counts: { messages_received: 1, messages_persisted: 0 }
              });
              waitUntil(traceTask);
            } else if (!traceSecretValue && !traceConfigWarned) {
              traceConfigWarned = true;
              console.warn('[YARBI TRACE WEBHOOK]', traceConfigError(TRACE_HMAC_KEY));
            }
            // 503 expresa un fallo temporal del almacenamiento aguas abajo. No
            // programar IA, invalidar caché ni extraer datos: el proveedor puede
            // reentregar el mismo evento y la deduplicación volverá a comprobarlo.
            console.warn('[SUPABASE WA MSG SAVE WARN] No se confirmó persistencia canónica', whatsappSaveResponse?.status || 'network_error');
            return res.status(503).json({
              error: 'No se pudo conservar el mensaje de WhatsApp; se reintentará la entrega.',
              error_code: 'canonical_message_storage_failed',
              retryable: true
            });
          }

          // F) Solo después del compromiso canónico se permite mutar clients.
          // Si esto falla, el mensaje permanece preservado y la identidad queda
          // sin asociar para que el procesador la trate con su contrato normal.
          let clientAssociationError = null;
          try {
            if (clientId && profileName && isPlaceholderName(existingClientName)) {
              const profileUpdate = await fetch(SUPABASE_URL + '/rest/v1/clients?id=eq.' + encodeURIComponent(clientId), {
                method: 'PATCH',
                headers: {
                  'apikey': SUPABASE_KEY,
                  'Authorization': 'Bearer ' + SUPABASE_KEY,
                  'Content-Type': 'application/json',
                  'Prefer': 'return=representation'
                },
                body: JSON.stringify({ name: profileName })
              });
              if (!profileUpdate.ok) throw new Error('client_profile_update_failed');
              existingClientName = profileName;
            } else if (!clientId) {
              const newClientRes = await fetch(`${SUPABASE_URL}/rest/v1/clients`, {
                method: 'POST',
                headers: {
                  'apikey': SUPABASE_KEY,
                  'Authorization': `Bearer ${SUPABASE_KEY}`,
                  'Content-Type': 'application/json',
                  'Prefer': 'return=representation'
                },
                body: JSON.stringify([{
                  phone_number: senderPhone,
                  name: identityLabel,
                  address_summary: hasExactLocation ? locResult.formattedAddress : ''
                }])
              });
              if (!newClientRes.ok) throw new Error('client_create_failed');
              const created = await newClientRes.json();
              if (!created?.[0]?.id) throw new Error('client_create_unconfirmed');
              clientId = created[0].id;
              existingClientName = created[0].name || existingClientName;
              notesContext = created[0].notes_context || notesContext;
            }
          } catch (clientError) {
            clientAssociationError = clientError;
            clientId = null;
            console.warn('[SUPABASE CLIENT POST-CANONICAL ERROR]', errorCode(clientError));
          }

          // La copia legacy queda intacta, pero sucede después de la fuente
          // canónica y nunca define si una entrega debe reintentarse.
          const msgPayload = {
            id: messageId,
            client_id: clientId,
            phone_number: senderPhone,
            sender: messageDirection === 'outgoing' ? 'operator' : 'client',
            content: messageText,
            media_type: mediaType,
            maps_url: finalMapsUrl || null,
            raw_payload: { ...msg, _yarbi: { direction: messageDirection, historical: isHistoricalMessage, source_event: messageSourceEvent, profile_name: profileName || null, profile_username: profileUsername || null, from_user_id: fromUserId || null, identity_aliases: identityAliases } }
          };
          await fetch(`${SUPABASE_URL}/rest/v1/messages`, {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_KEY,
              'Authorization': `Bearer ${SUPABASE_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'resolution=merge-duplicates'
            },
            body: JSON.stringify([msgPayload])
          }).catch(e => console.warn('[SUPABASE MSG SAVE WARN]', errorCode(e)));

          if (whatsappSaveResponse?.ok && traceSecretValue) {
            const operationId = operationIdFromReference('whatsapp', messageId, traceSecretValue);
            // La traza es append-only y usa una operación propia del ingreso de
            // WhatsApp. Se agenda fuera del camino comercial: el procesador
            // posterior crea su propia operación y se vincula por referencias
            // hash, sin depender de que esta escritura haya terminado.
            const traceTask = traceWhatsApp({
              operation_id: operationId,
              event_id: eventIdFor(operationId, 'whatsapp_stored', `store:${messageId}`, traceSecretValue),
              operation_type: 'whatsapp_receive',
              stage: clientAssociationError ? 'whatsapp_client_association_failed' : 'whatsapp_stored',
              // El cierre de operación se registra a continuación; esta etapa
              // debe ser fallida para conservar el error original en el ledger.
              outcome: clientAssociationError ? 'failed' : 'completed',
              started_at: traceStartedAt,
              ended_at: new Date().toISOString(),
              component: 'webhook',
              component_version: traceVersion(),
              message_refs: [hashReference('message', messageId, traceSecretValue)],
              error_code: clientAssociationError ? 'client_association_failed' : null,
              counts: { messages_received: 1, messages_persisted: 1, client_association_failed: clientAssociationError ? 1 : 0 }
            });
            waitUntil(traceTask);
          }
          else if (whatsappSaveResponse?.ok && !traceSecretValue && !traceConfigWarned) {
            traceConfigWarned = true;
            console.warn('[YARBI TRACE WEBHOOK]', traceConfigError(TRACE_HMAC_KEY));
          }
          if (whatsappSaveResponse?.ok && !isHistoricalMessage && audioSummaryStatus !== 'pending') scheduleCanonicalProcessing(messageId);
          if (whatsappSaveResponse?.ok && !isHistoricalMessage && audioSummaryStatus === 'pending') scheduleStoredVoiceNoteRetry(messageId);

          // Un chat nuevo invalida cualquier resumen breve que pueda estar en memoria.
          if (whatsappSaveResponse?.ok && typeof whatsappMessagesHandler.invalidateMemoryCache === 'function') {
            whatsappMessagesHandler.invalidateMemoryCache(senderPhone);
          }

          // G) Extracción estructurada de bajo costo con Gemini Flash-Lite
          // El historial y los mensajes salientes se guardan primero. No deben crear
          // visitas/alertas antiguas ni inferencias comerciales como si fueran nuevos.
          if (ENABLE_LEGACY_WEBHOOK_EXTRACTION && GEMINI_KEY && messageDirection === 'incoming' && !isHistoricalMessage) {
            try {
              const currentDateStr = new Intl.DateTimeFormat('en-CA', {
                timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit'
              }).format(new Date());
              const priorHistory = await loadRecentClientHistory(senderPhone);
              const priorHistoryText = priorHistory.map(m => '[' + (m.sender || m.title || 'Contacto') + '] ' + (m.content || m.text || '')).join('\n').slice(-24000);
              const promptInstruction = `Eres un asistente operativo y CRM experto en gas natural e instalaciones técnicas en Lima, Perú.
Analiza la siguiente conversación de WhatsApp del cliente y extrae la información en JSON estricto.

FECHA ACTUAL: ${currentDateStr}

HISTORIAL TÉCNICO Y NOTAS ACUMULADAS DEL CLIENTE:
${notesContext || 'Sin historial previo registrado.'}

CONVERSACIÓN PREVIA DEL MISMO CLIENTE (usar para resolver referencias como "mañana", "lo de antes" o "confirmado"):
${priorHistoryText}

MENSAJE RECIBIDO DE WHATSAPP:
Cliente: "${identityLabel}" (Tel: ${senderPhone})
Mensaje: "${messageText}"
Ubicación Detectada: "${finalMapsUrl}"
Distrito verificado por enlace o ubicación nativa: "${verifiedLocationDistrict || ''}"

REGLAS DE EXTRACCIÓN:
1. "has_actionable_request": true si el cliente solicita o confirma una visita, cotización, trabajo de construcción o seguimiento.
2. "type": "visita" | "construccion" | "seguimiento" | "ninguno"
3. "client_name": Nombre completo detectado del cliente.
4. "service": Descripción detallada del trabajo o falla técnica.
5. "date": Fecha acordada en formato YYYY-MM-DD (Calcula con respecto a la fecha actual si dice "mañana", "este viernes", etc.).
6. "time": Hora acordada en formato HH:mm (formato 24 Horas).
7. "location": Dirección o distrito mencionado.
8. "coordinates": { "lat": numero, "lng": numero } si hay mapa, o null.
9. "maps_url": Enlace exacto a Google Maps.
10. "price": Monto en soles si fue mencionado (ej. 150.00), o null.
11. "service_details": Lista de hasta tres servicios adicionales detectados, o [].
12. "summary_update": Breve resumen para actualizar la memoria acumulada del cliente.

REGLA CRITICA: nunca inventes coordenadas. Usa solamente la ubicacion exacta verificada por el servidor. Si esta vacia, devuelve coordinates:null y maps_url:"".

DEBES RESPONDER ÚNICAMENTE CON UN OBJETO JSON VÁLIDO CON ESTE ESQUEMA:
{
  "has_actionable_request": boolean,
  "type": "visita" | "construccion" | "seguimiento" | "ninguno",
  "client_name": string,
  "service": string,
  "date": string | null,
  "time": string | null,
  "location": string,
  "coordinates": { "lat": number, "lng": number } | null,
  "maps_url": string,
  "price": number | null,
  "service_details": string[],
  "summary_update": string
}`;

              const llmRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_ANALYSIS_MODEL}:generateContent?key=${GEMINI_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contents: [{ parts: [{ text: promptInstruction }] }],
                  generationConfig: { responseMimeType: 'application/json', temperature: 0.1 }
                })
              });

              if (llmRes.ok) {
                const llmData = await llmRes.json();
                const jsonText = llmData.candidates?.[0]?.content?.parts?.[0]?.text;
                if (jsonText) {
                  const extractedData = JSON.parse(jsonText);
                  console.log('[LLM EXTRACTED DATA]', JSON.stringify(sanitizeExtraction(extractedData)));

                  // G) Si hay solicitud accionable, crear borrador en `draft_actions`
                  if (extractedData.has_actionable_request && extractedData.type !== 'ninguno') {
                    // Gemini clasifica; el servidor es la unica fuente valida de coordenadas.
                    const coords = hasExactLocation ? { lat: locResult.lat, lng: locResult.lng } : null;
                    const mapsLink = hasExactLocation ? finalMapsUrl : '';

                    const draftItem = {
                      client_id: clientId,
                      type: extractedData.type,
                      status: 'pending_review',
                      payload: {
                        client_name: extractedData.client_name || identityLabel,
                        phone: senderPhone,
                        service: extractedData.service || 'Servicio técnico de gas natural',
                        service_details: Array.isArray(extractedData.service_details) ? extractedData.service_details.filter(Boolean).slice(0, 3) : [],
                        date: extractedData.date || null,
                        time: extractedData.time || null,
                        location: extractedData.location || (hasExactLocation ? locResult.formattedAddress : ''),
                        coordinates: coords,
                        maps_url: mapsLink,
                        price: extractedData.price || null,
                        summary_update: extractedData.summary_update || ''
                      }
                    };

                    await fetch(`${SUPABASE_URL}/rest/v1/draft_actions`, {
                      method: 'POST',
                      headers: {
                        'apikey': SUPABASE_KEY,
                        'Authorization': `Bearer ${SUPABASE_KEY}`,
                        'Content-Type': 'application/json'
                      },
                      body: JSON.stringify([draftItem])
                    });
                    console.log('[DRAFT ACTION CREADO DE MANERA EXITOSA]:', draftItem.type);
                  }

                  // H) Actualizar Memoria Acumulada del Cliente (`clients.notes_context`)
                  if (clientId && extractedData.summary_update) {
                    const updatedNotes = ((notesContext ? notesContext + '\n' : '') + new Date().toLocaleDateString('es-PE') + ': ' + extractedData.summary_update).slice(-12000);
                    const extractedName = String(extractedData.client_name || '').trim();
                    const profileCandidate = String(profileName || '').trim();
                    const candidateName = !isPlaceholderName(extractedName) ? extractedName : profileCandidate;
                    const clientUpdate = { notes_context: updatedNotes };
                    if (!isPlaceholderName(candidateName) && (isPlaceholderName(existingClientName) || !isPlaceholderName(extractedName))) clientUpdate.name = candidateName;
                    const clientUrl = SUPABASE_URL + '/rest/v1/clients?id=eq.' + encodeURIComponent(clientId);
                    await fetch(clientUrl, {
                      method: 'PATCH',
                      headers: {
                        'apikey': SUPABASE_KEY,
                        'Authorization': `Bearer ${SUPABASE_KEY}`,
                        'Content-Type': 'application/json'
                      },
                      body: JSON.stringify(clientUpdate)
                    }).catch(e => console.warn('[CLIENT NOTES UPDATE WARN]', errorCode(e)));
                  }
                }
              }
            } catch(llmErr) {
              console.error('[LLM EXTRACTION ERROR]', errorCode(llmErr));
            }
          }
        }
      }

      return res.status(200).json({ status: 'success', message: 'Evento de WhatsApp procesado exitosamente' });
    } catch (err) {
      console.error('[WEBHOOK POST ERROR]', errorCode(err));
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Método no permitido' });
}
