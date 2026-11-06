const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractCommercialEvidence,
  updateCommercialContext
} = require('../lib/yarbi-commercial-context');
const {
  adaptCommercialEvidence,
  createVerifiedOperatorEvidenceEvent,
  createVerifiedWebhookEvidenceEvent
} = require('../lib/yarbi-commercial-evidence');

function operatorEvidence({ eventId, messageId, service, visitRequested = false }) {
  return adaptCommercialEvidence(createVerifiedOperatorEvidenceEvent({
    operatorVerified: true, eventId, messageId, occurredAt: 1761801000, service, visitRequested
  })).evidence;
}

test('F3B accepts only a declared structured service category', () => {
  const evidence = extractCommercialEvidence({
    id: 'F3B-structured', timestamp: 1761801000,
    metadata: { commercial_context: operatorEvidence({ eventId: 'F3B-event-structured', messageId: 'F3B-structured', service: 'punto_adicional' }) }
  });
  assert.deepEqual(evidence, {
    message_id: 'F3B-structured', occurred_at: '2025-10-30T05:10:00.000Z',
    service: 'punto_adicional', visit_requested: false,
    origin: 'operator_verified', reason: 'structured_service_request', event_id: 'F3B-event-structured'
  });
});

test('F3B rejects ambiguous text and unsupported service categories', () => {
  assert.equal(extractCommercialEvidence({
    id: 'F3B-ambiguous', timestamp: 1761801000,
    text: 'Necesito algo de gas', metadata: {}
  }), null);
  assert.equal(extractCommercialEvidence({
    id: 'F3B-invalid-service', timestamp: 1761801000,
    metadata: { commercial_context: {
      schema: 'yarbi.commercial.v1', origin: 'operator_verified', service: 'servicio_inventado'
    } }
  }), null);
});

test('F3B sends an explicit deterministic payload and returns the database outcome', async () => {
  let captured = null;
  const result = await updateCommercialContext({
    contactId: 44,
    message: {
      id: 'F3B-update', timestamp: 1761801000,
      metadata: { commercial_context: adaptCommercialEvidence(createVerifiedWebhookEvidenceEvent({
        providerVerified: true, eventId: 'F3B-event-update', messageId: 'F3B-update', occurredAt: 1761801000,
        interactive: { type: 'button_reply', selection_id: 'yarbi.commercial.v1.service.reparacion' }
      })).evidence }
    },
    supabase: async (route, init) => {
      captured = { route, body: JSON.parse(init.body) };
      return { response: { ok: true }, data: [{ outcome: 'status_changed', previous_status: 'frio', current_status: 'caliente', previous_service: null, current_service: 'reparacion', last_contact_at: '2025-10-30T10:30:00.000Z' }] };
    }
  });
  assert.equal(captured.route, '/rest/v1/rpc/update_yarbi_commercial_context');
  assert.deepEqual(captured.body, {
    p_contact_id: 44, p_message_id: 'F3B-update', p_occurred_at: '2025-10-30T05:10:00.000Z',
    p_service: 'reparacion', p_visit_requested: false,
    p_source: 'interactive_service_selection', p_reason: 'structured_service_request'
  });
  assert.equal(result.outcome, 'status_changed');
});

test('F3B surfaces a failed commercial context RPC rather than reporting a false update', async () => {
  await assert.rejects(() => updateCommercialContext({
    contactId: 44,
    message: { id: 'F3B-failure', timestamp: 1761801000, metadata: {} },
    supabase: async () => ({ response: { ok: false }, data: [] })
  }), error => error.code === 'commercial_context_update_failed');
});
