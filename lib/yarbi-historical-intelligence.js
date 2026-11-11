'use strict';

// Planificador puro para el backfill histórico. No llama a Gemini ni escribe
// estados comerciales: solo prepara lotes deterministas que el procesador
// autorizado podrá consumir de forma idempotente.
const crypto = require('node:crypto');
const { verifiedOwnerId } = require('./yarbi-owner-scope');

const MAX_HISTORICAL_SCOPE_CONTACTS = 5000;

function text(value, limit = 1600) {
  return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}
function stableKey(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function historicalMessage(row) {
  return Boolean(row?.metadata?.historical) && Boolean(row?.contact_id) && Boolean(text(row?.text));
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
    const selected = rows.sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0)).slice(-60);
    const ids = selected.map(row => String(row.id || '')).filter(Boolean);
    if (!ids.length) return;
    const key = stableKey(['yarbi.historical-intelligence.v1', contactId, ...ids].join(':'));
    if (processed.has(key) || tasks.length >= limit) return;
    const outgoing = selected.filter(row => row?.metadata?.direction === 'outgoing').map(row => String(row.id));
    tasks.push({
      schema:'yarbi.historical-intelligence-task.v1',
      idempotency_key:key,
      contact_id:contactId,
      message_ids:ids,
      outgoing_message_ids:outgoing,
      purpose:'historical_contact_context_and_reply_style',
      requires_model:true,
      commercial_effects_allowed:false,
      status:'ready_for_model'
    });
  });
  return { schema:'yarbi.historical-intelligence-plan.v1', tasks, safety:{ idempotent:true, commercial_effects_allowed:false, owner_review_required_for_rules:true } };
}

module.exports = { MAX_HISTORICAL_SCOPE_CONTACTS, createHistoricalOwnerScopeResolver, planHistoricalIntelligence };
