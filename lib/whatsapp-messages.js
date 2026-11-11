const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim();
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || '';
const ASSISTANT_TOKEN = process.env.ASSISTANT_API_TOKEN || process.env.TOKEN_API_DE_ASISTENTE || '';
const { buildClientDossier } = require('./yarbi-client-dossier');

function hasAssistantAccess(req) {
  const headers = req?.headers || {};
  const raw = headers['x-assistant-token'] || headers.authorization || '';
  const token = String(raw).replace(/^Bearer\s+/i, '').trim();
  return Boolean(ASSISTANT_TOKEN && token === ASSISTANT_TOKEN);
}

function firstQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function parseLimit(value) {
  const parsed = Number.parseInt(firstQueryValue(value), 10);
  if (!Number.isFinite(parsed)) return 50;
  return Math.min(Math.max(parsed, 1), 5000);
}

function cleanPhone(value) {
  return String(firstQueryValue(value) || '').replace(/\D/g, '').slice(0, 20);
}

function cleanSearchText(value) {
  return String(firstQueryValue(value) || '').replace(/[(),*%_]/g, ' ').trim().replace(/\s+/g, ' ').slice(0, 120);
}

const CLIENT_MEMORY_CACHE_TTL_MS = 90 * 1000;
const CLIENT_MEMORY_CACHE_MAX = 80;
const clientMemoryCache = new Map();

function memoryCacheRead(key) {
  const entry = clientMemoryCache.get(key);
  if (!entry || Date.now() - entry.at > CLIENT_MEMORY_CACHE_TTL_MS) {
    clientMemoryCache.delete(key);
    return null;
  }
  return { ...entry.payload, source: 'supabase-memory-cache', cache_age_ms: Date.now() - entry.at };
}

function memoryCacheWrite(key, payload) {
  if (!key || !payload || (!payload.contact && !payload.memory)) return;
  clientMemoryCache.set(key, { at: Date.now(), payload });
  while (clientMemoryCache.size > CLIENT_MEMORY_CACHE_MAX) clientMemoryCache.delete(clientMemoryCache.keys().next().value);
}

function invalidateMemoryCache() {
  clientMemoryCache.clear();
}
function parseTimestamp(value) {
  const raw = String(firstQueryValue(value) || '').trim();
  if (!/^\d{1,16}$/.test(raw)) return null;
  const timestamp = Number(raw);
  return Number.isSafeInteger(timestamp) ? timestamp : null;
}

