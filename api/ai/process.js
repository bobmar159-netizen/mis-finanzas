const { waitUntil } = require('@vercel/functions');
const { buildObservationRows, normalizeObservationBundle } = require('../../lib/yarbi-observations');
const { buildContactStatusPatch, normalizeStatusEvidence } = require('../../lib/yarbi-statuses');
const { buildHabitRpcPayload, normalizeHabitCandidates } = require('../../lib/yarbi-habits');
const { buildReplyStyleRpcPayload, normalizeReplyStylePatterns, sanitizeStyleExample } = require('../../lib/yarbi-reply-style');
const { normalizeDeclaredIdentity, buildContactNamePatch } = require('../../lib/yarbi-contact-identity');
const { detectAgendaClientSignal } = require('../../lib/yarbi-agenda-client-signals');
const { errorCode, eventIdFor, hashReference, newOperationId, recordTrace, recordTerminalTrace, traceConfigError, traceSecret, traceVersion } = require('../../lib/yarbi-trace');
const { MAX_ANALYSIS_ATTEMPTS, canonicalMessagePartition, cleanPhone: canonicalPhone, failureTransition, identityPendingTransition } = require('../../lib/yarbi-processing-recovery');
const { resolveOrCreateContactByPhone } = require('../../lib/yarbi-contact-resolution');
const { inspectCommercialEvidence, updateCommercialContext } = require('../../lib/yarbi-commercial-context');
const { deriveOperationalFactsFromCommercialEvidence, upsertOperationalMemory } = require('../../lib/yarbi-operational-memory');
const { invalidateOwnerReferenceCandidates } = require('../../lib/yarbi-owner-reference-candidates');
const { invalidateCrmSearchCache } = require('../../lib/yarbi-crm-search-runtime');
const { validateRuntimeConfig } = require('../../lib/yarbi-runtime-config');

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim();
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || '';
const ASSISTANT_TOKEN = process.env.ASSISTANT_API_TOKEN || process.env.TOKEN_API_DE_ASISTENTE || '';
const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GEMINI_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_ANALYSIS_MODEL || 'gemini-3.1-flash-lite';
const TRACE_HMAC_KEY = process.env.YARBI_TRACE_HMAC_KEY || '';
let traceConfigWarned = false;

let localProcessorLock = false;
let globalReplyStyleCache = { at: 0, value: null };

// Las continuaciones deben usar un destino explícito. No existe un fallback a
// despliegues históricos o de producción.
function internalProcessorBaseUrl() {
  const configured = String(process.env.AI_PROCESSOR_URL || '').trim();
  return configured ? configured.replace(/\/$/, '') : '';
}

function authorized(req) {
  const headers = req?.headers || {};
  const raw = headers['x-assistant-token'] || headers.authorization || '';
  return Boolean(ASSISTANT_TOKEN && String(raw).replace(/^Bearer\s+/i, '').trim() === ASSISTANT_TOKEN);
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Assistant-Token');
  res.setHeader('Cache-Control', 'no-store');
}

function cleanPhone(value) {
  let phone = String(value || '').replace(/\D/g, '');
  if (phone.startsWith('51') && phone.length === 11) phone = phone.slice(2);
  return phone.slice(0, 20);
}

function inFilter(values) {
  return 'in.(' + values.map(value => String(value).replace(/[^a-zA-Z0-9_.:-]/g, '')).filter(Boolean).join(',') + ')';
}

async function filterAlreadyAnalyzed(messages) {
  if (!messages.length) return [];
  const ids = messages.map(message => message.id).filter(Boolean);
  const result = await supabase('/rest/v1/ai_message_analysis?message_id=' + encodeURIComponent(inFilter(ids)) + '&status=eq.completed&select=message_id');
  if (!result.response.ok) throw new Error('No se pudo verificar mensajes ya procesados');
  const completed = new Set((result.data || []).map(row => String(row.message_id)));
  return messages.filter(message => !completed.has(String(message.id)));
}
function queryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

async function supabase(path, options = {}) {
  const response = await fetch(SUPABASE_URL + path, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: 'Bearer ' + SUPABASE_KEY,
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  return { response, data };
}

async function claimQueuedAnalysis(limit, lockToken, priorityMessageId) {
  const result = await supabase('/rest/v1/rpc/claim_yarbi_message_analysis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_limit: limit,
      p_lock_token: lockToken,
      p_priority_message_id: priorityMessageId || null
    })
  });
  if (!result.response.ok) {
    const detail = typeof result.data === 'string' ? result.data : JSON.stringify(result.data || {});
    throw new Error('No se pudo reclamar la cola IA: ' + detail.slice(0, 500));
  }
  return Array.isArray(result.data) ? result.data : [];
}

async function patchAnalysisJobs(jobIds, payload) {
  const ids = jobIds.map(Number).filter(Number.isFinite);
  if (!ids.length) return;
  const result = await supabase('/rest/v1/ai_message_analysis?id=' + encodeURIComponent(inFilter(ids)), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!result.response.ok) throw new Error('No se pudo actualizar el estado de la cola IA');
}

async function markJobsFailed(jobs, runId, error, lockToken) {
  if (!jobs.length) return;
  const message = clampText(error?.message || error || 'Error de procesamiento', 2000);
  for (const job of jobs) {
    const transition = failureTransition(job, error);
    const query = '/rest/v1/ai_message_analysis?id=eq.' + encodeURIComponent(String(job.analysis_id))
      + '&status=eq.processing' + (lockToken ? '&lock_token=eq.' + encodeURIComponent(lockToken) : '');
    const result = await supabase(query, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({
        status: transition.status,
        processing_run_id: runId || null,
        error_message: transition.status === 'skipped' ? 'Omitido tras ' + MAX_ANALYSIS_ATTEMPTS + ' intentos (' + transition.error_code + '): ' + message : transition.error_code + ': ' + message,
        next_retry_at: transition.next_retry_at,
        completed_at: transition.completed_at,
        locked_at: null,
        lock_token: null
      })
    });
    if (!result.response.ok) throw new Error('No se pudo actualizar el fallo de la cola IA');
    if (lockToken && Array.isArray(result.data) && result.data.length === 0) console.warn('[YARBI QUEUE] Se evitó sobrescribir un trabajo reclamado por otra ejecución.');
  }
}

async function completeAnalysisJob(job, message, contactId, runId, analysis, lockToken) {
  const completedAt = new Date().toISOString();
  const result = await supabase('/rest/v1/ai_message_analysis?id=eq.' + encodeURIComponent(String(job.analysis_id))
    + '&status=eq.processing&lock_token=eq.' + encodeURIComponent(String(lockToken || '')), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({
      contact_id: contactId,
      processing_run_id: runId,
      status: 'completed',
      intent: analysis.intent || null,
      service: analysis.service || null,
      extracted_data: { ...analysis, message_timestamp: message.timestamp },
      confidence: analysis.confidence,
      requires_review: Boolean(analysis.has_actionable_request),
      error_message: null,
      analyzed_at: completedAt,
      completed_at: completedAt,
      next_retry_at: null,
      locked_at: null,
      lock_token: null
    })
  });
  if (!result.response.ok || !result.data?.[0]?.id) {
    throw new Error('No se pudo completar el análisis del mensaje ' + message.id);
  }
  return result.data[0];
}

function scheduleNextBatch(limit, delayMs = 0, continuationDepth = 1) {
  if (!ASSISTANT_TOKEN) return;
  const baseUrl = internalProcessorBaseUrl();
  const delay = delayMs > 0 ? new Promise(resolve => setTimeout(resolve, delayMs)) : Promise.resolve();
  const task = delay.then(() => fetch(baseUrl.replace(/\/$/, '') + '/api/ai/process', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Assistant-Token': ASSISTANT_TOKEN },
    body: JSON.stringify({
      limit,
      requested_by: delayMs ? 'queue-transient-retry' : 'queue-continuation',
      continuation_depth: continuationDepth
    })
  })).then(async response => {
    const result = await response.json().catch(() => ({}));
    console.log('[AI QUEUE CONTINUATION]', JSON.stringify({
      http_status: response.status,
      status: typeof result?.status === 'string' ? result.status : null,
      messages_processed: Number.isFinite(Number(result?.messages_processed)) ? Number(result.messages_processed) : null
    }));
  }).catch(error => {
    console.warn('[AI QUEUE CONTINUATION]', errorCode(error));
  });
  waitUntil(task);
}

function modelJson(data) {
  const text = data?.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '';
  const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Gemini no devolvió JSON válido');
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (_) {
    throw new Error('Gemini devolvió JSON incompleto o inválido');
  }
}

function clampText(value, max) {
  return String(value || '').trim().slice(0, max);
}

function verifiedLocationDistrict(message) {
  // The webhook adds this only after inspecting a native WhatsApp address or
  // an expanded Maps URL. It is not a model inference and never comes from
  // bare coordinates.
  return clampText(message?.metadata?.location_district || '', 160);
}

function normalizeAnalysis(value, previousSummary, messages) {
  const messageIds = (messages || []).map(message => String(message.id));
  const statusMap = { frio: 'frio', tibio: 'tibio', caliente: 'caliente', cold: 'frio', warm: 'tibio', hot: 'caliente' };
  const statusEvidence = normalizeStatusEvidence({
    ...value,
    commercial_status: statusMap[String(value?.commercial_status || '').toLowerCase()] || ''
  }, messageIds);
  const nextSteps = Array.isArray(value?.next_steps) ? value.next_steps.map(item => clampText(item, 240)).filter(Boolean).slice(0, 5) : [];
  const styleObservations = Array.isArray(value?.style_observations) ? value.style_observations.map(item => clampText(item, 180)).filter(Boolean).slice(0, 5) : [];
  return {
    summary: clampText(value?.summary || previousSummary, 6000),
    intent: clampText(value?.intent, 120),
    service: clampText(value?.service, 240),
    follow_up_status: clampText(value?.follow_up_status, 120),
    next_steps: nextSteps,
    suggested_reply: clampText(value?.suggested_reply, 1200),
    style_observations: styleObservations,
    commercial_status: statusEvidence.commercial_status,
    status_reason: statusEvidence.status_reason,
    commercial_status_source_message_ids: statusEvidence.commercial_status_source_message_ids,
    operational_status: statusEvidence.operational_status,
    operational_reason: statusEvidence.operational_reason,
    operational_status_source_message_ids: statusEvidence.operational_status_source_message_ids,
    has_actionable_request: value?.has_actionable_request === true,
    appointment: value?.appointment && typeof value.appointment === 'object' ? {
      date: value.appointment.date || null,
      time: value.appointment.time || null,
      kind: /constru|trabajo|obra/i.test(String(value.appointment.kind || '')) ? 'construccion' : 'visita',
      title: clampText(value.appointment.title, 240),
      service: clampText(value.appointment.service, 240),
      location: clampText(value.appointment.location, 500),
      maps_url: clampText(value.appointment.maps_url, 1000)
    } : null,
    observations: normalizeObservationBundle(value?.observations, messageIds),
    habit_candidates: normalizeHabitCandidates(value?.habit_candidates, messages),
    reply_style_patterns: normalizeReplyStylePatterns(value?.reply_style_patterns, messages),
    declared_identity: normalizeDeclaredIdentity(value?.declared_identity, messages),
    confidence: Number.isFinite(Number(value?.confidence)) ? Math.max(0, Math.min(1, Number(value.confidence))) : null
  };
}

