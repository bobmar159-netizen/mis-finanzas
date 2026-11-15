'use strict';

// Superficie de lectura interactiva de WhatsApp. Está separada del webhook:
// los proveedores conservan sus firmas en /api/webhook y el navegador solo
// llega aquí con una sesión Supabase y alcance canónico de contactos.
const { validateServerRouteConfig } = require('../../lib/yarbi-runtime-config');
const { authenticateCompleteScopedOwner, blockedOwnerInput, scopedFilter } = require('../../lib/yarbi-authenticated-route');
const crypto = require('node:crypto');

const SCOPE_BATCH_SIZE = 100;
const READ_CONCURRENCY = 3;
const LOCAL_INGEST_MAX_EVENTS = 24;
const LOCAL_INGEST_MAX_TEXT = 2000;

function first(value) { return Array.isArray(value) ? value[0] : value; }
function cleanPhone(value) { return String(first(value) || '').replace(/\D/g, '').slice(0, 20); }
function normalizedPhone(value) {
  const phone = cleanPhone(value);
  return phone.startsWith('51') && phone.length === 11 ? phone.slice(2) : phone;
}
function timestamp(value) {
  const raw = String(first(value) || '').trim();
  if (!/^\d{1,16}$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
function limit(value) {
  const parsed = Number.parseInt(String(first(value) || ''), 10);
  return Math.min(Math.max(Number.isFinite(parsed) ? parsed : 50, 1), 5000);
}
function offset(value) {
  const parsed = Number.parseInt(String(first(value) || ''), 10);
  return Math.min(Math.max(Number.isFinite(parsed) ? parsed : 0, 0), 100000);
}
function iso(value) {
  const raw = String(first(value) || '').trim();
  return raw && Number.isFinite(new Date(raw).getTime()) ? new Date(raw).toISOString() : null;
}
function body(req) {
  if (req?.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(String(req?.body || '{}')); } catch (_) { return {}; }
}
function scopeBatches(scope, batchSize = SCOPE_BATCH_SIZE) {
  const ids = [...new Set((Array.isArray(scope?.contact_ids) ? scope.contact_ids : [])
    .map(Number).filter(id => Number.isSafeInteger(id) && id > 0))];
  const batches = [];
  for (let index = 0; index < ids.length; index += batchSize) batches.push(ids.slice(index, index + batchSize));
  return batches;
}
async function mapConcurrent(items, concurrency, worker) {
  const values = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      values[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(concurrency, 1), items.length) }, run));
  return values;
}

function serviceClient(config, fetchImpl) {
  return async (path, options = {}) => {
    const response = await fetchImpl(config.supabaseUrl + path, {
      ...options,
      headers: { apikey: config.supabaseKey, Authorization: `Bearer ${config.supabaseKey}`, ...(options.headers || {}) }
    });
    return { response, data: await response.json().catch(() => []) };
  };
}

function messageQuery(query, scope) {
  const contactFilter = scopedFilter(scope);
  if (!contactFilter) return null;
  const params = new URLSearchParams();
  params.set('select', 'id,contact_id,phone,title,text,maps_url,app_name,timestamp,created_at,deleted_at,metadata');
  params.set('contact_id', contactFilter);
  params.set('deleted_at', ['1', 'true', 'yes'].includes(String(first(query.include_deleted) || '').toLowerCase()) ? 'not.is.null' : 'is.null');
  const phone = cleanPhone(query.phone);
  const since = timestamp(query.since);
  const fromTimestamp = timestamp(query.from_timestamp);
  const beforeTimestamp = timestamp(query.before_timestamp);
  if (phone) params.set('phone', `eq.${phone}`);
  if (since !== null) params.set('timestamp', `gt.${since}`);
  if (fromTimestamp !== null) params.set('timestamp', `gte.${fromTimestamp}`);
  if (beforeTimestamp !== null) params.set('timestamp', `lt.${beforeTimestamp}`);
  params.set('order', `timestamp.${String(first(query.order) || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc'}`);
  params.set('limit', String(limit(query.limit)));
  params.set('offset', String(offset(query.offset)));
  return '/rest/v1/whatsapp_messages?' + params.toString();
}