async function memoryForPhone(phone) {
  const identifierResponse = await fetch(`${SUPABASE_URL}/rest/v1/contact_identifiers?identifier_type=eq.phone&normalized_value=eq.${encodeURIComponent(phone)}&select=contact_id,identifier_value&limit=1`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
  });
  const identifiers = await identifierResponse.json().catch(() => []);
  if (!identifierResponse.ok) throw new Error('No se pudo consultar el contacto');
  const contactId = identifiers?.[0]?.contact_id || null;
  if (!contactId) return { phone, contact: null, memory: null, alerts: [], agenda: [], observations: [] };
  const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
  const [contactResponse, memoryResponse, alertsResponse, agendaResponse, observationsResponse, replyStyleResponse, analysesResponse, messagesResponse] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/crm_contacts?id=eq.${encodeURIComponent(String(contactId))}&select=*&limit=1`, { headers }),
    fetch(`${SUPABASE_URL}/rest/v1/ai_conversation_memory?contact_id=eq.${encodeURIComponent(String(contactId))}&select=*&limit=1`, { headers }),
    fetch(`${SUPABASE_URL}/rest/v1/ai_intelligent_alerts?contact_id=eq.${encodeURIComponent(String(contactId))}&select=*&order=created_at.desc&limit=10`, { headers }),
    fetch(`${SUPABASE_URL}/rest/v1/agenda_events?contact_id=eq.${encodeURIComponent(String(contactId))}&select=*&order=starts_at.asc&limit=20`, { headers }),
    fetch(`${SUPABASE_URL}/rest/v1/ai_contact_observations?contact_id=eq.${encodeURIComponent(String(contactId))}&status=eq.active&select=id,observation_type,category,value,source_message_ids,confidence,observed_at,updated_at&order=observed_at.desc&limit=80`, { headers }),
    fetch(`${SUPABASE_URL}/rest/v1/yarbi_reply_style_patterns?owner_key=eq.default&status=eq.active&select=id,pattern_key,category,guidance,confidence,evidence_count,updated_at&order=evidence_count.desc,updated_at.desc&limit=24`, { headers }),
    fetch(`${SUPABASE_URL}/rest/v1/ai_message_analysis?contact_id=eq.${encodeURIComponent(String(contactId))}&status=eq.completed&select=id,message_id,status,service,extracted_data,completed_at,updated_at&order=completed_at.desc&limit=20`, { headers }),
    fetch(`${SUPABASE_URL}/rest/v1/whatsapp_messages?contact_id=eq.${encodeURIComponent(String(contactId))}&deleted_at=is.null&select=id,text,maps_url,timestamp,metadata&order=timestamp.desc&limit=80`, { headers })
  ]);
  const [contact, memory, alerts, agenda, observations, replyStyle, analyses, messages] = await Promise.all([
    contactResponse.json().catch(() => []),
    memoryResponse.json().catch(() => []),
    alertsResponse.json().catch(() => []),
    agendaResponse.json().catch(() => []),
    observationsResponse.json().catch(() => []),
    replyStyleResponse.json().catch(() => []),
    analysesResponse.json().catch(() => []),
    messagesResponse.json().catch(() => [])
  ]);
  const payload = { phone, contact: contact?.[0] || null, memory: memory?.[0] || null, alerts: Array.isArray(alerts) ? alerts : [], agenda: Array.isArray(agenda) ? agenda : [], observations: Array.isArray(observations) ? observations : [], analyses: analysesResponse.ok && Array.isArray(analyses) ? analyses : [], messages: messagesResponse.ok && Array.isArray(messages) ? messages : [], reply_style_profile: replyStyleResponse.ok && Array.isArray(replyStyle) ? replyStyle : [] };
  return { ...payload, dossier: buildClientDossier(payload) };
}

async function memoryForContactName(clientName) {
  const params = new URLSearchParams();
  params.set('select', 'id,full_name,display_name,commercial_status,status_reason,commercial_status_event_at,commercial_status_source_message_ids,operational_status,operational_reason,operational_event_at,operational_status_source_message_ids,notes,source,created_at,updated_at');
  params.set('or', `(display_name.ilike.*${clientName}*,full_name.ilike.*${clientName}*)`);
  params.set('order', 'updated_at.desc');
  params.set('limit', '5');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/crm_contacts?${params.toString()}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
  });
  const contacts = await response.json().catch(() => []);
  if (!response.ok) throw new Error('No se pudo buscar el cliente');
  if (!Array.isArray(contacts) || contacts.length === 0) return { client_name: clientName, contact: null, memory: null, alerts: [], agenda: [], observations: [] };
  if (contacts.length > 1) {
    const contactIds = contacts.map((contact) => Number(contact.id)).filter(Number.isFinite);
    const identifiersResponse = await fetch(`${SUPABASE_URL}/rest/v1/contact_identifiers?contact_id=in.(${contactIds.join(',')})&identifier_type=eq.phone&select=contact_id,normalized_value,identifier_value,is_primary`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
    const identifiers = identifiersResponse.ok ? await identifiersResponse.json().catch(() => []) : [];
    const phoneByContact = new Map();
    (Array.isArray(identifiers) ? identifiers : []).sort((a, b) => Number(b.is_primary) - Number(a.is_primary)).forEach((identifier) => {
      const contactId = Number(identifier.contact_id);
      if (!phoneByContact.has(contactId)) phoneByContact.set(contactId, String(identifier.normalized_value || identifier.identifier_value || '').replace(/\D/g, ''));
    });
    return {
      client_name: clientName,
      requires_disambiguation: true,
      candidates: contacts.map((contact) => ({ id: contact.id, name: contact.display_name || contact.full_name || 'Cliente', phone_last3: String(phoneByContact.get(Number(contact.id)) || '').slice(-3), commercial_status: contact.commercial_status }))
    };
  }
  const contact = contacts[0];
  const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
  const [identifierResponse, memoryResponse, alertsResponse, agendaResponse, observationsResponse, replyStyleResponse, analysesResponse, messagesResponse] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/contact_identifiers?contact_id=eq.${encodeURIComponent(String(contact.id))}&identifier_type=eq.phone&select=identifier_value,normalized_value,is_primary&order=is_primary.desc&limit=5`, { headers }),
    fetch(`${SUPABASE_URL}/rest/v1/ai_conversation_memory?contact_id=eq.${encodeURIComponent(String(contact.id))}&select=*&limit=1`, { headers }),
    fetch(`${SUPABASE_URL}/rest/v1/ai_intelligent_alerts?contact_id=eq.${encodeURIComponent(String(contact.id))}&select=*&order=created_at.desc&limit=10`, { headers }),
    fetch(`${SUPABASE_URL}/rest/v1/agenda_events?contact_id=eq.${encodeURIComponent(String(contact.id))}&select=*&order=starts_at.asc&limit=20`, { headers }),
    fetch(`${SUPABASE_URL}/rest/v1/ai_contact_observations?contact_id=eq.${encodeURIComponent(String(contact.id))}&status=eq.active&select=id,observation_type,category,value,source_message_ids,confidence,observed_at,updated_at&order=observed_at.desc&limit=80`, { headers }),
    fetch(`${SUPABASE_URL}/rest/v1/yarbi_reply_style_patterns?owner_key=eq.default&status=eq.active&select=id,pattern_key,category,guidance,confidence,evidence_count,updated_at&order=evidence_count.desc,updated_at.desc&limit=24`, { headers }),
    fetch(`${SUPABASE_URL}/rest/v1/ai_message_analysis?contact_id=eq.${encodeURIComponent(String(contact.id))}&status=eq.completed&select=id,message_id,status,service,extracted_data,completed_at,updated_at&order=completed_at.desc&limit=20`, { headers }),
    fetch(`${SUPABASE_URL}/rest/v1/whatsapp_messages?contact_id=eq.${encodeURIComponent(String(contact.id))}&deleted_at=is.null&select=id,text,maps_url,timestamp,metadata&order=timestamp.desc&limit=80`, { headers })
  ]);
  const [identifiers, memory, alerts, agenda, observations, replyStyle, analyses, messages] = await Promise.all([
    identifierResponse.json().catch(() => []),
    memoryResponse.json().catch(() => []),
    alertsResponse.json().catch(() => []),
    agendaResponse.json().catch(() => []),
    observationsResponse.json().catch(() => []),
    replyStyleResponse.json().catch(() => []),
    analysesResponse.json().catch(() => []),
    messagesResponse.json().catch(() => [])
  ]);
  const phone = identifiers?.[0]?.normalized_value || identifiers?.[0]?.identifier_value || '';
  const payload = { phone, contact, memory: memory?.[0] || null, alerts: Array.isArray(alerts) ? alerts : [], agenda: Array.isArray(agenda) ? agenda : [], observations: Array.isArray(observations) ? observations : [], analyses: analysesResponse.ok && Array.isArray(analyses) ? analyses : [], messages: messagesResponse.ok && Array.isArray(messages) ? messages : [], reply_style_profile: replyStyleResponse.ok && Array.isArray(replyStyle) ? replyStyle : [] };
  return { ...payload, dossier: buildClientDossier(payload) };
}