function collectSanitizedExamples(rows, maximum) {
  const unique = [];
  for (const row of rows || []) {
    if (row.metadata?.direction !== 'outgoing') continue;
    const text = sanitizeStyleExample(row.text);
    if (text.length < 4 || unique.includes(text)) continue;
    unique.push(text);
    if (unique.length >= maximum) break;
  }
  return unique.reverse();
}

async function loadGlobalReplyStyleContext() {
  if (globalReplyStyleCache.value && Date.now() - globalReplyStyleCache.at < 5 * 60 * 1000) return globalReplyStyleCache.value;
  const [patternsResult, examplesResult] = await Promise.all([
    supabase('/rest/v1/yarbi_reply_style_patterns?owner_key=eq.default&status=eq.active&select=id,pattern_key,category,guidance,confidence,evidence_count,updated_at&order=evidence_count.desc,updated_at.desc&limit=24'),
    supabase('/rest/v1/whatsapp_messages?deleted_at=is.null&select=id,text,metadata,timestamp&order=timestamp.desc&limit=160')
  ]);
  const patterns = patternsResult.response.ok && Array.isArray(patternsResult.data) ? patternsResult.data : [];
  const generalExamples = examplesResult.response.ok ? collectSanitizedExamples(examplesResult.data, 12) : [];
  const value = { patterns, general_examples: generalExamples };
  globalReplyStyleCache = { at: Date.now(), value };
  return value;
}

async function loadReplyStyleContext(phone) {
  const result = await supabase('/rest/v1/whatsapp_messages?phone=eq.' + encodeURIComponent(phone) + '&deleted_at=is.null&select=text,metadata,timestamp&order=timestamp.desc&limit=40');
  const globalContext = await loadGlobalReplyStyleContext();
  return {
    patterns: globalContext.patterns,
    same_contact_examples: result.response.ok ? collectSanitizedExamples(result.data, 8) : [],
    general_examples: globalContext.general_examples
  };
}

async function loadRecentConversationContext(phone, newMessageIds) {
  const result = await supabase('/rest/v1/whatsapp_messages?phone=eq.' + encodeURIComponent(phone) + '&deleted_at=is.null&select=id,title,text,maps_url,metadata,timestamp&order=timestamp.desc&limit=24');
  if (!result.response.ok) throw new Error('No se pudo leer el contexto reciente de la conversación');
  const currentIds = new Set((newMessageIds || []).map(String));
  return (Array.isArray(result.data) ? result.data : [])
    .filter(message => !currentIds.has(String(message.id)))
    .reverse()
    .map(message => ({
      id: message.id,
      at: message.timestamp,
      name: message.title || '',
      speaker: message.metadata?.direction === 'outgoing' ? 'negocio' : 'cliente',
      text: clampText(message.text, 1200),
      maps_url: message.maps_url || '',
      location_district: verifiedLocationDistrict(message)
    }));
}

async function analyzeConversation(phone, messages, memory) {
  const compactMessages = messages.map(message => ({
    id: message.id,
    at: message.timestamp,
    name: message.title || '',
    speaker: message.metadata?.direction === 'outgoing' ? 'negocio' : 'cliente',
    text: clampText(message.text, 1800),
    maps_url: message.maps_url || '',
    location_district: verifiedLocationDistrict(message)
  }));
  const [replyStyleContext, recentConversationContext] = await Promise.all([
    loadReplyStyleContext(phone),
    loadRecentConversationContext(phone, messages.map(message => message.id))
  ]);
  const limaDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const prompt = [
    'Analiza únicamente los mensajes NUEVOS de una sola conversación de WhatsApp.',
    'No mezcles teléfonos, no inventes datos y no vuelvas a analizar conversaciones antiguas.',
    'Distingue speaker=negocio (mensaje enviado por el Maestro) de speaker=cliente. No atribuyas al cliente palabras o promesas del negocio, ni deduzcas interés o visita confirmada solo a partir de un mensaje saliente.',
    'Usa la memoria previa solo para mantener continuidad.',
    'Responde únicamente con JSON válido con este esquema:',
    '{"summary":"","intent":"","service":"","follow_up_status":"","next_steps":[],"suggested_reply":"","style_observations":[],"habit_candidates":[],"reply_style_patterns":[],"declared_identity":null,"commercial_status":"frio|tibio|caliente","status_reason":"","commercial_status_source_message_ids":[],"operational_status":"sin_accion|seguimiento_pendiente|esperando_cliente|visita_por_confirmar|visita_agendada|trabajo_agendado|trabajo_en_progreso|servicio_completado|cobro_pendiente|cerrado|cancelado","operational_reason":"","operational_status_source_message_ids":[],"has_actionable_request":false,"appointment":{"date":"YYYY-MM-DD","time":"HH:mm","kind":"visita|construccion","title":"","service":"","location":"","maps_url":""},"observations":{"facts":[],"signals":[],"inferences":[]},"confidence":0}',
    'declared_identity se usa SOLO cuando el cliente declara explícitamente su propio nombre en un mensaje entrante, por ejemplo "soy Omar Mejía", "me llamo Omar Mejía", "mi nombre es Omar Mejía", o cuando el mensaje entrante consiste claramente en un nombre personal. Usa {"name":"Omar Mejía","source_message_ids":["id_entrante"],"confidence":0.95}. No lo deduzcas del título, del perfil, de mensajes del negocio, de terceros ni de la memoria previa. Si hay duda usa null.',
    'commercial_status mide SOLO interés comercial; nunca significa que una visita o trabajo esté completado. operational_status mide SOLO el avance comprobable del seguimiento, visita, trabajo o cobro.',
    'Cada estado debe incluir sus source_message_ids con evidencia de MENSAJES NUEVOS. Si no hay evidencia suficiente para una dimensión, deja ese estado y sus IDs vacíos.',
    'En observations separa estrictamente: facts son datos expresos y confirmados; signals son conductas observables como enviar ubicación, pedir precio o confirmar disponibilidad; inferences son hipótesis y nunca hechos.',
    'Para facts reutilizables en formularios usa estas categorías exactas cuando correspondan: client_name, phone, service, appointment_date, appointment_time, price, location, district, maps_url. Normaliza appointment_date como YYYY-MM-DD, appointment_time como HH:mm y price como importe numérico en soles dentro de value. No incluyas una categoría si el dato no fue expresado.',
    'Cada observación usa {"category":"","value":"","source_message_ids":["id"],"confidence":0}. source_message_ids debe contener solo IDs de MENSAJES NUEVOS que respalden esa observación. Si no hay evidencia directa, no la incluyas.',
    'Una ubicación o enlace de Maps enviado por el cliente es una señal comercial fuerte y puede justificar commercial_status=caliente y operational_status=visita_por_confirmar. UBICACIÓN ENVIADA NO significa visita agendada, realizada ni servicio completado. Esos estados requieren confirmación explícita adicional.',
    'Si MENSAJES NUEVOS contiene location_district no vacío, ese distrito fue verificado por la dirección nativa o enlace expandido. Guárdalo como fact category=district con el ID de ese mensaje. No inventes un distrito desde coordenadas cuando location_district esté vacío.',
    'Si el último mensaje del cliente merece respuesta, suggested_reply debe ser breve, útil y parecer escrita por el negocio según el PERFIL DE ESTILO APRENDIDO y los ejemplos sanitizados. Adapta el tono a la situación del cliente; no copies literalmente un ejemplo ni reutilices nombres, precio, fecha, dirección, teléfono, enlace o promesa. Si falta un dato, pregunta o usa un marcador neutro; nunca lo inventes. Si no corresponde responder, déjalo vacío.',
    'style_observations resume patrones observables del negocio, no crea instrucciones permanentes. Las instrucciones solo se guardan tras confirmación del Maestro.',
    'habit_candidates solo describe hábitos repetibles observados en speaker=negocio. Cada elemento usa {"habit_key":"clave_estable_en_snake_case","category":"communication|follow_up|scheduling|pricing|service|general","instruction":"regla breve propuesta","source_message_ids":["id_salida"],"confidence":0}. Usa solo IDs salientes, nunca mensajes del cliente, y reutiliza la misma habit_key para el mismo patrón. No conviertas el hábito en instrucción ni afirmes que fue aprobado.',
    'reply_style_patterns describe únicamente CÓMO escribe el negocio, nunca QUÉ dato factual debe contestar. Cada elemento usa {"pattern_key":"clave_estable_en_snake_case","category":"tone|brevity|greeting|follow_up|pricing|scheduling|objection|closing|formatting","guidance":"patrón concreto y reutilizable","source_message_ids":["id_salida"],"confidence":0}. Usa solo IDs salientes NUEVOS. Reutiliza la misma pattern_key para el mismo patrón. No conviertas precios, nombres, fechas, direcciones o promesas en estilo.',
    'CONTEXTO RECIENTE sirve únicamente para unir el mensaje nuevo con lo ya coordinado. No lo trates como mensaje nuevo, no cites sus IDs en campos source_message_ids y no vuelvas a crear acciones antiguas.',
    'Si un mensaje NUEVO trae ubicación exacta y el CONTEXTO RECIENTE contiene una fecha y hora futura propuestas por el negocio o aceptadas por el cliente, conserva esa coordinación en appointment. No significa que ya fue guardada en agenda: es solo una propuesta para el Maestro.',
    'Si hay visita futura, appointment debe contener date YYYY-MM-DD y time HH:mm solo si aparecen o se pueden deducir con seguridad; si falta, usa null. kind es construccion solo si el chat lo expresa claramente; en cualquier otro caso usa visita.',
    'FECHA ACTUAL EN LIMA:', limaDate,
    'PERFIL DE ESTILO APRENDIDO (solo patrones repetidos con evidencia):', JSON.stringify(replyStyleContext.patterns),
    'EJEMPLOS SANITIZADOS DEL MISMO CLIENTE:', JSON.stringify(replyStyleContext.same_contact_examples),
    'EJEMPLOS SANITIZADOS GENERALES DEL NEGOCIO:', JSON.stringify(replyStyleContext.general_examples),
    'MEMORIA PREVIA:', JSON.stringify(memory || { summary: '' }),
    'TELEFONO DE ESTA CONVERSACION:', phone,
    'CONTEXTO RECIENTE ANTERIOR (solo contexto, no evidencia nueva):', JSON.stringify(recentConversationContext),
    'MENSAJES NUEVOS:', JSON.stringify(compactMessages)
  ].join('\n');
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: 900 } }),
    signal: AbortSignal.timeout(12000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.error?.message ? ': ' + clampText(data.error.message, 300) : '';
    throw new Error('Gemini HTTP ' + response.status + detail);
  }
  return normalizeAnalysis(modelJson(data), memory?.summary || '', messages);
}