function messageQueries(query, scope) {
  const batches = scopeBatches(scope);
  if (batches.length <= 1) return batches.length ? [messageQuery(query, { contact_ids: batches[0] })] : [];
  const requestedOffset = offset(query.offset);
  const perBatch = Math.min(limit(query.limit) + requestedOffset, 5000);
  return batches.map(ids => messageQuery({ ...query, limit: perBatch, offset: 0 }, { contact_ids: ids }));
}

function rowTimestamp(row) {
  const numeric = Number(row?.timestamp || 0);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : (new Date(row?.created_at || 0).getTime() || 0);
}
function dedupeRows(rows, key = 'id') {
  const seen = new Set();
  return rows.filter(row => {
    const value = String(row?.[key] ?? '');
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}
async function readScopedMessages(supabase, query, scope) {
  const paths = messageQueries(query, scope).filter(Boolean);
  if (!paths.length) return [];
  const pages = await mapConcurrent(paths, READ_CONCURRENCY, async path => {
    const result = await supabase(path);
    if (!result.response.ok) {
      const error = new Error('whatsapp_messages_read_failed');
      error.status = result.response.status;
      throw error;
    }
    return Array.isArray(result.data) ? result.data : [];
  });
  const allowed = new Set(scope.contact_ids.map(Number));
  const direction = String(first(query.order) || 'desc').toLowerCase() === 'asc' ? 1 : -1;
  const globalOffset = paths.length > 1 ? offset(query.offset) : 0;
  return dedupeRows(pages.flat().filter(row => allowed.has(Number(row?.contact_id))))
    .sort((a, b) => direction * (rowTimestamp(a) - rowTimestamp(b)) || String(a.id).localeCompare(String(b.id)))
    .slice(globalOffset, globalOffset + limit(query.limit));
}

async function readScopedEntityRows(supabase, scope, spec, cursor, requestedLimit) {
  const batches = scopeBatches(scope);
  const paths = batches.map(ids => {
    const params = new URLSearchParams();
    params.set('select', spec.select);
    params.set(spec.scopeField || 'contact_id', scopedFilter({ contact_ids: ids }));
    if (cursor) params.set(spec.cursorField || 'updated_at', `gte.${cursor}`);
    params.set('order', `${spec.cursorField || 'updated_at'}.asc`);
    params.set('limit', String(requestedLimit));
    return `/rest/v1/${spec.table}?${params.toString()}`;
  });
  if (!paths.length) return [];
  const pages = await mapConcurrent(paths, READ_CONCURRENCY, async (path, index) => {
    const result = await supabase(path);
    if (!result.response.ok) {
      if (spec.optional) return [];
      const error = new Error('owner_sync_entity_read_failed');
      error.status = result.response.status;
      throw error;
    }
    const allowed = new Set(batches[index].map(Number));
    const field = spec.scopeField || 'contact_id';
    return Array.isArray(result.data) ? result.data.filter(row => allowed.has(Number(row?.[field]))) : [];
  });
  const rows = dedupeRows(pages.flat(), spec.key || 'id');
  const field = spec.cursorField || 'updated_at';
  return rows.sort((a, b) => String(a?.[field] || '').localeCompare(String(b?.[field] || ''))).slice(0, requestedLimit);
}

function maxIso(rows, field, fallback = null) {
  return rows.reduce((latest, row) => {
    const value = iso(row?.[field]);
    return value && (!latest || value > latest) ? value : latest;
  }, fallback);
}
function maxNumber(rows, field, fallback = null) {
  return rows.reduce((latest, row) => Math.max(Number(latest || 0), Number(row?.[field] || 0)) || null, fallback);
}

function localEvent(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const eventId = String(source.event_id || source.id || '').trim();
  const phone = normalizedPhone(source.phone);
  const title = String(source.title || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
  const text = String(source.text || '').replace(/\u0000/g, '').trim().slice(0, LOCAL_INGEST_MAX_TEXT);
  const occurredAt = Number(source.timestamp);
  if (!/^[A-Za-z0-9:_-]{8,160}$/.test(eventId) || !/^\d{8,15}$/.test(phone) || !title || !text
    || !Number.isSafeInteger(occurredAt) || occurredAt < 946684800000 || occurredAt > Date.now() + 86400000) return null;
  return { event_id: eventId, phone, title, text, timestamp: occurredAt };
}

function localMessageId(ownerId, eventId) {
  return 'android-local-' + crypto.createHash('sha256').update(String(ownerId) + '\u0000' + String(eventId)).digest('hex');
}

async function resolveScopedContactByPhone(supabase, scope, phone) {
  const batches = scopeBatches(scope);
  if (!batches.length) return null;
  const matches = [];
  for (const ids of batches) {
    const params = new URLSearchParams();
    params.set('select', 'contact_id');
    params.set('identifier_type', 'eq.phone');
    params.set('normalized_value', 'eq.' + phone);
    params.set('contact_id', scopedFilter({ contact_ids: ids }));
    params.set('limit', '2');
    const result = await supabase('/rest/v1/contact_identifiers?' + params.toString());
    if (!result?.response?.ok) {
      const error = new Error('local_notification_contact_lookup_failed');
      error.status = result?.response?.status;
      throw error;
    }
    for (const row of Array.isArray(result.data) ? result.data : []) {
      const contactId = Number(row?.contact_id);
      if (Number.isSafeInteger(contactId) && contactId > 0 && !matches.includes(contactId)) matches.push(contactId);
    }
    if (matches.length > 1) return null;
  }
  return matches.length === 1 ? matches[0] : null;
}

async function ingestLocalNotifications(req, res, supabase, access) {
  const input = body(req);
  if (blockedOwnerInput(input)) return res.status(400).json({ error: 'owner_scope_client_input_forbidden' });
  // No se acepta una carga genérica de texto. El cliente debe declarar que son
  // eventos capturados localmente; la identidad del dueño sigue viniendo sólo
  // del Bearer ya validado, nunca del cuerpo.
  if (input.acknowledge_local_capture !== true) return res.status(400).json({ error: 'local_notification_capture_acknowledgement_required' });
  const requested = Array.isArray(input.events) ? input.events.slice(0, LOCAL_INGEST_MAX_EVENTS) : [];
  if (!requested.length || (Array.isArray(input.events) && input.events.length > LOCAL_INGEST_MAX_EVENTS)) {
    return res.status(400).json({ error: 'local_notification_events_invalid' });
  }
  const outcomes = [];
  let persisted = 0;
  let unresolved = 0;
  for (const rawEvent of requested) {
    const event = localEvent(rawEvent);
    if (!event) {
      outcomes.push({ event_id: String(rawEvent?.event_id || rawEvent?.id || '').slice(0, 160), outcome: 'invalid' });
      continue;
    }
    let contactId;
    try {
      contactId = await resolveScopedContactByPhone(supabase, access.scope, event.phone);
    } catch (error) {
      return res.status(error?.status >= 400 && error.status < 500 ? error.status : 502).json({ error: 'local_notification_contact_lookup_unavailable' });
    }
    if (!contactId) {
      unresolved += 1;
      outcomes.push({ event_id: event.event_id, outcome: 'unresolved_contact' });
      continue;
    }
    const id = localMessageId(access.scope.owner_id, event.event_id);
    const result = await supabase('/rest/v1/whatsapp_messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{
        id,
        contact_id: contactId,
        phone: event.phone,
        title: event.title,
        text: event.text,
        maps_url: null,
        app_name: 'Android notification capture',
        timestamp: event.timestamp,
        // Las notificaciones de Android no prueban un historial completo ni
        // una acción comercial. Su procedencia queda visible para que ningún
        // componente posterior las trate como importación confirmada.
        metadata: {
          direction: 'incoming',
          historical: false,
          source_event: 'android_notification_capture',
          local_event_id: event.event_id,
          identity_status: 'contact_confirmed_by_owner_scope',
          ingestion_version: 'yarbi.local-notification.v1'
        }
      }])
    });
    if (!result?.response?.ok) return res.status(502).json({ error: 'local_notification_persist_failed' });
    persisted += 1;
    outcomes.push({ event_id: event.event_id, outcome: 'persisted' });
  }
  return res.status(200).json({
    status: 'ok', source: 'android_notification_capture', persisted, unresolved,
    outcomes,
    note: 'Solo se guardaron eventos con teléfono vinculado a un contacto dentro del alcance autenticado. Los no resueltos permanecen locales hasta una confirmación explícita.'
  });
}