async function memoryOverview(limit, commercialStatus) {
  const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
  const memoryParams = new URLSearchParams();
  memoryParams.set('select', 'contact_id,summary,last_interaction_at,last_ai_interaction_at,customer_summary_version,latest_intent,latest_service,follow_up_status,next_steps,updated_at');
  memoryParams.set('order', 'last_interaction_at.desc.nullslast');
  memoryParams.set('limit', String(limit));
  const memoryResponse = await fetch(`${SUPABASE_URL}/rest/v1/ai_conversation_memory?${memoryParams.toString()}`, { headers });
  const memories = await memoryResponse.json().catch(() => []);
  if (!memoryResponse.ok) throw new Error('No se pudo consultar el resumen CRM');
  const contactIds = [...new Set((Array.isArray(memories) ? memories : []).map((item) => Number(item.contact_id)).filter(Number.isFinite))];
  if (!contactIds.length) return { contacts: [], count: 0 };
  const inFilter = `in.(${contactIds.join(',')})`;
  const [contactsResponse, identifiersResponse, alertsResponse] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/crm_contacts?id=${encodeURIComponent(inFilter)}&select=id,full_name,display_name,commercial_status,status_reason,commercial_status_event_at,operational_status,operational_reason,operational_event_at,updated_at`, { headers }),
    fetch(`${SUPABASE_URL}/rest/v1/contact_identifiers?contact_id=${encodeURIComponent(inFilter)}&identifier_type=eq.phone&select=contact_id,identifier_value,normalized_value,is_primary`, { headers }),
    fetch(`${SUPABASE_URL}/rest/v1/ai_intelligent_alerts?contact_id=${encodeURIComponent(inFilter)}&status=in.(open,read)&select=id,contact_id,alert_type,title,reason,severity,status,created_at&order=created_at.desc&limit=100`, { headers })
  ]);
  const [contacts, identifiers, alerts] = await Promise.all([
    contactsResponse.json().catch(() => []),
    identifiersResponse.json().catch(() => []),
    alertsResponse.json().catch(() => [])
  ]);
  const contactById = new Map((Array.isArray(contacts) ? contacts : []).map((item) => [Number(item.id), item]));
  const phoneByContact = new Map();
  (Array.isArray(identifiers) ? identifiers : []).sort((a, b) => Number(b.is_primary) - Number(a.is_primary)).forEach((item) => {
    if (!phoneByContact.has(Number(item.contact_id))) phoneByContact.set(Number(item.contact_id), item.normalized_value || item.identifier_value || '');
  });
  const alertsByContact = new Map();
  (Array.isArray(alerts) ? alerts : []).forEach((alert) => {
    const key = Number(alert.contact_id);
    if (!alertsByContact.has(key)) alertsByContact.set(key, []);
    alertsByContact.get(key).push(alert);
  });
  const rows = (Array.isArray(memories) ? memories : []).map((memory) => {
    const contact = contactById.get(Number(memory.contact_id)) || {};
    return {
      contact_id: memory.contact_id,
      name: contact.display_name || contact.full_name || 'Cliente',
      phone: phoneByContact.get(Number(memory.contact_id)) || '',
      commercial_status: contact.commercial_status || 'frio',
      status_reason: contact.status_reason || '',
      operational_status: contact.operational_status || 'sin_accion',
      operational_reason: contact.operational_reason || '',
      operational_event_at: contact.operational_event_at || null,
      memory,
      alerts: (alertsByContact.get(Number(memory.contact_id)) || []).slice(0, 5)
    };
  }).filter((item) => !commercialStatus || commercialStatus === 'all' || item.commercial_status === commercialStatus);
  return { contacts: rows, count: rows.length };
}
async function readOwnerInstructions() {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/yarbi_owner_instructions?owner_key=eq.default&enabled=eq.true&select=id,instruction,category,scope,source,confirmed_at,updated_at&order=updated_at.desc&limit=100`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
  });
  const data = await response.json().catch(() => []);
  if (!response.ok) throw new Error('No se pudieron leer las instrucciones de Yarbi');
  return Array.isArray(data) ? data : [];
}

async function readOwnerReplyStyle() {
  return localMirrorReadOptional('/rest/v1/yarbi_reply_style_patterns?owner_key=eq.default&status=eq.active&select=id,pattern_key,category,guidance,confidence,evidence_count,first_seen_at,last_seen_at,updated_at&order=evidence_count.desc,updated_at.desc&limit=24', 'perfil de respuesta de Yarbi', 'yarbi_reply_style_patterns');
}