const REPLY_STYLE_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    reply_style_patterns: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          pattern_key: { type: 'STRING' },
          category: { type: 'STRING' },
          guidance: { type: 'STRING' },
          source_message_ids: { type: 'ARRAY', items: { type: 'STRING' } },
          confidence: { type: 'NUMBER' }
        },
        required: ['pattern_key', 'category', 'guidance', 'source_message_ids', 'confidence']
      }
    }
  },
  required: ['reply_style_patterns']
};

async function requestBootstrapReplyStyle(samples, maximumPatterns, maxOutputTokens) {
  const prompt = [
    'Analiza únicamente CÓMO escribe este negocio en sus mensajes salientes de WhatsApp.',
    'No describas clientes, servicios concretos, precios, fechas, direcciones, teléfonos, enlaces ni promesas. Esos datos están sanitizados y nunca deben convertirse en estilo.',
    'Detecta patrones repetidos útiles para redactar respuestas nuevas: tono, brevedad, saludo, seguimiento, explicación de precios, coordinación, manejo de objeciones, cierre y formato.',
    'Devuelve únicamente el objeto JSON solicitado por el esquema, sin Markdown ni explicaciones.',
    'Incluye un patrón solo si está respaldado por al menos tres mensajes distintos. Cita únicamente IDs proporcionados. Usa la misma clave para patrones equivalentes y máximo ' + maximumPatterns + ' patrones.',
    'MENSAJES SALIENTES SANITIZADOS:', JSON.stringify(samples)
  ].join('\n');
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: REPLY_STYLE_RESPONSE_SCHEMA,
        temperature: 0.1,
        maxOutputTokens
      }
    }),
    signal: AbortSignal.timeout(20000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.error?.message ? ': ' + clampText(data.error.message, 300) : '';
    throw new Error('Gemini HTTP ' + response.status + detail);
  }
  return modelJson(data);
}

async function bootstrapReplyStyle() {
  const historyResult = await supabase('/rest/v1/whatsapp_messages?deleted_at=is.null&select=id,text,metadata,timestamp&order=timestamp.desc&limit=500');
  if (!historyResult.response.ok) throw new Error('No se pudo leer el historial saliente para aprender el estilo');
  const samples = [];
  const seen = new Set();
  for (const row of historyResult.data || []) {
    if (row.metadata?.direction !== 'outgoing') continue;
    const text = sanitizeStyleExample(row.text);
    if (text.length < 4 || seen.has(text)) continue;
    seen.add(text);
    samples.push({ id: String(row.id), text });
    if (samples.length >= 80) break;
  }
  if (samples.length < 3) return { status: 'insufficient_evidence', messages_considered: samples.length, patterns_found: 0, evidence_recorded: 0, patterns_activated: 0, reply_style_schema_ready: true };
  let parsed;
  try {
    parsed = await requestBootstrapReplyStyle(samples, 8, 2400);
  } catch (error) {
    if (!/JSON incompleto|JSON válido|Unexpected|Unterminated|after array element/i.test(String(error?.message || error))) throw error;
    parsed = await requestBootstrapReplyStyle(samples, 6, 3200);
  }
  const sourceMessages = samples.map(item => ({ id: item.id, metadata: { direction: 'outgoing' } }));
  const patterns = normalizeReplyStylePatterns(parsed?.reply_style_patterns, sourceMessages).filter(item => item.source_message_ids.length >= 3).slice(0, 8);
  const saved = await saveReplyStylePatterns({ reply_style_patterns: patterns });
  return {
    status: saved.schema_missing ? 'setup_required' : 'completed',
    messages_considered: samples.length,
    patterns_found: patterns.length,
    evidence_recorded: saved.recorded,
    patterns_activated: saved.activated || 0,
    reply_style_schema_ready: !saved.schema_missing
  };
}
async function promoteDeclaredContactName(contactId, phone, analysis) {
  const identity = analysis?.declared_identity;
  if (!identity) return { updated: false, reason: 'no_verified_name' };
  const current = await supabase('/rest/v1/crm_contacts?id=eq.' + encodeURIComponent(String(contactId)) + '&select=id,full_name,display_name,source&limit=1');
  if (!current.response.ok || !current.data?.[0]) throw new Error('No se pudo verificar el nombre actual del contacto');
  const decision = buildContactNamePatch(current.data[0], identity, phone);
  if (!decision.patch) return { updated: false, reason: decision.reason, name: identity.name };
  const updated = await supabase('/rest/v1/crm_contacts?id=eq.' + encodeURIComponent(String(contactId)), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(decision.patch)
  });
  if (!updated.response.ok || !updated.data?.[0]?.id) throw new Error('No se pudo actualizar el nombre declarado del contacto');
  return {
    updated: true,
    reason: decision.reason,
    name: identity.name,
    source_message_ids: identity.source_message_ids,
    confidence: identity.confidence
  };
}

async function getMemory(contactId) {
  const result = await supabase('/rest/v1/ai_conversation_memory?contact_id=eq.' + encodeURIComponent(String(contactId)) + '&select=*&limit=1');
  if (!result.response.ok) throw new Error('No se pudo consultar memoria IA');
  return result.data?.[0] || null;
}

async function saveMemory(contactId, current, analysis, runId) {
  const version = Math.max(1, Number(current?.customer_summary_version || 0) + 1);
  const payload = {
    contact_id: contactId,
    summary: analysis.summary || current?.summary || '',
    last_interaction_at: new Date().toISOString(),
    last_ai_interaction_at: new Date().toISOString(),
    customer_summary_version: version,
    latest_intent: analysis.intent || current?.latest_intent || null,
    latest_service: analysis.service || current?.latest_service || null,
    follow_up_status: analysis.follow_up_status || current?.follow_up_status || null,
    next_steps: analysis.next_steps
  };
  const result = await supabase('/rest/v1/ai_conversation_memory?on_conflict=contact_id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify([payload])
  });
  if (!result.response.ok || !result.data?.[0]?.id) {
    const detail = typeof result.data === 'string' ? result.data : JSON.stringify(result.data || {});
    throw new Error('No se pudo guardar memoria IA: ' + detail.slice(0, 500));
  }
  const memoryId = result.data[0].id;
  const versionResult = await supabase('/rest/v1/ai_memory_versions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates' },
    body: JSON.stringify([{ memory_id: memoryId, version, summary: payload.summary, source_processing_run_id: runId, change_reason: 'procesamiento incremental' }])
  });
  if (!versionResult.response.ok && versionResult.response.status !== 409) throw new Error('No se pudo guardar versión de memoria');
  return { ...result.data[0], version };
}

function observationsSchemaMissing(data) {
  const detail = typeof data === 'string' ? data : JSON.stringify(data || {});
  return /ai_contact_observations|PGRST205|42P01/i.test(detail);
}

async function saveContactObservations(contactId, analysisId, runId, analysis, messages) {
  const timestamps = (messages || []).map(message => Number(message?.timestamp || 0)).filter(Number.isFinite);
  const latestTimestamp = timestamps.length ? Math.max(...timestamps) : Date.now();
  const epochMs = latestTimestamp > 0 && latestTimestamp < 100000000000 ? latestTimestamp * 1000 : latestTimestamp;
  const observedAt = Number.isFinite(epochMs) ? new Date(epochMs).toISOString() : new Date().toISOString();
  const rows = buildObservationRows({
    contactId,
    analysisId,
    processingRunId: runId,
    observations: analysis?.observations,
    observedAt
  });
  if (!rows.length) return { stored: 0, schema_missing: false };
  const result = await supabase('/rest/v1/ai_contact_observations?on_conflict=dedupe_key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify(rows)
  });
  if (!result.response.ok) {
    if (observationsSchemaMissing(result.data)) {
      console.warn('[YARBI OBSERVATIONS] La migración ai_contact_observations aún no está aplicada.');
      return { stored: 0, schema_missing: true };
    }
    throw new Error('No se pudieron guardar hechos, señales e inferencias');
  }
  return { stored: Array.isArray(result.data) ? result.data.length : 0, schema_missing: false };
}

async function saveHabitCandidates(analysis) {
  const candidates = Array.isArray(analysis?.habit_candidates) ? analysis.habit_candidates : [];
  let recorded = 0;
  for (const candidate of candidates) {
    const result = await supabase('/rest/v1/rpc/record_yarbi_habit_candidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildHabitRpcPayload(candidate))
    });
    if (!result.response.ok) {
      const detail = typeof result.data === 'string' ? result.data : JSON.stringify(result.data || {});
      if (/record_yarbi_habit_candidate|yarbi_habit_candidates|PGRST202|42P01/i.test(detail)) {
        return { recorded, schema_missing: true };
      }
      throw new Error('No se pudo registrar evidencia de hábito: ' + detail.slice(0, 300));
    }
    recorded += 1;
  }
  return { recorded, schema_missing: false };
}

async function saveReplyStylePatterns(analysis) {
  const patterns = Array.isArray(analysis?.reply_style_patterns) ? analysis.reply_style_patterns : [];
  let recorded = 0;
  let activated = 0;
  for (const pattern of patterns) {
    const result = await supabase('/rest/v1/rpc/record_yarbi_reply_style_pattern', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildReplyStyleRpcPayload(pattern))
    });
    if (!result.response.ok) {
      const detail = typeof result.data === 'string' ? result.data : JSON.stringify(result.data || {});
      if (/record_yarbi_reply_style_pattern|yarbi_reply_style_patterns|PGRST202|42P01/i.test(detail)) {
        return { recorded, schema_missing: true };
      }
      throw new Error('No se pudo registrar evidencia de estilo: ' + detail.slice(0, 300));
    }
    recorded += 1;
    if (result.data?.status === 'active') activated += 1;
  }
  if (recorded) globalReplyStyleCache = { at: 0, value: null };
  return { recorded, activated, schema_missing: false };
}