const LOCAL_ENTITY_SPECS = [
  { name:'contacts', table:'crm_contacts', scopeField:'id', select:'id,full_name,display_name,commercial_status,status_reason,commercial_status_event_at,commercial_status_source_message_ids,operational_status,operational_reason,operational_event_at,operational_status_source_message_ids,notes,source,created_at,updated_at' },
  { name:'identifiers', table:'contact_identifiers', select:'id,contact_id,identifier_type,identifier_value,normalized_value,is_primary,created_at,updated_at' },
  { name:'memories', table:'ai_conversation_memory', key:'contact_id', select:'contact_id,summary,last_interaction_at,last_ai_interaction_at,customer_summary_version,latest_intent,latest_service,follow_up_status,next_steps,created_at,updated_at' },
  { name:'agenda', table:'agenda_events', select:'id,contact_id,event_type,title,service,description,location,maps_url,latitude,longitude,starts_at,ends_at,timezone,status,source,dedupe_key,created_at,updated_at' },
  { name:'alerts', table:'ai_intelligent_alerts', select:'id,contact_id,analysis_id,agenda_event_id,alert_type,title,reason,severity,status,created_at,updated_at' },
  { name:'analyses', table:'ai_message_analysis', select:'id,message_id,contact_id,status,intent,service,extracted_data,confidence,requires_review,error_message,analyzed_at,completed_at,created_at,updated_at' },
  { name:'observations', table:'ai_contact_observations', optional:true, select:'id,contact_id,analysis_id,processing_run_id,observation_type,category,value,source_message_ids,confidence,status,observed_at,created_at,updated_at' },
  { name:'receivables', table:'yarbi_receivables', optional:true, select:'id,contact_id,agreed_amount,paid_amount,balance_amount,status,next_action,next_action_due,created_at,updated_at' }
];