// Réplica local autenticada: entrega deltas compactos para el almacenamiento privado del APK.
function localMirrorIso(value) { const raw = String(value || '').trim(); return raw && Number.isFinite(new Date(raw).getTime()) ? new Date(raw).toISOString() : null; }
function localMirrorNumber(value) { const parsed = Number.parseInt(String(value || ''), 10); return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null; }
function localMirrorLimit(value, fallback, maximum) { const parsed = Number.parseInt(String(value || ''), 10); return Math.min(Math.max(Number.isFinite(parsed) ? parsed : fallback, 1), maximum); }
function localMirrorSince(field, cursor) { return cursor ? '&' + field + '=gte.' + encodeURIComponent(cursor) : ''; }
function localMirrorMaxIso(rows, field, fallback) { return (rows || []).reduce((latest, row) => { const value = localMirrorIso(row?.[field]); return value && (!latest || value > latest) ? value : latest; }, fallback || null); }
function localMirrorMaxNumber(rows, field, fallback) { return (rows || []).reduce((latest, row) => Math.max(latest || 0, Number(row?.[field]) || 0), Number(fallback) || 0) || null; }
async function localMirrorRead(path, label) {
  const response = await fetch(SUPABASE_URL + path, { headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(label + ' HTTP ' + response.status + ': ' + (typeof data === 'string' ? data : JSON.stringify(data || {})).slice(0, 240));
  return Array.isArray(data) ? data : [];
}
async function localMirrorReadOptional(path, label, tableName) {
  try { return await localMirrorRead(path, label); }
  catch (error) {
    if (new RegExp(tableName + '|PGRST205|42P01', 'i').test(String(error?.message || error))) return [];
    throw error;
  }
}
async function habitCandidatesHandler(req, res) {
  const headers = { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY };
  if (req.method === 'GET') {
    const rows = await localMirrorReadOptional('/rest/v1/yarbi_habit_candidates?owner_key=eq.default&status=in.%28ready%2Coffered%29&select=id,habit_key,category,instruction,confidence,evidence_message_ids,evidence_count,status,first_seen_at,last_seen_at,offered_at,updated_at&order=evidence_count.desc,updated_at.asc&limit=10', 'hábitos de Yarbi', 'yarbi_habit_candidates');
    return res.status(200).json({ status: 'ok', candidates: rows });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body || '{}'); } catch (_) { return {}; } })() : (req.body || {});
  if (body.confirm !== true) return res.status(400).json({ error: 'confirmation_required' });
  const id = Number.parseInt(String(body.id || ''), 10);
  const operation = String(body.operation || '');
  const statusByOperation = { mark_offered: 'offered', approve: 'approved', reject: 'rejected' };
  const nextStatus = statusByOperation[operation];
  if (!Number.isSafeInteger(id) || id <= 0 || !nextStatus) return res.status(400).json({ error: 'invalid_habit_operation' });
  const now = new Date().toISOString();
  const patch = { status: nextStatus, updated_at: now };
  if (operation === 'mark_offered') patch.offered_at = now;
  else patch.resolved_at = now;
  const response = await fetch(SUPABASE_URL + '/rest/v1/yarbi_habit_candidates?id=eq.' + encodeURIComponent(String(id)) + '&owner_key=eq.default&status=in.%28ready%2Coffered%29', {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(patch)
  });
  const data = await response.json().catch(() => []);
  if (!response.ok) return res.status(response.status).json({ error: 'No se pudo actualizar el hábito', detail: data });
  if (!Array.isArray(data) || !data.length) return res.status(409).json({ error: 'habit_already_resolved' });
  return res.status(200).json({ status: nextStatus, candidate: data[0] });
}
async function localMirrorSync(req, res) {
  // Defensa en profundidad: esta ruta expone únicamente deltas al APK autenticado.
  if (!hasAssistantAccess(req)) return res.status(401).json({ error: 'No autorizado' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body || '{}'); } catch (_) { return {}; } })() : (req.body || {});
  const entityCursor = localMirrorIso(body.entity_cursor), messageCursor = localMirrorNumber(body.message_cursor), deletionCursor = localMirrorIso(body.deletion_cursor), historyBefore = localMirrorNumber(body.history_before);
  const messageLimit = localMirrorLimit(body.message_limit, 200, 250), entityLimit = localMirrorLimit(body.entity_limit, 400, 500);
  const messageQuery = historyBefore
    ? '/rest/v1/whatsapp_messages?select=id,phone,title,text,maps_url,app_name,timestamp,created_at,deleted_at,metadata&deleted_at=is.null&timestamp=lt.' + historyBefore + '&order=timestamp.desc&limit=' + messageLimit
    : messageCursor
      ? '/rest/v1/whatsapp_messages?select=id,phone,title,text,maps_url,app_name,timestamp,created_at,deleted_at,metadata&deleted_at=is.null&timestamp=gte.' + Math.max(0, messageCursor - 1) + '&order=timestamp.asc&limit=' + messageLimit
      : '/rest/v1/whatsapp_messages?select=id,phone,title,text,maps_url,app_name,timestamp,created_at,deleted_at,metadata&deleted_at=is.null&order=timestamp.desc&limit=' + messageLimit;
  try {
    const [contacts, identifiers, memories, agenda, alerts, analyses, observations, receivables, habits, replyStyles, messages, deletedMessages] = await Promise.all([
      localMirrorRead('/rest/v1/crm_contacts?select=id,full_name,display_name,commercial_status,status_reason,commercial_status_event_at,commercial_status_source_message_ids,operational_status,operational_reason,operational_event_at,operational_status_source_message_ids,notes,source,created_at,updated_at&order=updated_at.asc&limit=' + entityLimit + localMirrorSince('updated_at', entityCursor), 'contactos'),
      localMirrorRead('/rest/v1/contact_identifiers?select=id,contact_id,identifier_type,identifier_value,normalized_value,is_primary,created_at,updated_at&order=updated_at.asc&limit=' + entityLimit + localMirrorSince('updated_at', entityCursor), 'identificadores'),
      localMirrorRead('/rest/v1/ai_conversation_memory?select=contact_id,summary,last_interaction_at,last_ai_interaction_at,customer_summary_version,latest_intent,latest_service,follow_up_status,next_steps,created_at,updated_at&order=updated_at.asc&limit=' + entityLimit + localMirrorSince('updated_at', entityCursor), 'memorias procesadas'),
      localMirrorRead('/rest/v1/agenda_events?select=id,contact_id,event_type,title,service,description,location,maps_url,latitude,longitude,starts_at,ends_at,timezone,status,source,dedupe_key,created_at,updated_at&order=updated_at.asc&limit=' + entityLimit + localMirrorSince('updated_at', entityCursor), 'agenda'),
      localMirrorRead('/rest/v1/ai_intelligent_alerts?select=id,contact_id,analysis_id,agenda_event_id,alert_type,title,reason,severity,status,created_at,updated_at&order=updated_at.asc&limit=' + entityLimit + localMirrorSince('updated_at', entityCursor), 'alertas'),
      localMirrorRead('/rest/v1/ai_message_analysis?select=id,message_id,contact_id,status,intent,service,extracted_data,confidence,requires_review,error_message,analyzed_at,completed_at,created_at,updated_at&order=updated_at.asc&limit=' + entityLimit + localMirrorSince('updated_at', entityCursor), 'análisis'),
      localMirrorReadOptional('/rest/v1/ai_contact_observations?select=id,contact_id,analysis_id,processing_run_id,observation_type,category,value,source_message_ids,confidence,status,observed_at,created_at,updated_at&order=updated_at.asc&limit=' + entityLimit + localMirrorSince('updated_at', entityCursor), 'observaciones estructuradas', 'ai_contact_observations'),
      // Cobranzas son la única fuente local para afirmar un saldo en el
      // expediente. Nunca se deriva una deuda del texto de un mensaje.
      localMirrorReadOptional('/rest/v1/yarbi_receivables?select=id,contact_id,agreed_amount,paid_amount,balance_amount,status,next_action,next_action_due,created_at,updated_at&order=updated_at.asc&limit=' + entityLimit + localMirrorSince('updated_at', entityCursor), 'cobranzas verificadas', 'yarbi_receivables'),
      localMirrorReadOptional('/rest/v1/yarbi_habit_candidates?owner_key=eq.default&select=id,habit_key,category,instruction,confidence,evidence_message_ids,evidence_count,status,first_seen_at,last_seen_at,offered_at,resolved_at,created_at,updated_at&order=updated_at.asc&limit=' + entityLimit + localMirrorSince('updated_at', entityCursor), 'hábitos observados', 'yarbi_habit_candidates'),
      localMirrorReadOptional('/rest/v1/yarbi_reply_style_patterns?owner_key=eq.default&select=id,pattern_key,category,guidance,confidence,evidence_message_ids,evidence_count,status,first_seen_at,last_seen_at,created_at,updated_at&order=updated_at.asc&limit=' + entityLimit + localMirrorSince('updated_at', entityCursor), 'perfil de respuesta', 'yarbi_reply_style_patterns'),
      localMirrorRead(messageQuery, 'mensajes de WhatsApp'),
      deletionCursor ? localMirrorRead('/rest/v1/whatsapp_messages?select=id,deleted_at&deleted_at=gte.' + encodeURIComponent(deletionCursor) + '&order=deleted_at.asc&limit=' + messageLimit, 'borrados de WhatsApp') : Promise.resolve([])
    ]);
    const entityRows = [...contacts, ...identifiers, ...memories, ...agenda, ...alerts, ...analyses, ...observations, ...receivables, ...habits, ...replyStyles];
    const oldest = messages.reduce((value, row) => Math.min(value || Number.MAX_SAFE_INTEGER, Number(row.timestamp) || Number.MAX_SAFE_INTEGER), 0);
    return res.status(200).json({ status: 'ok', contract: 'yarbi-local-mirror-v3', server_time: new Date().toISOString(), entities: { contacts, identifiers, memories, agenda, alerts, analyses, observations, receivables, habits, reply_styles: replyStyles }, messages, deleted_message_ids: deletedMessages.map(row => String(row.id || '')).filter(Boolean), cursors: { entity_cursor: localMirrorMaxIso(entityRows, 'updated_at', entityCursor), message_cursor: historyBefore ? messageCursor : localMirrorMaxNumber(messages, 'timestamp', messageCursor), deletion_cursor: localMirrorMaxIso(deletedMessages, 'deleted_at', deletionCursor), history_before: (historyBefore || !messageCursor) && messages.length === messageLimit ? oldest : null }, has_more_history: Boolean((historyBefore || !messageCursor) && messages.length === messageLimit && oldest) });
  } catch (error) {
    const detail = String(error?.message || error).slice(0, 300), setup = /crm_contacts|contact_identifiers|ai_conversation_memory|agenda_events|ai_message_analysis/i.test(detail);
    return res.status(setup ? 424 : 502).json({ error: setup ? 'La réplica local requiere las tablas de Yarbi en Supabase' : 'No se pudo sincronizar la réplica local', detail, status: setup ? 'setup_required' : 'unavailable' });
  }
}