async function updateContactStatuses(contactId, analysis, messages) {
  const currentResult = await supabase('/rest/v1/crm_contacts?id=eq.' + encodeURIComponent(String(contactId)) + '&select=commercial_status,status_reason,commercial_status_event_at,operational_status,operational_reason,operational_event_at&limit=1');
  if (!currentResult.response.ok) throw new Error('No se pudo consultar el estado actual del cliente');
  const patch = buildContactStatusPatch(currentResult.data?.[0] || {}, analysis, messages);
  if (!Object.keys(patch).length) return { updated: false, interest_updated: false, operational_updated: false };
  const updated = await supabase('/rest/v1/crm_contacts?id=eq.' + encodeURIComponent(String(contactId)), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(patch)
  });
  if (!updated.response.ok || !updated.data?.[0]?.id) throw new Error('No se pudo actualizar el estado trazable del cliente');
  return {
    updated: true,
    interest_updated: Object.hasOwn(patch, 'commercial_status'),
    operational_updated: Object.hasOwn(patch, 'operational_status')
  };
}

function normalizeAppointmentDateTime(appointment) {
  const date = String(appointment?.date || '').match(/^\d{4}-\d{2}-\d{2}$/)?.[0] || '';
  const time = String(appointment?.time || '').match(/^([01]\d|2[0-3]):[0-5]\d$/)?.[0] || '';
  if (!date || !time) return null;
  const startsAt = new Date(`${date}T${time}:00-05:00`);
  if (Number.isNaN(startsAt.getTime())) return null;
  return { date, time, startsAt };
}

// Un mensaje de viaje o indisponibilidad no cambia una agenda por sí mismo.
// Solo crea una alerta enlazada a la próxima visita para que el Maestro decida.
function detectAgendaAvailabilityConflict(messages) {
  const unavailable = /\b(?:me\s+voy\s+(?:de\s+)?viaje|voy\s+(?:a\s+)?(?:viajar|salir\s+de\s+viaje)|saldr[eé]\s+de\s+viaje|estar[eé]\s+de\s+viaje|estoy\s+de\s+viaje|no\s+(?:voy\s+a\s+)?(?:estar|poder|atender)|no\s+me\s+encuentro)\b/i;
  for (const message of messages || []) {
    if (message?.metadata?.historical || message?.metadata?.direction === 'outgoing') continue;
    const text = clampText(message?.text, 600);
    if (unavailable.test(text)) return { message_id: String(message.id || ''), text, timestamp: Number(message.timestamp || Date.now()) };
  }
  return null;
}

async function findUpcomingAgendaForAvailabilityConflict(contactId, signal = null) {
  const now = new Date();
  // Una nota puede llegar después de una cita fallida del mismo día. Buscar solo
  // desde "ahora" hacía invisible precisamente ese caso (por ejemplo, visita
  // de 09:00 y audio de reprogramación por la tarde). Conservamos una ventana
  // corta hacia atrás y elegimos el evento más cercano al mensaje.
  const recentPast = new Date(now.getTime() - 36 * 60 * 60 * 1000);
  const horizon = new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000);
  const result = await supabase('/rest/v1/agenda_events?contact_id=eq.' + encodeURIComponent(String(contactId))
    + '&starts_at=gte.' + encodeURIComponent(recentPast.toISOString())
    + '&starts_at=lte.' + encodeURIComponent(horizon.toISOString())
    + '&status=in.%28pending%2Cconfirmed%29&select=id,event_type,title,service,location,maps_url,starts_at,status&order=starts_at.asc&limit=12');
  if (!result.response.ok) throw new Error('No se pudo verificar la visita futura del cliente');
  const rows = Array.isArray(result.data) ? result.data.filter(row => row?.starts_at) : [];
  if (!rows.length) return null;
  const signalAt = Number(signal?.timestamp || 0) || now.getTime();
  const past = rows
    .filter(row => new Date(row.starts_at).getTime() <= signalAt)
    .sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime());
  const recent = past.find(row => signalAt - new Date(row.starts_at).getTime() <= 36 * 60 * 60 * 1000);
  if (recent) return recent;
  return rows
    .filter(row => new Date(row.starts_at).getTime() > signalAt)
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())[0] || null;
}

function applyAgendaAvailabilityConflict(analysis, signal, agendaEvent) {
  if (!analysis || !signal || !agendaEvent) return analysis;
  analysis.operational_status = 'esperando_cliente';
  analysis.operational_reason = 'El cliente informó indisponibilidad antes de una visita agendada; requiere confirmación para reprogramar o cancelar.';
  analysis.operational_status_source_message_ids = [signal.message_id].filter(Boolean);
  analysis.follow_up_status = 'Confirmar reprogramación de visita por indisponibilidad del cliente.';
  analysis.next_steps = ['Preguntar si desea reprogramar la visita agendada.'];
  analysis.has_actionable_request = true;
  return analysis;
}

async function createAgendaAvailabilityAlert(contactId, analysisId, signal, agendaEvent) {
  if (!signal || !agendaEvent?.id) return null;
  const duplicate = await supabase('/rest/v1/ai_intelligent_alerts?contact_id=eq.' + encodeURIComponent(String(contactId))
    + '&agenda_event_id=eq.' + encodeURIComponent(String(agendaEvent.id))
    + '&alert_type=eq.availability_conflict&status=in.%28open%2Cread%29&select=id&limit=1');
  if (!duplicate.response.ok) throw new Error('No se pudo comprobar alertas de disponibilidad duplicadas');
  if (duplicate.data?.[0]?.id) return { id: duplicate.data[0].id, created: false, duplicate: true };
  const title = clampText('Reprogramar: ' + (agendaEvent.title || agendaEvent.service || 'visita agendada'), 240);
  const reason = clampText('El cliente informó que no estará disponible: ' + signal.text + '. Confirma si deseas reprogramar o cancelar. La agenda original no fue modificada.', 1000);
  const created = await supabase('/rest/v1/ai_intelligent_alerts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify([{
      contact_id: contactId,
      analysis_id: analysisId || null,
      agenda_event_id: agendaEvent.id,
      alert_type: 'availability_conflict',
      title,
      reason,
      severity: 'high',
      status: 'open'
    }])
  });
  if (!created.response.ok || !created.data?.[0]?.id) throw new Error('No se pudo guardar la alerta de disponibilidad');
  return { id: created.data[0].id, created: true };
}

function applyAgendaClientUpdate(analysis, signal, agendaEvent) {
  if (!analysis || !signal || !agendaEvent) return analysis;
  const isWork = /trabajo|constru|obra/i.test(String(agendaEvent.event_type || agendaEvent.title || ''));
  const statusByKind = {
    confirm: isWork ? 'trabajo_agendado' : 'visita_agendada',
    cancel: 'cancelado',
    reprogram: 'esperando_cliente'
  };
  const nextByKind = {
    confirm: 'Mantener la agenda y verificar el resultado después de la fecha programada.',
    cancel: 'Preguntar al Maestro si desea cancelar o conservar la agenda.',
    reprogram: 'Preguntar al Maestro la nueva fecha antes de modificar la agenda.'
  };
  analysis.operational_status = statusByKind[signal.kind] || analysis.operational_status;
  analysis.operational_reason = clampText('El cliente ' + (signal.kind === 'confirm' ? 'confirmó' : signal.kind === 'cancel' ? 'solicitó cancelar' : 'solicitó reprogramar') + ' la agenda: ' + signal.text, 500);
  analysis.operational_status_source_message_ids = [signal.message_id];
  analysis.follow_up_status = signal.kind === 'confirm' ? 'agenda_confirmada_por_cliente' : signal.kind === 'cancel' ? 'cancelacion_por_confirmar' : 'reprogramacion_pendiente';
  analysis.next_steps = [nextByKind[signal.kind], ...(analysis.next_steps || [])].filter(Boolean).slice(0, 5);
  analysis.has_actionable_request = true;
  return analysis;
}

async function createAgendaClientUpdateAlert(contactId, analysisId, signal, agendaEvent) {
  if (!signal || !agendaEvent) return { id: null, created: false };
  const typeByKind = { confirm: 'agenda_confirmed_by_client', cancel: 'agenda_cancel_requested', reprogram: 'agenda_reschedule_requested' };
  const titleByKind = { confirm: 'Cliente confirmó: ', cancel: 'Cliente pidió cancelar: ', reprogram: 'Cliente pidió reprogramar: ' };
  const alertType = typeByKind[signal.kind];
  if (!alertType) return { id: null, created: false };
  const existing = await supabase('/rest/v1/ai_intelligent_alerts?contact_id=eq.' + encodeURIComponent(String(contactId))
    + '&agenda_event_id=eq.' + encodeURIComponent(String(agendaEvent.id))
    + '&alert_type=eq.' + encodeURIComponent(alertType)
    + '&status=in.%28open%2Cread%29&select=id&limit=1');
  if (!existing.response.ok) throw new Error('No se pudo comprobar alerta de cambio de agenda');
  if (existing.data?.[0]?.id) return { id: existing.data[0].id, created: false };
  const created = await supabase('/rest/v1/ai_intelligent_alerts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify([{
      contact_id: contactId,
      analysis_id: analysisId || null,
      agenda_event_id: agendaEvent.id,
      alert_type: alertType,
      title: clampText(titleByKind[signal.kind] + (agendaEvent.title || agendaEvent.service || 'agenda'), 240),
      reason: clampText(signal.text + ' La agenda original no fue modificada; requiere decisión del Maestro.', 1000),
      severity: signal.kind === 'confirm' ? 'normal' : 'high',
      status: 'open'
    }])
  });
  if (!created.response.ok || !created.data?.[0]?.id) throw new Error('No se pudo guardar alerta de cambio de agenda');
  return { id: created.data[0].id, created: true };
}

