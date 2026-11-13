'use strict';

// Planificador puro para el backfill histórico. No llama a Gemini ni escribe
// estados comerciales: solo prepara lotes deterministas que el procesador
// autorizado podrá consumir de forma idempotente.
const crypto = require('node:crypto');
const { verifiedOwnerId } = require('./yarbi-owner-scope');

const MAX_HISTORICAL_SCOPE_CONTACTS = 5000;
const MESSAGES_PER_HISTORICAL_TASK = 60;
const MAX_HISTORICAL_MESSAGES = 50000;
// JSON Schema estándar para Structured Output. Se mantiene compacto porque el
// proveedor ya rechazó esquemas grandes en rutas anteriores de Yarbi.
const HISTORICAL_INTELLIGENCE_RESPONSE_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    contact_context_observations: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          category: { type: 'string', enum: ['relationship', 'service_interest', 'preference', 'follow_up', 'unknown'] },
          summary: { type: 'string' },
          source_message_ids: { type: 'array', minItems: 1, maxItems: 60, items: { type: 'string' } },
          confidence: { type: 'number', minimum: 0, maximum: 1 }
        },
        required: ['category', 'summary', 'source_message_ids', 'confidence']
      }
    },
    reply_style_patterns: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          pattern_key: { type: 'string' },
          category: { type: 'string', enum: ['tone', 'brevity', 'greeting', 'follow_up', 'pricing', 'scheduling', 'objection', 'closing', 'formatting'] },
          guidance: { type: 'string' },
          source_message_ids: { type: 'array', minItems: 1, maxItems: 60, items: { type: 'string' } },
          confidence: { type: 'number', minimum: 0, maximum: 1 }
        },
        required: ['pattern_key', 'category', 'guidance', 'source_message_ids', 'confidence']
      }
    },
    requires_owner_review: { type: 'boolean' }
  },
  required: ['contact_context_observations', 'reply_style_patterns', 'requires_owner_review']
});

function text(value, limit = 1600) {
  return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}