const HISTORY_STOP_WORDS = new Set('a al algo algun alguna algunos ante antes asi aunque bajo bien cada cliente como con contra cual cuando de del desde donde dos el ella en entre era ese esa es esta estaba este esto fue habia hacia hasta la las le les lo los mas me mi mientras muy no nos o para pero por porque que quien se si sin sobre su sus te tenia tiene todo tu un una uno unos ya yo'.split(' '));
function historyNormalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function historyProfile(query) {
  const normalized = historyNormalize(query);
  return {
    normalized,
    terms:Array.from(new Set(normalized.split(' ').filter(term => term.length >= 3 && !HISTORY_STOP_WORDS.has(term)))).slice(0,18),
    construction:/\b(construccion|construir|obra|instalacion|trabajo)\b/.test(normalized),
    visit:/\b(visita|visitar|cotizacion)\b/.test(normalized),
    travel:/\b(viaje|viajar|viajo|viajaba|fuera|regreso|regresar|volviera|vuelva|llegue|retorne)\b/.test(normalized),
    reprogram:/\b(reprogram|posterg|cambiar fecha|otra fecha|cuando vuelva|cuando llegue|cuando regrese|cancel)\b/.test(normalized),
    location:/\b(ubicacion|mapa|maps|direccion|coordenadas|distrito)\b/.test(normalized),
    saturday:/\bsabado\b/.test(normalized)
  };
}
function historySaturday(value) {
  const raw = String(value || '').slice(0,10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const date = new Date(raw + 'T12:00:00-05:00');
  return Number.isFinite(date.getTime()) && date.getDay() === 6;
}
function historyEvidenceText(row = {}) { return String(row.text || row.value || row.summary || row.description || row.reason || row.title || '').replace(/\s+/g,' ').trim(); }
function historyScore(profile, group) {
  const messageText = historyNormalize(group.messages.map(historyEvidenceText).join(' '));
  const agendaText = historyNormalize(group.agenda.map(row => [row.event_type,row.title,row.service,row.description,row.status,row.location].filter(Boolean).join(' ')).join(' '));
  const processedText = historyNormalize([
    ...group.analyses.map(row => [row.intent,row.service,JSON.stringify(row.extracted_data || {})].join(' ')),
    ...group.observations.map(row => [row.observation_type,row.category,row.value].join(' ')),
    ...group.memories.map(row => [row.summary,row.latest_intent,row.latest_service,row.follow_up_status,row.next_steps].join(' '))
  ].join(' '));
  const identityText = historyNormalize([group.name,...group.aliases,group.phone].join(' '));
  const all = [identityText,messageText,agendaText,processedText].join(' ');
  let score = 0;
  const matched = [];
  profile.terms.forEach(term => { if(all.includes(term)){ score += identityText.includes(term) ? 20 : (agendaText.includes(term) ? 10 : 6); matched.push(term); } });
  const hasConstruction=/\b(construccion|construir|obra|instalacion|trabajo)\b/.test(agendaText+' '+messageText+' '+processedText);
  const hasVisit=/\b(visita|visitar|cotizacion)\b/.test(agendaText+' '+messageText+' '+processedText);
  const hasTravel=/\b(viaje|viajar|viajo|viajaba|fuera|regreso|regresar|volviera|vuelva|llegue|retorne)\b/.test(messageText+' '+processedText);
  const hasReprogram=/\b(reprogram|posterg|cambiar fecha|otra fecha|cuando vuelva|cuando llegue|cuando regrese|cancel)\b/.test(agendaText+' '+messageText+' '+processedText);
  const hasLocation=/\b(ubicacion|mapa|maps|direccion|coordenadas)\b/.test(all)||group.messages.some(row=>row.maps_url)||group.agenda.some(row=>row.maps_url);
  const hasSaturday=group.agenda.some(row=>historySaturday(row.starts_at));
  if(profile.construction&&hasConstruction){score+=30;matched.push('construcción');}
  if(profile.visit&&hasVisit){score+=14;matched.push('visita');}
  if(profile.travel&&hasTravel){score+=28;matched.push('viaje');}
  if(profile.reprogram&&hasReprogram){score+=32;matched.push('reprogramación');}
  if(profile.location&&hasLocation){score+=20;matched.push('ubicación');}
  if(profile.saturday&&hasSaturday){score+=28;matched.push('sábado');}
  const evidence=[...group.messages,...group.observations,...group.analyses,...group.agenda].map(row=>({row,text:historyEvidenceText(row)})).filter(item=>item.text&&profile.terms.some(term=>historyNormalize(item.text).includes(term))).slice(0,4).map(item=>item.text.slice(0,260));
  return {score,matched:Array.from(new Set(matched)),evidence};
}
async function clueSearch(query) {
  const profile = historyProfile(query);
  if (!profile.normalized) return { candidates:[], count:0 };
  const [contacts,identifiers,messages,agenda,analyses,observations,memories] = await Promise.all([
    localMirrorRead('/rest/v1/crm_contacts?select=id,full_name,display_name,commercial_status,operational_status,updated_at&order=updated_at.desc&limit=1000','contactos para búsqueda histórica'),
    localMirrorRead('/rest/v1/contact_identifiers?identifier_type=eq.phone&select=id,contact_id,identifier_value,normalized_value,is_primary&limit=2000','identificadores para búsqueda histórica'),
    localMirrorRead('/rest/v1/whatsapp_messages?deleted_at=is.null&select=id,contact_id,phone,title,text,maps_url,timestamp,metadata&order=timestamp.desc&limit=5000','mensajes para búsqueda histórica'),
    localMirrorRead('/rest/v1/agenda_events?select=id,contact_id,event_type,title,service,description,location,maps_url,starts_at,status,updated_at&order=updated_at.desc&limit=1500','agenda para búsqueda histórica'),
    localMirrorRead('/rest/v1/ai_message_analysis?status=eq.completed&select=id,message_id,contact_id,intent,service,extracted_data,completed_at&order=completed_at.desc&limit=3000','análisis para búsqueda histórica'),
    localMirrorReadOptional('/rest/v1/ai_contact_observations?status=eq.active&select=id,contact_id,observation_type,category,value,source_message_ids,confidence,observed_at&order=observed_at.desc&limit=3000','observaciones para búsqueda histórica','ai_contact_observations'),
    localMirrorRead('/rest/v1/ai_conversation_memory?select=contact_id,summary,latest_intent,latest_service,follow_up_status,next_steps,updated_at&order=updated_at.desc&limit=1000','memorias para búsqueda histórica')
  ]);
  const contactsById=new Map(contacts.map(row=>[String(row.id),row]));
  const phoneByContact=new Map(),contactByPhone=new Map();
  identifiers.sort((a,b)=>Number(b.is_primary||0)-Number(a.is_primary||0)).forEach(row=>{const id=String(row.contact_id||''),phone=cleanPhone(row.normalized_value||row.identifier_value||'');if(id&&phone&&!phoneByContact.has(id))phoneByContact.set(id,phone);if(id&&phone)contactByPhone.set(phone,id);});
  const groups=new Map();
  const ensure=(contactId='',phone='',fallbackName='')=>{const cleanId=String(contactId||''),cleanedPhone=cleanPhone(phone);const key=cleanId?'contact:'+cleanId:(cleanedPhone?'phone:'+cleanedPhone:'name:'+historyNormalize(fallbackName));if(!key||key==='name:')return null;if(!groups.has(key)){const contact=contactsById.get(cleanId)||{};groups.set(key,{contactId:cleanId,phone:cleanedPhone||phoneByContact.get(cleanId)||'',name:contact.display_name||contact.full_name||fallbackName||'Cliente',aliases:[],messages:[],agenda:[],analyses:[],observations:[],memories:[]});}return groups.get(key);};
  contacts.forEach(row=>ensure(String(row.id||''),phoneByContact.get(String(row.id||''))||'',row.display_name||row.full_name||''));
  messages.forEach(row=>{const phone=cleanPhone(row.phone),id=String(row.contact_id||contactByPhone.get(phone)||''),group=ensure(id,phone,row.title||'');if(!group)return;group.messages.push(row);[row.title,row.metadata?.profile_name,row.metadata?.profile_username,...(Array.isArray(row.metadata?.identity_aliases)?row.metadata.identity_aliases:[])].filter(Boolean).forEach(alias=>group.aliases.push(String(alias)));});
  agenda.forEach(row=>{const group=ensure(String(row.contact_id||''),phoneByContact.get(String(row.contact_id||''))||'',row.title||'');if(group)group.agenda.push(row);});
  analyses.forEach(row=>{const group=ensure(String(row.contact_id||''),phoneByContact.get(String(row.contact_id||''))||'','');if(group)group.analyses.push(row);});
  observations.forEach(row=>{const group=ensure(String(row.contact_id||''),phoneByContact.get(String(row.contact_id||''))||'','');if(group)group.observations.push(row);});
  memories.forEach(row=>{const group=ensure(String(row.contact_id||''),phoneByContact.get(String(row.contact_id||''))||'','');if(group)group.memories.push(row);});
  const candidates=Array.from(groups.values()).map(group=>({group,match:historyScore(profile,group)})).filter(item=>item.match.score>=24).sort((a,b)=>b.match.score-a.match.score).slice(0,8).map(item=>{const latestMessage=item.group.messages.slice().sort((a,b)=>Number(b.timestamp||0)-Number(a.timestamp||0))[0]||{};const latestAgenda=item.group.agenda.slice().sort((a,b)=>String(b.starts_at||'').localeCompare(String(a.starts_at||'')))[0]||{};return{contact_id:item.group.contactId,name:item.group.name||item.group.aliases[0]||'Cliente',aliases:Array.from(new Set(item.group.aliases.filter(Boolean))).slice(0,12),phone:item.group.phone,phone_last3:String(item.group.phone||'').slice(-3),score:item.match.score,confidence:item.match.score>=95?'high':(item.match.score>=58?'medium':'low'),matched_clues:item.match.matched,evidence:item.match.evidence,agenda:{type:latestAgenda.event_type||'',date:String(latestAgenda.starts_at||'').slice(0,10),status:latestAgenda.status||'',service:latestAgenda.service||''},latest_message:String(latestMessage.text||'').slice(0,280),latest_timestamp:Number(latestMessage.timestamp||0),source:'supabase-clue-search'};});
  return { candidates, count:candidates.length, searched:{terms:profile.terms,concepts:{construction:profile.construction,visit:profile.visit,travel:profile.travel,reprogram:profile.reprogram,location:profile.location,saturday:profile.saturday}} };
}
async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Assistant-Token');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Yarbi-Backend-Build', '20261022-history-clue-search');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!hasAssistantAccess(req)) return res.status(401).json({ error: 'No autorizado' });
  if (!SUPABASE_KEY) return res.status(500).json({ error: 'Falta SUPABASE_SECRET_KEY en el backend' });

  const query = req.query || {};
  if (String(firstQueryValue(query.action) || '') === 'habits') {
    try { return await habitCandidatesHandler(req, res); }
    catch (error) { return res.status(502).json({ error: 'No se pudieron consultar los hábitos de Yarbi', detail: String(error?.message || error).slice(0, 300) }); }
  }
  if (String(firstQueryValue(query.action) || '') === 'reply-style') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });
    try { return res.status(200).json({ status: 'ok', source: 'supabase-backend', reply_style_profile: await readOwnerReplyStyle() }); }
    catch (error) { return res.status(502).json({ error: 'No se pudo consultar el perfil de respuesta de Yarbi', detail: String(error?.message || error).slice(0, 300) }); }
  }
  if (String(firstQueryValue(query.action) || '') === 'alert-status') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
    const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body || '{}'); } catch (_) { return {}; } })() : (req.body || {});
    const id = Number.parseInt(String(body.id || ''), 10);
    const status = ['handled', 'dismissed'].includes(String(body.status || '')) ? String(body.status) : '';
    if (!Number.isSafeInteger(id) || id <= 0 || !status) return res.status(400).json({ error: 'invalid_alert_status' });
    const response = await fetch(`${SUPABASE_URL}/rest/v1/ai_intelligent_alerts?id=eq.${encodeURIComponent(String(id))}&alert_type=eq.agenda_proposal_ready`, {
      method: 'PATCH',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ status, updated_at: new Date().toISOString() })
    });
    const data = await response.json().catch(() => []);
    if (!response.ok) return res.status(response.status).json({ error: 'No se pudo actualizar la propuesta de agenda', detail: data });
    return res.status(200).json({ status: 'ok', alert: Array.isArray(data) ? data[0] || null : null });
  }
  if (String(firstQueryValue(query.action) || '') === 'local-sync') return localMirrorSync(req, res);
  if (String(firstQueryValue(query.action) || '') === 'preferences') {
    if (req.method === 'GET') {
      try { return res.status(200).json({ status: 'ok', owner_key: 'default', instructions: await readOwnerInstructions() }); }
      catch (error) { return res.status(500).json({ error: 'No se pudieron leer las instrucciones de Yarbi', detail: error.message }); }
    }
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      if (body.confirm !== true) return res.status(400).json({ error: 'confirmation_required' });
      const instruction = String(body.instruction || '').trim().replace(/\s+/g, ' ').slice(0, 1000);
      if (instruction.length < 8) return res.status(400).json({ error: 'instruction_too_short' });
      const categories = ['behavior', 'workflow', 'voice', 'safety', 'business', 'general'];
      const scopes = ['all', 'chat', 'voice', 'actions'];
      const category = categories.includes(String(body.category || '')) ? String(body.category) : 'general';
      const scope = scopes.includes(String(body.scope || '')) ? String(body.scope) : 'all';
      const response = await fetch(`${SUPABASE_URL}/rest/v1/yarbi_owner_instructions?on_conflict=owner_key,instruction`, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify([{ owner_key: 'default', instruction, category, scope, source: 'conversation', enabled: true, confirmed_at: new Date().toISOString() }])
      });
      const data = await response.json().catch(() => []);
      if (!response.ok) return res.status(response.status).json({ error: 'No se pudo guardar la instrucción de Yarbi', detail: data });
      return res.status(200).json({ status: 'saved', instruction: data?.[0] || null, instructions: await readOwnerInstructions() });
    }
    return res.status(405).json({ error: 'Método no permitido' });
  }
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });
  if (String(firstQueryValue(query.action) || '') === 'clue-search') {
    const fullQuery = [cleanSearchText(query.query),cleanSearchText(query.client_name),cleanSearchText(query.district),cleanSearchText(query.service),cleanSearchText(query.weekday),cleanSearchText(query.approximate_date)].filter(Boolean).join(' ');
    if (fullQuery.length < 3) return res.status(400).json({ error:'Faltan pistas para buscar el historial' });
    try { return res.status(200).json({ status:'ok', source:'supabase-clue-search', ...(await clueSearch(fullQuery)) }); }
    catch (error) { return res.status(502).json({ error:'No se pudo buscar el historial por pistas', detail:String(error?.message||error).slice(0,300) }); }
  }
  if (String(firstQueryValue(query.action) || '') === 'memory') {
    const phone = cleanPhone(query.phone);
    const clientName = cleanSearchText(query.client_name);
    if (!phone && !clientName) return res.status(400).json({ error: 'Falta phone o client_name' });
    try {
      const cacheKey = phone ? 'phone:' + phone : 'name:' + clientName.toLowerCase();
      const cached = memoryCacheRead(cacheKey);
      if (cached) return res.status(200).json({ status: 'ok', ...cached });
      const payload = phone ? await memoryForPhone(phone) : await memoryForContactName(clientName);
      memoryCacheWrite(cacheKey, payload);
      return res.status(200).json({ status: 'ok', source: 'supabase-backend', ...payload });
    } catch (error) { return res.status(500).json({ error: 'No se pudo leer la memoria de Yarbi', detail: error.message }); }
  }
  if (String(firstQueryValue(query.action) || '') === 'memory-overview') {
    const limit = Math.min(parseLimit(query.limit), 30);
    const requestedStatus = cleanSearchText(query.commercial_status).toLowerCase();
    const commercialStatus = ['all', 'frio', 'tibio', 'caliente'].includes(requestedStatus) ? requestedStatus : 'all';
    try { return res.status(200).json({ status: 'ok', source: 'supabase-backend', commercial_status: commercialStatus, ...(await memoryOverview(limit, commercialStatus)) }); }
    catch (error) { return res.status(500).json({ error: 'No se pudo leer el resumen CRM de Yarbi', detail: error.message }); }
  }
  const includeDeleted = ['1', 'true', 'yes'].includes(String(firstQueryValue(query.include_deleted) || '').toLowerCase());
  const phone = cleanPhone(query.phone);
  const since = parseTimestamp(query.since);
  const fromTimestamp = parseTimestamp(query.from_timestamp);
  const limit = parseLimit(query.limit);
  const order = String(firstQueryValue(query.order) || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

  const params = new URLSearchParams();
  params.set('select', '*');
  params.set('deleted_at', includeDeleted ? 'not.is.null' : 'is.null');
  if (phone) params.set('phone', `eq.${phone}`);
  if (since !== null) params.set('timestamp', `gt.${since}`);
  if (fromTimestamp !== null) params.set('timestamp', `gte.${fromTimestamp}`);
  params.set('order', `timestamp.${order}`);
  params.set('limit', String(limit));

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_messages?${params.toString()}`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
    });
    const body = await response.json().catch(() => []);
    if (!response.ok) {
      console.error('[WHATSAPP READ ERROR]', response.status, body);
      return res.status(response.status).json({ error: 'No se pudieron consultar los mensajes de WhatsApp', detail: body });
    }
    return res.status(200).json({
      status: 'ok',
      source: 'supabase-backend',
      messages: Array.isArray(body) ? body : []
    });
  } catch (error) {
    console.error('[WHATSAPP READ EXCEPTION]', error);
    return res.status(500).json({ error: 'Error de conexión con Supabase', detail: error.message });
  }
}

module.exports = handler;
module.exports.invalidateMemoryCache = invalidateMemoryCache;