async function createAgendaEvent(contactId, analysis) {
  const appointment = normalizeAppointmentDateTime(analysis.appointment);
  if (!appointment) return null;
  // Un chat solo propone: el formulario existente y la orden explícita
  // del Maestro son el único camino para confirmar y persistir una agenda.
  return {
    id: null,
    created: false,
    requires_review: true,
    appointment: {
      date: appointment.date,
      time: appointment.time,
      kind: analysis.appointment?.kind === 'construccion' ? 'construccion' : 'visita',
      title: clampText(analysis.appointment?.title || analysis.service || 'Visita técnica', 240),
      service: clampText(analysis.appointment?.service || analysis.service || '', 500),
      location: clampText(analysis.appointment?.location || '', 1000),
      maps_url: clampText(analysis.appointment?.maps_url || '', 2000)
    }
  };
}
async function createIntelligentAlert(contactId, analysis, analysisId, agendaEvent) {
  const hasFollowUp = Boolean(String(analysis.follow_up_status || '').trim());
  const hasSuggestedReply = Boolean(String(analysis.suggested_reply || '').trim());
  if (!agendaEvent && !hasFollowUp && !hasSuggestedReply) return null;
  const alertType = agendaEvent ? 'agenda_proposal_ready' : 'follow_up';
  const proposalKind = agendaEvent?.appointment?.kind === 'construccion' || /constru|trabajo|obra/i.test(String(analysis.appointment?.kind || analysis.appointment?.title || analysis.service || '')) ? 'Construcción' : 'Visita';
  const proposalWhen = agendaEvent ? ` · ${agendaEvent.appointment.date} ${agendaEvent.appointment.time}` : '';
  const title = clampText(agendaEvent ? `${proposalKind} por confirmar${proposalWhen}` : (hasSuggestedReply ? `Respuesta sugerida: ${analysis.service || analysis.intent || 'Cliente'}` : `Seguimiento: ${analysis.service || analysis.intent || 'Cliente'}`), 240);
  const reasonBase = analysis.status_reason || analysis.summary || analysis.follow_up_status || 'Información relevante detectada por Yarbi.';
  const reason = clampText(reasonBase + (hasSuggestedReply ? '\nRespuesta sugerida: ' + analysis.suggested_reply : ''), 1000);
  let duplicateQuery = '/rest/v1/ai_intelligent_alerts?contact_id=eq.' + encodeURIComponent(String(contactId)) + '&alert_type=eq.' + encodeURIComponent(alertType) + '&status=in.%28open%2Cread%29&select=id&limit=1';
  duplicateQuery += agendaEvent ? '&analysis_id=eq.' + encodeURIComponent(String(analysisId)) : '&title=eq.' + encodeURIComponent(title);
  const existing = await supabase(duplicateQuery);
  if (!existing.response.ok) throw new Error('No se pudo consultar duplicados de Alertas');
  if (existing.data?.[0]?.id) return { id: existing.data[0].id, created: false };
  const created = await supabase('/rest/v1/ai_intelligent_alerts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify([{
      contact_id: contactId,
      analysis_id: analysisId || null,
      agenda_event_id: agendaEvent?.id || null,
      alert_type: alertType,
      title,
      reason,
      severity: agendaEvent ? 'high' : 'normal',
      status: 'open'
    }])
  });
  if (!created.response.ok || !created.data?.[0]?.id) throw new Error('No se pudo guardar alerta inteligente');
  return { id: created.data[0].id, created: true };
}
async function countProcessingRows(path, label) {
  const result = await supabase(path, { method: 'HEAD', headers: { Prefer: 'count=exact' } });
  if (!result.response.ok) {
    const detail = typeof result.data === 'string' ? result.data : JSON.stringify(result.data || {});
    throw new Error('No se pudo consultar ' + (label || 'la cola') + ' (HTTP ' + result.response.status + '): ' + (detail.slice(0, 300) || 'sin detalle'));
  }
  const count = Number.parseInt((result.response.headers.get('content-range') || '').split('/').pop(), 10);
  return Number.isFinite(count) ? count : 0;
}

async function processingStatusPayload() {
  // Evita un anti-join PostgREST que puede fallar cuando su caché de relaciones
  // todavía no conoce la FK, aun cuando las tablas de Yarbi existen.
  const audioCountsPromise = Promise.all([
    countProcessingRows('/rest/v1/whatsapp_messages?metadata-%3E%3Eaudio_summary_status=eq.pending&select=id', 'notas de voz pendientes'),
    countProcessingRows('/rest/v1/whatsapp_messages?metadata-%3E%3Eaudio_summary_status=eq.failed&select=id', 'notas de voz con error'),
    countProcessingRows('/rest/v1/whatsapp_messages?metadata-%3E%3Eaudio_summary_status=eq.unavailable&select=id', 'notas de voz antiguas no recuperables')
  ]);
  const statusNow = new Date().toISOString();
  const encodedStatusNow = encodeURIComponent(statusNow);
  const [rawMessages, tracked, pending, processing, completed, skipped, failed, identityPending, failedReady, failedWaiting, failedExhausted, latest, latestFailure, nextRetry] = await Promise.all([
    countProcessingRows('/rest/v1/whatsapp_messages?deleted_at=is.null&select=id', 'mensajes de WhatsApp'),
    countProcessingRows('/rest/v1/ai_message_analysis?analysis_version=eq.1&select=id', 'análisis rastreados'),
    countProcessingRows('/rest/v1/ai_message_analysis?status=eq.pending&select=id', 'análisis pendientes'),
    countProcessingRows('/rest/v1/ai_message_analysis?status=eq.processing&select=id', 'análisis en curso'),
    countProcessingRows('/rest/v1/ai_message_analysis?status=eq.completed&select=id', 'análisis completados'),
    countProcessingRows('/rest/v1/ai_message_analysis?status=eq.skipped&select=id', 'análisis omitidos'),
    countProcessingRows('/rest/v1/ai_message_analysis?status=eq.failed&select=id', 'análisis con error'),
    countProcessingRows('/rest/v1/ai_message_analysis?status=eq.identity_pending&select=id', 'análisis con identidad pendiente'),
    countProcessingRows('/rest/v1/ai_message_analysis?status=eq.failed&attempt_count=lt.3&or=%28next_retry_at.is.null%2Cnext_retry_at.lte.' + encodedStatusNow + '%29&select=id', 'análisis listos para reintento'),
    countProcessingRows('/rest/v1/ai_message_analysis?status=eq.failed&attempt_count=lt.3&next_retry_at=gt.' + encodedStatusNow + '&select=id', 'análisis esperando reintento'),
    countProcessingRows('/rest/v1/ai_message_analysis?status=eq.failed&attempt_count=gte.3&select=id', 'análisis agotados'),
    supabase('/rest/v1/ai_message_analysis?status=eq.completed&completed_at=not.is.null&select=completed_at&order=completed_at.desc&limit=1'),
    supabase('/rest/v1/ai_message_analysis?status=eq.failed&error_message=not.is.null&select=id,message_id,error_message,attempt_count,next_retry_at,updated_at&order=updated_at.desc&limit=5'),
    supabase('/rest/v1/ai_message_analysis?status=eq.failed&attempt_count=lt.3&next_retry_at=gt.' + encodedStatusNow + '&select=next_retry_at&order=next_retry_at.asc&limit=1')
  ]);
  const [audioPending, audioFailed, audioUnavailable] = await audioCountsPromise;
  if (!latest.response.ok || !latestFailure.response.ok || !nextRetry.response.ok) throw new Error('No se pudo leer el estado de procesamiento');
  const untracked = Math.max(0, rawMessages - tracked);
  const pendingWork = pending + untracked;
  const state = processing > 0 ? 'processing' : (failed > 0 || identityPending > 0 || audioFailed > 0) ? 'needs_attention' : (pendingWork > 0 || audioPending > 0) ? 'outdated' : 'up_to_date';
  const failureRows = Array.isArray(latestFailure.data) ? latestFailure.data : [];
  const failureDetail = String(failureRows[0]?.error_message || '');
  const blocker = failed > 0 && /gemini.*(429|quota|resource_exhausted)|quota|billing|resource_exhausted/i.test(failureDetail) ? 'gemini_quota' : failed > 0 ? 'processing_failure' : audioFailed > 0 ? 'audio_summary_failure' : null;
  return {
    status: state,
    is_fully_updated: pendingWork === 0 && processing === 0 && failed === 0 && identityPending === 0 && audioPending === 0 && audioFailed === 0,
    totals: {
      raw_messages: rawMessages,
      tracked_messages: tracked,
      finalised_messages: completed + skipped,
      completed, skipped, pending, processing, failed, identity_pending: identityPending, failed_ready: failedReady, failed_waiting: failedWaiting, failed_exhausted: failedExhausted, failed_unclassified: Math.max(0, failed - failedReady - failedWaiting - failedExhausted), untracked, audio_pending: audioPending, audio_failed: audioFailed, audio_unavailable: audioUnavailable
    },
    pending_work: pendingWork + audioPending,
    audio_notes: { pending: audioPending, failed: audioFailed, unavailable: audioUnavailable },
    recovery: {
      active: processing > 0,
      retryable_ready: failedReady,
      retryable_waiting: failedWaiting,
      exhausted: failedExhausted,
      identity_pending: identityPending,
      unclassified: Math.max(0, failed - failedReady - failedWaiting - failedExhausted),
      next_retry_at: Array.isArray(nextRetry.data) ? nextRetry.data[0]?.next_retry_at || null : null,
      automatic_batch_limit: 25,
      duplicate_claim_protection: 'database-claim-lock'
    },
    last_completed_at: Array.isArray(latest.data) ? latest.data[0]?.completed_at || null : null,
    blocker,
    failure_samples: failureRows.map(row => ({
      analysis_id: Number(row.id || 0) || null,
      message_id: Number(row.message_id || 0) || null,
      attempts: Number(row.attempt_count || 0),
      next_retry_at: row.next_retry_at || null,
      updated_at: row.updated_at || null,
      error: clampText(row.error_message || '', 240)
    })),
    last_error: blocker === 'gemini_quota' ? 'Gemini no tiene cuota disponible para procesar mensajes.' : blocker === 'audio_summary_failure' ? 'Hay notas de voz que no pudieron resumirse; el diagnóstico conserva el motivo.' : blocker ? 'Hay mensajes que requieren revisión técnica.' : null
  };
}