async function ownerLocalSync(req, res, supabase, access) {
  const input = body(req);
  if (blockedOwnerInput(input)) return res.status(400).json({ error: 'owner_scope_client_input_forbidden' });
  const entityCursor = iso(input.entity_cursor);
  const messageCursor = timestamp(input.message_cursor);
  const deletionCursor = iso(input.deletion_cursor);
  const historyBefore = timestamp(input.history_before);
  const messageLimit = Math.min(limit(input.message_limit || 200), 250);
  const entityLimit = Math.min(limit(input.entity_limit || 400), 500);
  try {
    const entityPages = await Promise.all(LOCAL_ENTITY_SPECS.map(spec => readScopedEntityRows(supabase, access.scope, spec, entityCursor, entityLimit)));
    const entities = Object.fromEntries(LOCAL_ENTITY_SPECS.map((spec, index) => [spec.name, entityPages[index]]));
    entities.habits = [];
    entities.reply_styles = [];
    const messageRequest = historyBefore
      ? { before_timestamp: historyBefore, order:'desc', limit:messageLimit }
      : messageCursor
        ? { from_timestamp: Math.max(0, messageCursor - 1), order:'asc', limit:messageLimit }
        : { order:'desc', limit:messageLimit };
    const messages = await readScopedMessages(supabase, messageRequest, access.scope);
    const deleted = deletionCursor
      ? await readScopedMessages(supabase, { include_deleted:'true', order:'asc', limit:messageLimit }, access.scope)
      : [];
    const deletedMessages = deleted.filter(row => {
      const value = iso(row?.deleted_at);
      return value && value >= deletionCursor;
    });
    const entityRows = entityPages.flat();
    const oldest = messages.reduce((value, row) => Math.min(value || Number.MAX_SAFE_INTEGER, rowTimestamp(row) || Number.MAX_SAFE_INTEGER), 0);
    return res.status(200).json({
      status:'ok',
      contract:'yarbi-local-mirror-v4-owner-scoped',
      source:'supabase-backend',
      server_time:new Date().toISOString(),
      entities,
      messages,
      deleted_message_ids:deletedMessages.map(row => String(row.id || '')).filter(Boolean),
      cursors:{
        entity_cursor:maxIso(entityRows, 'updated_at', entityCursor),
        message_cursor:historyBefore ? messageCursor : maxNumber(messages, 'timestamp', messageCursor),
        deletion_cursor:maxIso(deletedMessages, 'deleted_at', deletionCursor),
        history_before:(historyBefore || !messageCursor) && messages.length === messageLimit ? oldest : null
      },
      has_more_history:Boolean((historyBefore || !messageCursor) && messages.length === messageLimit && oldest)
    });
  } catch (error) {
    return res.status(error?.status >= 400 && error.status < 500 ? error.status : 502).json({ error:'whatsapp_owner_sync_unavailable' });
  }
}