function stableKey(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function historicalMessage(row) {
  return Boolean(row?.metadata?.historical) && Boolean(row?.contact_id) && Boolean(text(row?.text));
}

function taskMessageSet(task) {
  return new Set((Array.isArray(task?.message_ids) ? task.message_ids : []).map(id => String(id || '')).filter(Boolean));
}

function taskMessages(task, messages) {
  const ids = taskMessageSet(task);
  if (!ids.size) {
    const error = new Error('historical_task_messages_missing');
    error.code = error.message;
    throw error;
  }
  const rows = (Array.isArray(messages) ? messages : []).filter(row => historicalMessage(row) && String(row.contact_id) === String(task?.contact_id) && ids.has(String(row.id)));
  if (rows.length !== ids.size) {
    const error = new Error('historical_task_message_scope_invalid');
    error.code = error.message;
    throw error;
  }
  return rows.sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
}

function modelSafeMessages(task, messages) {
  return taskMessages(task, messages).map(row => ({
    id: String(row.id),
    speaker: row?.metadata?.direction === 'outgoing' ? 'negocio' : 'cliente',
    text: text(row.text, 1600)
  }));
}

// Este contrato conserva la diferencia entre aprender el contexto/estilo y
// declarar una venta, visita o pago. Ninguna salida puede cambiar CRM, Agenda
// o Finanzas: el dueño debe revisar las observaciones antes de activarlas.
function buildHistoricalIntelligenceRequest({ task, messages } = {}) {
  const selected = modelSafeMessages(task, messages);
  return {
    response_mime_type: 'application/json',
    response_json_schema: HISTORICAL_INTELLIGENCE_RESPONSE_SCHEMA,
    prompt: [
      'Analiza este segmento HISTÓRICO de una conversación de WhatsApp.',
      'Distingue negocio de cliente. Resume únicamente contexto reutilizable y patrones de cómo responde el negocio.',
      'No declares pagos, visitas, servicios terminados, cierres, deuda ni citas como hechos.',
      'No inventes nombres, teléfonos, direcciones, precios ni fechas. No copies texto literal sensible.',
      'Toda observación debe citar IDs de este segmento. Los patrones de estilo deben citar solo mensajes del negocio.',
      'El resultado siempre exige revisión explícita del propietario antes de usarse.',
      'SEGMENTO:', JSON.stringify(selected)
    ].join('\n')
  };
}

function confidence(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : null;
}

function idsWithin(value, allowed) {
  const ids = [...new Set((Array.isArray(value) ? value : []).map(id => String(id || '')).filter(id => allowed.has(id)))];
  return ids;
}

function normalizeHistoricalIntelligenceResult({ task, result } = {}) {
  const allowed = taskMessageSet(task);
  if (!allowed.size) {
    const error = new Error('historical_task_messages_missing');
    error.code = error.message;
    throw error;
  }
  const outgoing = new Set((Array.isArray(task?.outgoing_message_ids) ? task.outgoing_message_ids : []).map(id => String(id || '')));
  const source = result && typeof result === 'object' && !Array.isArray(result) ? result : {};
  const observationCategories = new Set(['relationship', 'service_interest', 'preference', 'follow_up', 'unknown']);
  const styleCategories = new Set(['tone', 'brevity', 'greeting', 'follow_up', 'pricing', 'scheduling', 'objection', 'closing', 'formatting']);
  const observations = (Array.isArray(source.contact_context_observations) ? source.contact_context_observations : []).map(row => {
    const sourceIds = idsWithin(row?.source_message_ids, allowed);
    const category = observationCategories.has(String(row?.category || '')) ? String(row.category) : 'unknown';
    const summary = text(row?.summary, 280);
    const score = confidence(row?.confidence);
    return summary && sourceIds.length && score !== null ? { category, summary, source_message_ids: sourceIds, confidence: score, commercial_fact: false, requires_owner_review: true } : null;
  }).filter(Boolean).slice(0, 12);
  const patterns = (Array.isArray(source.reply_style_patterns) ? source.reply_style_patterns : []).map(row => {
    const sourceIds = idsWithin(row?.source_message_ids, outgoing);
    const category = styleCategories.has(String(row?.category || '')) ? String(row.category) : null;
    const patternKey = text(row?.pattern_key, 80).toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    const guidance = text(row?.guidance, 280);
    const score = confidence(row?.confidence);
    return patternKey && category && guidance && sourceIds.length && score !== null ? { pattern_key: patternKey, category, guidance, source_message_ids: sourceIds, confidence: score, requires_owner_review: true } : null;
  }).filter(Boolean).slice(0, 8);
  return {
    schema: 'yarbi.historical-intelligence-result.v1',
    task_key: text(task?.idempotency_key, 128),
    contact_id: String(task?.contact_id || ''),
    contact_context_observations: observations,
    reply_style_patterns: patterns,
    requires_owner_review: true,
    commercial_effects_allowed: false,
    status: 'awaiting_owner_review'
  };
}

function contactIds(rows) {
  return [...new Set((Array.isArray(rows) ? rows : [])
    .map(row => Number(row?.contact_id))
    .filter(id => Number.isSafeInteger(id) && id > 0))];
}

// El resolvedor interactivo conserva su límite pequeño para respuestas rápidas.
// El importador histórico usa este lector paginado independiente: o enumera todo
// el alcance autorizado, o falla de forma explícita; nunca trunca en silencio.
function createHistoricalOwnerScopeResolver({ supabase, pageSize = 128, maxContacts = MAX_HISTORICAL_SCOPE_CONTACTS } = {}) {
  const size = Math.min(Math.max(Number(pageSize) || 128, 1), 500);
  const cap = Math.min(Math.max(Number(maxContacts) || MAX_HISTORICAL_SCOPE_CONTACTS, 1), MAX_HISTORICAL_SCOPE_CONTACTS);
  return async function resolveHistoricalOwnerScope(validatedIdentity) {
    if (typeof supabase !== 'function') {
      const error = new Error('historical_owner_scope_store_unavailable');
      error.code = error.message;
      throw error;
    }
    const ownerId = verifiedOwnerId(validatedIdentity);
    const ids = [];
    for (let offset = 0; ; offset += size) {
      const path = '/rest/v1/yarbi_owner_contact_scope?owner_account_id=eq.' + encodeURIComponent(ownerId)
        + '&select=contact_id&order=contact_id.asc&limit=' + size + '&offset=' + offset;
      const result = await supabase(path);
      if (!result?.response?.ok || !Array.isArray(result.data)) {
        const error = new Error('historical_owner_scope_read_failed');
        error.code = error.message;
        throw error;
      }
      const page = contactIds(result.data);
      ids.push(...page);
      if (ids.length > cap) {
        const error = new Error('historical_owner_scope_limit_exceeded');
        error.code = error.message;
        throw error;
      }
      if (result.data.length < size) break;
    }
    return {
      schema: 'yarbi.historical-owner-scope.v1',
      owner_id: ownerId,
      contact_ids: ids,
      pages_read: Math.ceil(ids.length / size),
      verification: 'canonical_owner_contact_scope_paged'
    };
  };
}

// Lee solo mensajes del alcance canónico validado. El texto permanece en
// memoria el tiempo mínimo para armar segmentos: la cola durable guarda solo
// sus referencias, nunca copias del chat.
function createHistoricalMessageReader({ supabase, contactBatchSize = 50, pageSize = 250, maxMessages = MAX_HISTORICAL_MESSAGES } = {}) {
  const batchSize = Math.min(Math.max(Number(contactBatchSize) || 50, 1), 100);
  const size = Math.min(Math.max(Number(pageSize) || 250, 1), 500);
  const cap = Math.min(Math.max(Number(maxMessages) || MAX_HISTORICAL_MESSAGES, 1), MAX_HISTORICAL_MESSAGES);
  return async function readHistoricalMessages(scope) {
    if (typeof supabase !== 'function') {
      const error = new Error('historical_message_store_unavailable');
      error.code = error.message;
      throw error;
    }
    const contactIds = [...new Set((Array.isArray(scope?.contact_ids) ? scope.contact_ids : [])
      .map(Number).filter(id => Number.isSafeInteger(id) && id > 0))];
    const rows = [];
    for (let batchStart = 0; batchStart < contactIds.length; batchStart += batchSize) {
      const batch = contactIds.slice(batchStart, batchStart + batchSize);
      for (let offset = 0; ; offset += size) {
        const path = '/rest/v1/whatsapp_messages?deleted_at=is.null&select=id,contact_id,text,timestamp,metadata'
          + '&contact_id=in.(' + encodeURIComponent(batch.join(',')) + ')'
          + '&order=timestamp.asc,id.asc&limit=' + size + '&offset=' + offset;
        const result = await supabase(path);
        if (!result?.response?.ok || !Array.isArray(result.data)) {
          const error = new Error('historical_message_read_failed');
          error.code = error.message;
          throw error;
        }
        rows.push(...result.data.filter(historicalMessage));
        if (rows.length > cap) {
          const error = new Error('historical_message_limit_exceeded');
          error.code = error.message;
          throw error;
        }
        if (result.data.length < size) break;
      }
    }
    return rows;
  };
}

function createHistoricalTaskMessageReader({ supabase, batchSize = 50 } = {}) {
  const size = Math.min(Math.max(Number(batchSize) || 50, 1), 60);
  return async function readHistoricalTaskMessages(task) {
    if (typeof supabase !== 'function') {
      const error = new Error('historical_message_store_unavailable');
      error.code = error.message;
      throw error;
    }
    const contactId = Number(task?.contact_id);
    const messageIds = [...taskMessageSet(task)];
    if (!Number.isSafeInteger(contactId) || contactId <= 0 || !messageIds.length) {
      const error = new Error('historical_task_message_query_invalid');
      error.code = error.message;
      throw error;
    }
    const rows = [];
    for (let offset = 0; offset < messageIds.length; offset += size) {
      const batch = messageIds.slice(offset, offset + size);
      const path = '/rest/v1/whatsapp_messages?deleted_at=is.null&select=id,contact_id,text,timestamp,metadata'
        + '&contact_id=eq.' + encodeURIComponent(String(contactId))
        + '&id=in.(' + encodeURIComponent(batch.join(',')) + ')';
      const result = await supabase(path);
      if (!result?.response?.ok || !Array.isArray(result.data)) {
        const error = new Error('historical_task_message_read_failed');
        error.code = error.message;
        throw error;
      }
      rows.push(...result.data);
    }
    // La comprobación final verifica que la consulta no sustituyó ni omitió un
    // mensaje y que cada fila sigue marcada como histórica.
    taskMessages(task, rows);
    return rows;
  };
}

async function planHistoricalOwnerIntelligence({ ownerIdentity, resolveOwnerScope, readMessages, limit, processed_keys } = {}) {
  if (typeof resolveOwnerScope !== 'function' || typeof readMessages !== 'function') {
    const error = new Error('historical_planning_dependencies_unavailable');
    error.code = error.message;
    throw error;
  }
  const ownerId = verifiedOwnerId(ownerIdentity);
  const scope = await resolveOwnerScope(ownerIdentity);
  if (String(scope?.owner_id || '') !== ownerId) {
    const error = new Error('historical_owner_scope_binding_invalid');
    error.code = error.message;
    throw error;
  }
  const messages = await readMessages(scope);
  const allowedContacts = new Set((scope.contact_ids || []).map(String));
  const plan = planHistoricalIntelligence({
    messages: (Array.isArray(messages) ? messages : []).filter(row => allowedContacts.has(String(row?.contact_id))),
    limit,
    processed_keys
  });
  return {
    ...plan,
    owner_id: ownerId,
    source: 'canonical_owner_scoped_historical_messages',
    counts: { scoped_contacts: allowedContacts.size, eligible_historical_messages: (Array.isArray(messages) ? messages : []).filter(historicalMessage).length, tasks: plan.tasks.length }
  };
}
function planHistoricalIntelligence(input = {}) {
  const limit = Math.max(1, Math.min(100, Number(input.limit) || 24));
  const processed = new Set((Array.isArray(input.processed_keys) ? input.processed_keys : []).map(String));
  const groups = new Map();
  (Array.isArray(input.messages) ? input.messages : []).filter(historicalMessage).forEach(message => {
    const contactId = String(message.contact_id);
    const list = groups.get(contactId) || [];
    list.push(message); groups.set(contactId, list);
  });
  const tasks = [];
  [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([contactId, rows]) => {
    const ordered = rows.sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
    const segmentCount = Math.ceil(ordered.length / MESSAGES_PER_HISTORICAL_TASK);
    for (let offset = 0; offset < ordered.length && tasks.length < limit; offset += MESSAGES_PER_HISTORICAL_TASK) {
      const selected = ordered.slice(offset, offset + MESSAGES_PER_HISTORICAL_TASK);
      const ids = selected.map(row => String(row.id || '')).filter(Boolean);
      if (!ids.length) continue;
      const key = stableKey(['yarbi.historical-intelligence.v1', contactId, ...ids].join(':'));
      if (processed.has(key)) continue;
      const outgoing = selected.filter(row => row?.metadata?.direction === 'outgoing').map(row => String(row.id));
      tasks.push({
        schema:'yarbi.historical-intelligence-task.v1',
        idempotency_key:key,
        contact_id:contactId,
        message_ids:ids,
        outgoing_message_ids:outgoing,
        segment_index: Math.floor(offset / MESSAGES_PER_HISTORICAL_TASK),
        segment_count: segmentCount,
        occurred_from: Number(selected[0]?.timestamp || 0) || null,
        occurred_to: Number(selected.at(-1)?.timestamp || 0) || null,
        purpose:'historical_contact_context_and_reply_style',
        requires_model:true,
        commercial_effects_allowed:false,
        status:'ready_for_model'
      });
    }
  });
  return { schema:'yarbi.historical-intelligence-plan.v1', tasks, safety:{ idempotent:true, commercial_effects_allowed:false, owner_review_required_for_rules:true } };
}

module.exports = {
  HISTORICAL_INTELLIGENCE_RESPONSE_SCHEMA,
  MAX_HISTORICAL_MESSAGES,
  MAX_HISTORICAL_SCOPE_CONTACTS,
  MESSAGES_PER_HISTORICAL_TASK,
  buildHistoricalIntelligenceRequest,
  createHistoricalMessageReader,
  createHistoricalOwnerScopeResolver,
  createHistoricalTaskMessageReader,
  normalizeHistoricalIntelligenceResult,
  planHistoricalOwnerIntelligence,
  planHistoricalIntelligence
};
