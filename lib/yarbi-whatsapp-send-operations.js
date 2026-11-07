'use strict';

// Stores are intentionally small.  The production implementation relies on
// the proposed transactional RPC; the in-memory version exists only for local
// deterministic tests and is never selected by a deployed handler.
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function stateOf(value) { return String(value || '').trim().toLowerCase(); }

function createMemoryWhatsAppSendOperationStore() {
  const rows = new Map();
  return {
    async request(row) {
      const current = rows.get(row.operation_id);
      if (current) return { ok: true, outcome: 'existing', operation: clone(current) };
      const operation = { ...row, status: 'requested', provider_message_id: null, created_at: new Date().toISOString() };
      rows.set(operation.operation_id, operation);
      return { ok: true, outcome: 'requested', operation: clone(operation) };
    },
    async claim({ operationId, ownerId, provider, recipientFingerprint, contentFingerprint, authorizationFingerprint, now = Date.now() }) {
      const operation = rows.get(operationId);
      if (!operation) return { ok: false, code: 'whatsapp_send_operation_not_found' };
      if (operation.status !== 'requested') return { ok: false, code: 'whatsapp_send_operation_replayed' };
      if (Date.parse(operation.expires_at) < Number(now)) return { ok: false, code: 'whatsapp_send_operation_expired' };
      if (operation.owner_account_id !== ownerId || operation.provider !== provider || operation.recipient_fingerprint !== recipientFingerprint || operation.content_fingerprint !== contentFingerprint || operation.authorization_fingerprint !== authorizationFingerprint) return { ok: false, code: 'whatsapp_send_operation_binding_mismatch' };
      operation.status = 'sending'; operation.claimed_at = new Date(Number(now)).toISOString();
      return { ok: true, outcome: 'claimed', operation: clone(operation) };
    },
    async accepted({ operationId, providerMessageId, now = Date.now() }) {
      const operation = rows.get(operationId);
      if (!operation || operation.status !== 'sending') return { ok: false, code: 'whatsapp_send_operation_state_invalid' };
      operation.status = 'provider_accepted'; operation.provider_message_id = String(providerMessageId); operation.accepted_at = new Date(Number(now)).toISOString();
      return { ok: true, operation: clone(operation) };
    },
    async uncertain({ operationId, now = Date.now() }) {
      const operation = rows.get(operationId);
      if (!operation || operation.status !== 'sending') return { ok: false, code: 'whatsapp_send_operation_state_invalid' };
      operation.status = 'provider_outcome_unknown'; operation.failed_at = new Date(Number(now)).toISOString();
      return { ok: true, operation: clone(operation) };
    },
    async delivery({ provider, providerMessageId, status, now = Date.now() }) {
      const operation = [...rows.values()].find(row => row.provider === provider && row.provider_message_id === providerMessageId);
      if (!operation) return { ok: false, code: 'whatsapp_send_operation_not_found' };
      const current = stateOf(operation.status); const next = stateOf(status);
      if (!((current === 'provider_accepted' && ['delivered', 'read', 'failed'].includes(next)) || (current === 'delivered' && next === 'read'))) return { ok: false, code: 'whatsapp_delivery_transition_invalid' };
      operation.status = next; operation[`${next}_at`] = new Date(Number(now)).toISOString();
      return { ok: true, operation: clone(operation) };
    },
    rows: () => [...rows.values()].map(clone)
  };
}

function createSupabaseWhatsAppSendOperationStore({ supabaseUrl, supabaseKey, fetchImpl = fetch } = {}) {
  const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' };
  const json = async response => ({ response, data: await response.json().catch(() => []) });
  return {
    async request(row) {
      const result = await json(await fetchImpl(`${supabaseUrl}/rest/v1/yarbi_whatsapp_send_operations`, { method: 'POST', headers: { ...headers, Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify([row]) }));
      if (!result.response.ok) return { ok: false, code: 'whatsapp_send_operation_store_unavailable' };
      return { ok: true, outcome: Array.isArray(result.data) && result.data.length ? 'requested' : 'existing', operation: Array.isArray(result.data) ? result.data[0] || null : null };
    },
    async claim(input) {
      const result = await json(await fetchImpl(`${supabaseUrl}/rest/v1/rpc/claim_yarbi_whatsapp_send_operation`, { method: 'POST', headers, body: JSON.stringify({ p_operation_id: input.operationId, p_owner_account_id: input.ownerId, p_provider: input.provider, p_recipient_fingerprint: input.recipientFingerprint, p_content_fingerprint: input.contentFingerprint, p_authorization_fingerprint: input.authorizationFingerprint }) }));
      const operation = Array.isArray(result.data) ? result.data[0] : result.data;
      return result.response.ok && operation ? { ok: true, outcome: 'claimed', operation } : { ok: false, code: result.response.status === 409 ? 'whatsapp_send_operation_replayed' : 'whatsapp_send_operation_claim_failed' };
    },
    async accepted({ operationId, providerMessageId }) {
      const result = await json(await fetchImpl(`${supabaseUrl}/rest/v1/yarbi_whatsapp_send_operations?operation_id=eq.${encodeURIComponent(operationId)}&status=eq.sending`, { method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify({ status: 'provider_accepted', provider_message_id: providerMessageId, accepted_at: new Date().toISOString() }) }));
      return result.response.ok && Array.isArray(result.data) && result.data.length ? { ok: true, operation: result.data[0] } : { ok: false, code: 'whatsapp_send_operation_accept_failed' };
    },
    async uncertain({ operationId }) {
      const result = await json(await fetchImpl(`${supabaseUrl}/rest/v1/yarbi_whatsapp_send_operations?operation_id=eq.${encodeURIComponent(operationId)}&status=eq.sending`, { method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify({ status: 'provider_outcome_unknown', failed_at: new Date().toISOString() }) }));
      return result.response.ok ? { ok: true } : { ok: false, code: 'whatsapp_send_operation_uncertain_record_failed' };
    },
    async delivery({ provider, providerMessageId, status }) {
      const field = status === 'read' ? 'read_at' : status === 'delivered' ? 'delivered_at' : 'failed_at';
      const result = await json(await fetchImpl(`${supabaseUrl}/rest/v1/yarbi_whatsapp_send_operations?provider=eq.${encodeURIComponent(provider)}&provider_message_id=eq.${encodeURIComponent(providerMessageId)}&status=in.(provider_accepted,delivered)`, { method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify({ status, [field]: new Date().toISOString() }) }));
      return result.response.ok ? { ok: true, operation: Array.isArray(result.data) ? result.data[0] || null : null } : { ok: false, code: 'whatsapp_delivery_store_failed' };
    }
  };
}

module.exports = { createMemoryWhatsAppSendOperationStore, createSupabaseWhatsAppSendOperationStore };