function createWhatsAppMessagesHandler({ configResolver = () => validateServerRouteConfig({ requirePublicAuth: true }), authenticate = authenticateCompleteScopedOwner, fetchImpl = fetch } = {}) {
  return async function whatsappMessagesHandler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'method_not_allowed' });
    const query = req.query || {};
    if (blockedOwnerInput(query)) return res.status(400).json({ error: 'owner_scope_client_input_forbidden' });
    const action = String(first(query.action) || '').trim();
    if (action && !['local-sync', 'local-ingest'].includes(action)) return res.status(410).json({ error: 'interactive_whatsapp_action_moved' });
    if (req.method === 'POST' && !['local-sync', 'local-ingest'].includes(action)) return res.status(405).json({ error: 'method_not_allowed' });
    if (req.method === 'GET' && action === 'local-sync') return res.status(405).json({ error: 'method_not_allowed' });
    if (req.method === 'GET' && action === 'local-ingest') return res.status(405).json({ error: 'method_not_allowed' });
    const config = configResolver();
    if (!config?.ok) return res.status(503).json({ error: 'configuration_invalid', code: config?.code || 'configuration_invalid' });
    const supabase = serviceClient(config, fetchImpl);
    const access = await authenticate(req, config, supabase, fetchImpl);
    if (!access?.ok) return res.status(access?.status || 403).json({ error: access?.code || 'owner_scope_forbidden' });
    if (action === 'local-sync') return ownerLocalSync(req, res, supabase, access);
    if (action === 'local-ingest') return ingestLocalNotifications(req, res, supabase, access);
    if (!scopeBatches(access.scope).length) return res.status(200).json({ status: 'ok', source: 'supabase-backend', messages: [] });
    try {
      const messages = await readScopedMessages(supabase, query, access.scope);
      return res.status(200).json({ status: 'ok', source: 'supabase-backend', messages });
    } catch (error) {
      return res.status(error?.status >= 400 && error.status < 500 ? error.status : 502).json({ error: 'whatsapp_messages_unavailable' });
    }
  };
}

module.exports = createWhatsAppMessagesHandler();
module.exports.createWhatsAppMessagesHandler = createWhatsAppMessagesHandler;
module.exports.messageQuery = messageQuery;
module.exports.messageQueries = messageQueries;
module.exports.ingestLocalNotifications = ingestLocalNotifications;
module.exports.localEvent = localEvent;
module.exports.localMessageId = localMessageId;
module.exports.resolveScopedContactByPhone = resolveScopedContactByPhone;