async function recoverProcessingBacklog(limit, requestedBy) {
  if (!ASSISTANT_TOKEN) throw new Error('Falta token interno para recuperar la cola');
  const now = new Date().toISOString();
  const encodedNow = encodeURIComponent(now);
  const before = await processingStatusPayload();
  if (Number(before.totals?.processing || 0) > 0) {
    return {
      status: before.status,
      processing_status: before,
      recovery: { skipped_because_active: true, analyses_selected: 0, analyses_released: 0, batch_limit: limit, duplicate_process_prevented: true }
    };
  }

  const exhausted = await supabase('/rest/v1/ai_message_analysis?status=eq.failed&attempt_count=gte.3', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'skipped', completed_at: now, next_retry_at: null, locked_at: null, lock_token: null })
  });
  if (!exhausted.response.ok) throw new Error('No se pudieron cerrar los análisis que agotaron sus intentos');

  const candidates = await supabase('/rest/v1/ai_message_analysis?status=eq.failed&attempt_count=lt.3&or=%28next_retry_at.is.null%2Cnext_retry_at.lte.' + encodedNow + '%29&select=id&order=updated_at.asc&limit=' + encodeURIComponent(String(limit)));
  if (!candidates.response.ok) throw new Error('No se pudieron seleccionar los análisis listos para reintento');
  const candidateIds = (Array.isArray(candidates.data) ? candidates.data : []).map(row => Number(row.id || 0)).filter(Number.isFinite).filter(id => id > 0);
  let released = { response:{ ok:true }, data:[] };
  if (candidateIds.length) {
    released = await supabase('/rest/v1/ai_message_analysis?id=in.%28' + candidateIds.join('%2C') + '%29&status=eq.failed', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ next_retry_at: now, locked_at: null, lock_token: null })
    });
    if (!released.response.ok) throw new Error('No se pudieron habilitar los análisis seleccionados para reintento');
  }

  const audioCandidates = await supabase('/rest/v1/whatsapp_messages?deleted_at=is.null&metadata-%3E%3Eaudio_summary_status=in.%28pending%2Cfailed%29&select=id&order=timestamp.asc&limit=' + encodeURIComponent(String(Math.min(limit, 10))));
  if (!audioCandidates.response.ok) throw new Error('No se pudieron consultar las notas de voz pendientes');
  const baseUrl = internalProcessorBaseUrl();
  const tokenHeaders = { 'Content-Type': 'application/json', 'X-Assistant-Token': ASSISTANT_TOKEN };
  const audioRows = Array.isArray(audioCandidates.data) ? audioCandidates.data : [];

  const [analysisResponse, audioResults] = await Promise.all([
    candidateIds.length ? fetch(baseUrl + '/api/ai/process', {
      method: 'POST',
      headers: tokenHeaders,
      body: JSON.stringify({ limit, requested_by: String(requestedBy || 'yarbi-recovery').slice(0, 80), continuation_depth: 0 })
    }).then(async response => ({ http: response.status, ok: response.ok, data: await response.json().catch(() => ({})) })) : Promise.resolve({ http:200, ok:true, data:{ status:'nothing_retryable', messages_processed:0 } }),
    Promise.all(audioRows.map(async row => {
      const response = await fetch(baseUrl + '/api/webhook', {
        method: 'POST',
        headers: tokenHeaders,
        body: JSON.stringify({ action: 'summarize-voice-note', message_id: row.id })
      });
      return { message_id: row.id, http: response.status, ok: response.ok, data: await response.json().catch(() => ({})) };
    }))
  ]);

  const status = await processingStatusPayload();
  return {
    status: status.status,
    processing_status: status,
    recovery: {
      analyses_selected: candidateIds.length,
      analyses_released: Array.isArray(released.data) ? released.data.length : 0,
      analyses_exhausted_closed: Array.isArray(exhausted.data) ? exhausted.data.length : 0,
      batch_limit: limit,
      analysis_http: analysisResponse.http,
      analysis_processed: Number(analysisResponse.data?.messages_processed || 0),
      analysis_processor_status: String(analysisResponse.data?.status || ''),
      duplicate_process_prevented: analysisResponse.data?.status === 'already_running',
      audio_attempted: audioResults.length,
      audio_recovered: audioResults.filter(item => item.ok).length,
      audio_unavailable_or_failed: audioResults.filter(item => !item.ok).length
    }
  };
}
export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  if (!authorized(req)) return res.status(401).json({ error: 'No autorizado' });
  const runtime = validateRuntimeConfig({ requireProcessor: true });
  if (!runtime.ok) return res.status(503).json({ error: 'configuration_invalid', code: runtime.code });
  if (!SUPABASE_KEY) return res.status(503).json({ error: 'Falta configuración de Supabase' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  if (body.action === 'status') {
    try {
      return res.status(200).json(await processingStatusPayload());
    } catch (error) {
      const detail = String(error?.message || error);
      const missing = /ai_message_analysis|whatsapp_messages|relationship/i.test(detail);
      return res.status(missing ? 424 : 502).json({ error: missing ? 'La cola de procesamiento no está disponible aún' : 'No se pudo consultar el estado de procesamiento', detail: detail.slice(0, 300), status: missing ? 'setup_required' : 'unavailable' });
    }
  }
  if (body.action === 'recover') {
    try {
      const limit = Math.max(1, Math.min(50, Number.parseInt(body.limit, 10) || 25));
      return res.status(200).json(await recoverProcessingBacklog(limit, body.requested_by || 'yarbi-manual-recovery'));
    } catch (error) {
      return res.status(502).json({ error: 'No se pudo recuperar el procesamiento pendiente', detail: clampText(error?.message || error, 500) });
    }
  }
  if (body.action === 'bootstrap-reply-style') {
    try { return res.status(200).json(await bootstrapReplyStyle()); }
    catch (error) {
      const quota = /Gemini HTTP 429|quota|resource_exhausted/i.test(String(error?.message || error));
      const malformed = /JSON incompleto|JSON válido|Unexpected|Unterminated|after array element/i.test(String(error?.message || error));
      return res.status(quota ? 429 : 502).json({ error: quota ? 'Gemini no tiene cuota disponible para aprender el estilo.' : (malformed ? 'Gemini devolvió una respuesta incompleta. Intenta nuevamente.' : 'No se pudo preparar el estilo de respuesta') });
    }
  }
  const requestedLimit = Math.max(1, Math.min(100, Number.parseInt(body.limit, 10) || 25));
  const requestedBy = String(body.requested_by || 'yarbi').slice(0, 80);
  const priorityMessageId = clampText(body.priority_message_id || body.trigger_message_id, 240) || null;
  const continuationDepth = Math.max(0, Math.min(2, Number.parseInt(body.continuation_depth, 10) || 0));
  const traceStartedAt = new Date().toISOString();
  const traceSecretValue = traceSecret(TRACE_HMAC_KEY);
  const traceOperationId = traceSecretValue ? newOperationId('processing', traceSecretValue) : null;
  const traceProcessing = event => {
    if (!traceSecretValue || !traceOperationId) {
      if (!traceConfigWarned) {
        traceConfigWarned = true;
        console.warn('[YARBI TRACE PROCESS]', traceConfigError(TRACE_HMAC_KEY));
      }
      return;
    }
    // Cada invocación del procesador es una operación propia. Las continuaciones
    // son solicitudes nuevas, por lo que no impiden cerrar esta ejecución.
    const task = recordTerminalTrace({
      supabaseUrl: SUPABASE_URL,
      supabaseKey: SUPABASE_KEY,
      traceSecret: traceSecretValue,
      closeEventKey: `processing-close:${event.event_key || event.run_key || 'operation'}`,
      event: {
      ...event,
      operation_id: traceOperationId,
      event_id: eventIdFor(traceOperationId, event.stage, event.event_key || event.run_key || 'operation', traceSecretValue),
      operation_type: 'message_processing',
      component: 'ai_process',
      component_version: traceVersion()
      }
    })
      .then(result => {
        if (!result?.ok) console.warn('[YARBI TRACE PROCESS CLOSE]', result?.reason || 'trace_close_failed', result?.error_code || '');
        return result;
      })
      .catch(error => console.warn('[YARBI TRACE PROCESS]', errorCode(error)));
    waitUntil(task);
  };
  const identityOnlyPreview = String(process.env.VERCEL_ENV || '') === 'preview'
    && String(process.env.YARBI_PREVIEW_FUNCTIONAL_SYNTHETIC_ONLY || '').toLowerCase() === 'true'
    && String(process.env.YARBI_PREVIEW_IDENTITY_CRM_ONLY || '').toLowerCase() === 'true';
  const commercialContextPreview = identityOnlyPreview
    && String(process.env.YARBI_PREVIEW_COMMERCIAL_CONTEXT_ONLY || '').toLowerCase() === 'true';
  // La memoria operacional se limita al preview funcional mientras se valida
  // con hechos estructurados. No activa Gemini ni el flujo semántico legado.
  const operationalMemoryPreview = commercialContextPreview
    && String(process.env.YARBI_PREVIEW_OPERATIONAL_MEMORY_ONLY || '').toLowerCase() === 'true';
  const traceIdentity = ({ stage, outcome = 'completed', messageId, analysisId, contactId = null, error = null }) => {
    if (!traceSecretValue || !traceOperationId) return;
    const eventKey = `${stage}:${messageId || analysisId || 'unknown'}`;
    const task = recordTrace({
      supabaseUrl: SUPABASE_URL,
      supabaseKey: SUPABASE_KEY,
      traceSecret: traceSecretValue,
      event: {
        operation_id: traceOperationId,
        event_id: eventIdFor(traceOperationId, stage, eventKey, traceSecretValue),
        operation_type: 'message_processing',
        stage,
        outcome,
        started_at: traceStartedAt,
        ended_at: new Date().toISOString(),
        component: 'ai_process',
        component_version: traceVersion(),
        message_refs: [hashReference('message', messageId, traceSecretValue)].filter(Boolean),
        contact_refs: [hashReference('contact', contactId, traceSecretValue)].filter(Boolean),
        analysis_refs: [hashReference('analysis', analysisId, traceSecretValue)].filter(Boolean),
        error_code: outcome === 'failed' ? errorCode(error) : null,
        counts: { identity_events: 1 }
      }
    }).catch(error => console.warn('[YARBI TRACE IDENTITY]', errorCode(error)));
    waitUntil(task);
  };
  const traceCommercial = ({ stage, outcome = 'completed', messageId, contactId, error = null }) => {
    if (!traceSecretValue || !traceOperationId) return;
    const task = recordTrace({
      supabaseUrl: SUPABASE_URL,
      supabaseKey: SUPABASE_KEY,
      traceSecret: traceSecretValue,
      event: {
        operation_id: traceOperationId,
        event_id: eventIdFor(traceOperationId, stage, `${stage}:${messageId || contactId || 'unknown'}`, traceSecretValue),
        operation_type: 'message_processing',
        stage,
        outcome,
        started_at: traceStartedAt,
        ended_at: new Date().toISOString(),
        component: 'ai_process',
        component_version: traceVersion(),
        message_refs: [hashReference('message', messageId, traceSecretValue)].filter(Boolean),
        contact_refs: [hashReference('contact', contactId, traceSecretValue)].filter(Boolean),
        error_code: outcome === 'failed' ? errorCode(error) : null,
        counts: { commercial_context_events: 1 }
      }
    }).catch(error => console.warn('[YARBI TRACE COMMERCIAL]', errorCode(error)));
    waitUntil(task);
  };
  const traceOperationalMemory = ({ stage, outcome = 'completed', messageId, contactId, error = null }) => {
    if (!traceSecretValue || !traceOperationId) return;
    const task = recordTrace({
      supabaseUrl: SUPABASE_URL,
      supabaseKey: SUPABASE_KEY,
      traceSecret: traceSecretValue,
      event: {
        operation_id: traceOperationId,
        event_id: eventIdFor(traceOperationId, stage, `${stage}:${messageId || contactId || 'unknown'}`, traceSecretValue),
        operation_type: 'message_processing',
        stage,
        outcome,
        started_at: traceStartedAt,
        ended_at: new Date().toISOString(),
        component: 'ai_process',
        component_version: traceVersion(),
        message_refs: [hashReference('message', messageId, traceSecretValue)].filter(Boolean),
        contact_refs: [hashReference('contact', contactId, traceSecretValue)].filter(Boolean),
        error_code: outcome === 'failed' ? errorCode(error) : null,
        counts: { operational_memory_events: 1 }
      }
    }).catch(error => console.warn('[YARBI TRACE OPERATIONAL MEMORY]', errorCode(error)));
    waitUntil(task);
  };
  if (localProcessorLock) return res.status(202).json({ status: 'already_running', reason: 'local_lock' });
  localProcessorLock = true;
  let claimedJobs = [];
  let run = null;
  let lockToken = '';
  const traceContactRefs = [];
  const traceMemoryRefs = [];
  try {
    lockToken = [
      Date.now().toString(36),
      Math.random().toString(36).slice(2),
      requestedBy.replace(/[^a-zA-Z0-9_-]/g, '')
    ].join('-');
    claimedJobs = await claimQueuedAnalysis(requestedLimit, lockToken, priorityMessageId);
    if (!claimedJobs.length) {
      return res.status(200).json({
        status: 'completed',
        messages_scanned: 0,
        messages_processed: 0,
        message: 'No hay mensajes pendientes para procesar'
      });
    }

    const messageIds = claimedJobs.map(job => job.message_id).filter(Boolean);
    const traceMessageRefs = traceSecretValue ? messageIds.map(messageId => hashReference('message', messageId, traceSecretValue)).filter(Boolean) : [];
    const messagesResult = await supabase('/rest/v1/whatsapp_messages?id=' + encodeURIComponent(inFilter(messageIds)) + '&deleted_at=is.null&select=id,phone,title,text,maps_url,timestamp,created_at,app_name,metadata&order=timestamp.asc');
    if (!messagesResult.response.ok) throw new Error('No se pudieron leer mensajes nuevos');
    const scannedMessages = Array.isArray(messagesResult.data) ? messagesResult.data : [];
    const cursorBefore = scannedMessages.length ? Math.min(...scannedMessages.map(item => Number(item.timestamp) || Date.now())) : 0;
    const cursorAfter = scannedMessages.length ? Math.max(...scannedMessages.map(item => Number(item.timestamp) || 0)) : cursorBefore;
    const runResult = await supabase('/rest/v1/ai_processing_runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify([{
        status: 'running',
        cursor_before: cursorBefore,
        messages_scanned: claimedJobs.length,
        started_at: new Date().toISOString(),
        requested_by: requestedBy
      }])
    });
    if (!runResult.response.ok || !runResult.data?.[0]?.id) throw new Error('No se pudo iniciar el procesamiento');
    run = runResult.data[0];

    // La fuente de verdad es whatsapp_messages. Nunca se consulta ni se exige
    // un registro legacy: si el mensaje canónico conserva texto, sigue siendo
    // procesable aunque una copia histórica no exista.
    const partition = canonicalMessagePartition(claimedJobs, scannedMessages);
    const jobByMessageId = new Map(partition.found.map(entry => [String(entry.message.id), entry.job]));
    if (partition.unresolved.length) {
      await markJobsFailed(partition.unresolved, run.id, new Error('canonical_message_unavailable'), lockToken);
    }
    if (partition.duplicateJobs.length) {
      await markJobsFailed(partition.duplicateJobs, run.id, new Error('duplicate_queue_reference'), lockToken);
    }

    const groups = new Map();
    const invalidPhoneJobs = [];
    for (const message of scannedMessages) {
      const phone = canonicalPhone(message.phone);
      const job = jobByMessageId.get(String(message.id));
      if (!job) continue;
      if (!phone) {
        invalidPhoneJobs.push(job);
        continue;
      }
      if (!groups.has(phone)) groups.set(phone, []);
      groups.get(phone).push({ message, job });
    }
    if (invalidPhoneJobs.length) {
      const identityPending = identityPendingTransition();
      for (const job of invalidPhoneJobs) {
        const pending = await supabase('/rest/v1/ai_message_analysis?id=eq.' + encodeURIComponent(String(job.analysis_id))
          + '&status=eq.processing&lock_token=eq.' + encodeURIComponent(lockToken), {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify({ status: identityPending.status, processing_run_id: run.id, requires_review: identityPending.requires_review, error_message: identityPending.error_code, next_retry_at: null, completed_at: null, locked_at: null, lock_token: null })
        });
        if (!pending.response.ok) throw new Error('No se pudo conservar el mensaje con identidad pendiente');
        traceIdentity({ stage: 'identity_pending', messageId: job.message_id, analysisId: job.analysis_id });
      }
    }

    // Los mensajes sin identidad pueden cerrarse como revisión pendiente sin
    // invocar Gemini. Para cualquier conversación identificada, Gemini sigue
    // siendo obligatorio y el fallo conserva la cola recuperable.
    if (!GEMINI_KEY && groups.size && !identityOnlyPreview) throw new Error('gemini_configuration_missing');

    let processed = 0;
    let contactsAffected = 0;
    let agendaEventsCreated = 0;
    let intelligentAlertsCreated = 0;
    let observationsStored = 0;
    let observationsSchemaReady = true;
    let habitEvidenceRecorded = 0;
    let habitSchemaReady = true;
    let replyStyleEvidenceRecorded = 0;
    let replyStyleSchemaReady = true;
    let interestStatusesUpdated = 0;
    let operationalStatusesUpdated = 0;
    let declaredNamesPromoted = 0;
    let declaredNameErrors = 0;
    let identitiesCreated = 0;
    let identitiesResolved = 0;
    let commercialContextsUpdated = 0;
    let commercialServicesRecorded = 0;
    let commercialStatusesChanged = 0;
    let operationalMemoriesUpdated = 0;
    const errors = [];
    for (const [phone, entries] of groups) {
      const groupJobs = entries.map(entry => entry.job);
      const groupMessages = entries.map(entry => entry.message);
      try {
        let identity;
        try {
          identity = await resolveOrCreateContactByPhone({
            supabase,
            phone,
            messageId: groupMessages[0]?.id,
            analysisId: groupJobs[0]?.analysis_id
          });
        } catch (error) {
          traceIdentity({ stage: 'identity_error', outcome: 'failed', messageId: groupMessages[0]?.id, analysisId: groupJobs[0]?.analysis_id, error });
          throw error;
        }
        if (identity.outcome === 'identity_pending') {
          const error = new Error('identity_phone_invalid');
          error.code = 'identity_phone_invalid';
          traceIdentity({ stage: 'identity_error', outcome: 'failed', messageId: groupMessages[0]?.id, analysisId: groupJobs[0]?.analysis_id, error });
          throw error;
        }
        const contactId = identity.contact_id;
        if (identity.outcome === 'created_new') identitiesCreated += 1;
        else identitiesResolved += 1;
        traceIdentity({
          stage: identity.outcome === 'created_new' ? 'identity_created' : 'identity_found',
          messageId: groupMessages[0]?.id,
          analysisId: groupJobs[0]?.analysis_id,
          contactId
        });
        traceIdentity({ stage: 'identity_linked', messageId: groupMessages[0]?.id, analysisId: groupJobs[0]?.analysis_id, contactId });
        if (traceSecretValue) traceContactRefs.push(hashReference('contact', contactId, traceSecretValue));
        const linkedMessages = await supabase('/rest/v1/whatsapp_messages?id=' + encodeURIComponent(inFilter(groupMessages.map(message => message.id))), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contact_id: contactId })
        });
        if (!linkedMessages.response.ok) throw new Error('No se pudo vincular whatsapp_messages con CRM');
        // El mensaje recién vinculado puede cambiar el contexto recuperable del
        // contacto. Se eliminan únicamente los resultados de caché que lo
        // contenían; nunca se amplía un scope ni se toca almacenamiento remoto.
        invalidateOwnerReferenceCandidates({ contactId });
        invalidateCrmSearchCache({ contactId });

        if (commercialContextPreview) {
          for (const entry of entries) {
            const evidenceInspection = inspectCommercialEvidence(entry.message);
            if (evidenceInspection.state === 'accepted') {
              traceCommercial({ stage: 'commercial_evidence_accepted', messageId: entry.message?.id, contactId });
            } else if (evidenceInspection.state === 'rejected') {
              traceCommercial({ stage: 'commercial_evidence_rejected', outcome: 'failed', messageId: entry.message?.id, contactId, error: Object.assign(new Error(evidenceInspection.code), { code: evidenceInspection.code }) });
            }
            let context;
            try {
              context = await updateCommercialContext({ supabase, contactId, message: entry.message });
            } catch (error) {
              traceCommercial({ stage: 'commercial_context_error', outcome: 'failed', messageId: entry.message?.id, contactId, error });
              throw error;
            }
            const stageByOutcome = {
              unchanged: 'commercial_context_unchanged',
              service_recorded: 'service_recorded',
              status_changed: 'commercial_status_changed',
              context_updated: 'commercial_context_updated'
            };
            traceCommercial({ stage: stageByOutcome[context.outcome] || 'commercial_context_unchanged', messageId: entry.message?.id, contactId });
            if (context.outcome !== 'unchanged') commercialContextsUpdated += 1;
            if (context.outcome === 'service_recorded') commercialServicesRecorded += 1;
            if (context.outcome === 'status_changed') commercialStatusesChanged += 1;
          }
        }

        if (operationalMemoryPreview) {
          for (const entry of entries) {
            const facts = deriveOperationalFactsFromCommercialEvidence(entry.message);
            for (const fact of facts) {
              try {
                const memory = await upsertOperationalMemory({ supabase, contactId, fact });
                traceOperationalMemory({ stage: `operational_memory_${memory.outcome}`, messageId: entry.message?.id, contactId });
                if (!['duplicate_event', 'stale_recorded'].includes(memory.outcome)) operationalMemoriesUpdated += 1;
              } catch (error) {
                traceOperationalMemory({ stage: 'operational_memory_error', outcome: 'failed', messageId: entry.message?.id, contactId, error });
                throw error;
              }
            }
          }
        }

        if (identityOnlyPreview) {
          const finalizedAt = new Date().toISOString();
          for (const job of groupJobs) {
            const finalized = await supabase('/rest/v1/ai_message_analysis?id=eq.' + encodeURIComponent(String(job.analysis_id))
              + '&status=eq.processing&lock_token=eq.' + encodeURIComponent(lockToken), {
              method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
              body: JSON.stringify({
                status: 'identity_resolved', contact_id: contactId, processing_run_id: run.id,
                requires_review: true, error_message: 'identity_resolved_no_semantic_analysis',
                completed_at: finalizedAt, next_retry_at: null, locked_at: null, lock_token: null
              })
            });
            if (!finalized.response.ok) throw new Error('No se pudo finalizar la identidad CRM');
          }
          processed += groupMessages.length;
          contactsAffected += 1;
          continue;
        }

        const currentMemory = await getMemory(contactId);
        const analysis = await analyzeConversation(phone, groupMessages, currentMemory);
        const hasHistoricalMessages = groupMessages.some(message => Boolean(message.metadata?.historical));
        const hasOnlyOutgoingMessages = groupMessages.every(message => message.metadata?.direction === 'outgoing');
        // El historial y los mensajes enviados sirven como contexto, pero nunca deben
        // crear por sí mismos una agenda, alerta comercial o acción automática.
        if (hasOnlyOutgoingMessages || hasHistoricalMessages) {
          analysis.appointment = null;
          analysis.has_actionable_request = false;
          analysis.follow_up_status = '';
          analysis.commercial_status = null;
          analysis.status_reason = '';
          analysis.commercial_status_source_message_ids = [];
          analysis.operational_status = '';
          analysis.operational_reason = '';
          analysis.operational_status_source_message_ids = [];
          analysis.suggested_reply = '';
        }
        const availabilitySignal = hasHistoricalMessages ? null : detectAgendaAvailabilityConflict(groupMessages);
        const agendaAvailabilityConflict = availabilitySignal
          ? await findUpcomingAgendaForAvailabilityConflict(contactId, availabilitySignal)
          : null;
        if (agendaAvailabilityConflict) applyAgendaAvailabilityConflict(analysis, availabilitySignal, agendaAvailabilityConflict);
        const agendaClientSignal = hasHistoricalMessages || availabilitySignal ? null : detectAgendaClientSignal(groupMessages);
        const agendaClientUpdateEvent = agendaClientSignal
          ? await findUpcomingAgendaForAvailabilityConflict(contactId, agendaClientSignal)
          : null;
        if (agendaClientUpdateEvent) applyAgendaClientUpdate(analysis, agendaClientSignal, agendaClientUpdateEvent);
        const namePromotion = await promoteDeclaredContactName(contactId, phone, analysis).catch(error => {
          declaredNameErrors += 1;
          console.warn('[YARBI IDENTITY] La memoria principal continúa aunque falle la promoción del nombre:', error.message);
          return { updated: false, reason: 'storage_error' };
        });
        if (namePromotion.updated) declaredNamesPromoted += 1;
        const memory = await saveMemory(contactId, currentMemory, analysis, run.id);
        if (traceSecretValue) traceMemoryRefs.push(hashReference('memory', memory?.id || `${contactId}:${memory?.version || 0}`, traceSecretValue));
        const savedRows = [];
        for (const entry of entries) {
          savedRows.push(await completeAnalysisJob(entry.job, entry.message, contactId, run.id, analysis, lockToken));
        }
        const agendaEvent = hasHistoricalMessages
          ? { id: null, created: false }
          : await createAgendaEvent(contactId, analysis);
        const analysisId = savedRows[0]?.id || null;
        const observationResult = await saveContactObservations(contactId, analysisId, run.id, analysis, groupMessages).catch(error => {
          console.warn('[YARBI OBSERVATIONS] La memoria principal continúa aunque falle el almacenamiento estructurado:', error.message);
          return { stored: 0, schema_missing: false, storage_error: true };
        });
        observationsStored += observationResult.stored;
        if (observationResult.schema_missing) observationsSchemaReady = false;
        const habitResult = await saveHabitCandidates(analysis).catch(error => {
          console.warn('[YARBI HABITS] La memoria principal continúa aunque falle el aprendizaje de hábitos:', error.message);
          return { recorded: 0, schema_missing: false, storage_error: true };
        });
        habitEvidenceRecorded += habitResult.recorded;
        if (habitResult.schema_missing) habitSchemaReady = false;
        const replyStyleResult = await saveReplyStylePatterns(analysis).catch(error => {
          console.warn('[YARBI REPLY STYLE] La memoria principal continúa aunque falle el perfil de estilo:', error.message);
          return { recorded: 0, schema_missing: false, storage_error: true };
        });
        replyStyleEvidenceRecorded += replyStyleResult.recorded;
        if (replyStyleResult.schema_missing) replyStyleSchemaReady = false;
        const alert = hasHistoricalMessages || agendaAvailabilityConflict || agendaClientUpdateEvent
          ? { id: null, created: false }
          : await createIntelligentAlert(contactId, analysis, analysisId, agendaEvent);
        const availabilityAlert = agendaAvailabilityConflict
          ? await createAgendaAvailabilityAlert(contactId, analysisId, availabilitySignal, agendaAvailabilityConflict)
          : { id: null, created: false };
        const agendaClientUpdateAlert = agendaClientUpdateEvent
          ? await createAgendaClientUpdateAlert(contactId, analysisId, agendaClientSignal, agendaClientUpdateEvent)
          : { id: null, created: false };
        if (agendaEvent?.created) agendaEventsCreated += 1;
        if (alert?.created) intelligentAlertsCreated += 1;
        if (availabilityAlert?.created) intelligentAlertsCreated += 1;
        if (agendaClientUpdateAlert?.created) intelligentAlertsCreated += 1;
        const statusResult = await updateContactStatuses(contactId, analysis, groupMessages);
        if (statusResult.interest_updated) interestStatusesUpdated += 1;
        if (statusResult.operational_updated) operationalStatusesUpdated += 1;
        processed += groupMessages.length;
        contactsAffected += 1;
      } catch (error) {
        errors.push({ phone, detail: error.message });
        await markJobsFailed(groupJobs, run.id, error, lockToken);
      }
    }

    const finalStatus = errors.length ? 'failed' : 'completed';
    await supabase('/rest/v1/ai_processing_runs?id=eq.' + encodeURIComponent(String(run.id)), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: finalStatus, cursor_after: cursorAfter, messages_processed: processed, contacts_affected: contactsAffected, error_message: errors.length ? JSON.stringify(errors).slice(0, 2000) : null, completed_at: new Date().toISOString() })
    });
    traceProcessing({
      stage: errors.length ? 'processing_completed_with_errors' : 'memory_updated',
      outcome: errors.length ? 'failed' : 'completed',
      event_key: `run:${run.id}:final`,
      started_at: traceStartedAt,
      ended_at: new Date().toISOString(),
      message_refs: traceMessageRefs,
      contact_refs: traceContactRefs.filter(Boolean),
      run_refs: traceSecretValue ? [hashReference('run', run.id, traceSecretValue)] : [],
      analysis_refs: traceMemoryRefs.filter(Boolean),
      error_code: errors.length ? 'processing_group_failed' : null,
      counts: { messages_scanned: claimedJobs.length, messages_processed: processed, contacts_affected: contactsAffected, identities_created: identitiesCreated, identities_resolved: identitiesResolved, commercial_context_updated: commercialContextsUpdated, service_recorded: commercialServicesRecorded, commercial_status_changed: commercialStatusesChanged, operational_memory_updated: operationalMemoriesUpdated, errors: errors.length }
    });
    if (claimedJobs.length >= requestedLimit && continuationDepth < 2) {
      scheduleNextBatch(requestedLimit, 0, continuationDepth + 1);
    }
    if (
      continuationDepth < 2
      && errors.some(item => !/Gemini HTTP 429|quota/i.test(String(item.detail || '')))
    ) {
      scheduleNextBatch(requestedLimit, 16000, continuationDepth + 1);
    }
    return res.status(errors.length ? 207 : 200).json({
      status: finalStatus,
      run_id: run.id,
      cursor_before: cursorBefore,
      cursor_after: cursorAfter,
      messages_scanned: claimedJobs.length,
      messages_processed: processed,
      contacts_affected: contactsAffected,
      agenda_events_created: agendaEventsCreated,
      intelligent_alerts_created: intelligentAlertsCreated,
      observations_stored: observationsStored,
      observations_schema_ready: observationsSchemaReady,
      habit_evidence_recorded: habitEvidenceRecorded,
      habit_schema_ready: habitSchemaReady,
      reply_style_evidence_recorded: replyStyleEvidenceRecorded,
      reply_style_schema_ready: replyStyleSchemaReady,
      interest_statuses_updated: interestStatusesUpdated,
      operational_statuses_updated: operationalStatusesUpdated,
      declared_names_promoted: declaredNamesPromoted,
      declared_name_errors: declaredNameErrors,
      identities_created: identitiesCreated,
      identities_resolved: identitiesResolved,
      commercial_context_updated: commercialContextsUpdated,
      service_recorded: commercialServicesRecorded,
      commercial_status_changed: commercialStatusesChanged,
      operational_memory_updated: operationalMemoriesUpdated,
      errors,
      message: processed ? 'Procesamiento incremental finalizado' : 'No hubo mensajes procesables'
    });
  } catch (error) {
    console.error('[AI PROCESS ERROR]', errorCode(error));
    try {
      const unfinishedJobs = claimedJobs.filter(Boolean);
      if (unfinishedJobs.length) await markJobsFailed(unfinishedJobs, run?.id || null, error, lockToken);
      if (run?.id) {
        await supabase('/rest/v1/ai_processing_runs?id=eq.' + encodeURIComponent(String(run.id)), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'failed',
            error_message: clampText(error.message || error, 2000),
            completed_at: new Date().toISOString()
          })
        });
      }
    } catch (recoveryError) {
    console.error('[AI PROCESS RECOVERY ERROR]', errorCode(recoveryError));
    }
    traceProcessing({
      stage: 'processing_failed',
      outcome: 'failed',
      event_key: `run:${run?.id || 'unstarted'}:failed`,
      started_at: traceStartedAt,
      ended_at: new Date().toISOString(),
      message_refs: traceSecretValue ? claimedJobs.map(job => hashReference('message', job?.message_id, traceSecretValue)).filter(Boolean) : [],
      contact_refs: traceContactRefs.filter(Boolean),
      run_refs: traceSecretValue && run?.id ? [hashReference('run', run.id, traceSecretValue)] : [],
      analysis_refs: traceMemoryRefs.filter(Boolean),
      error_code: errorCode(error),
      counts: { messages_claimed: claimedJobs.length }
    });
    return res.status(500).json({ error: error.message || 'Error al procesar información' });
  } finally {
    localProcessorLock = false;
  }
}
