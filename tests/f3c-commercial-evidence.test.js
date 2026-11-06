'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  adaptCommercialEvidence,
  createVerifiedOperatorEvidenceEvent,
  createVerifiedWebhookEvidenceEvent
} = require('../lib/yarbi-commercial-evidence');
const { extractCommercialEvidence, updateCommercialContext } = require('../lib/yarbi-commercial-context');

const time = '2026-10-30T15:00:00.000Z';

test('F3C accepts an allowlisted interactive button service and produces the exact v1 contract', () => {
  const event = createVerifiedWebhookEvidenceEvent({
    providerVerified: true, eventId: 'F3C-button-001', messageId: 'F3C-message-001', occurredAt: time,
    interactive: { type: 'button_reply', selection_id: 'yarbi.commercial.v1.service.modificacion_tuberia' }
  });
  const result = adaptCommercialEvidence(event);
  assert.equal(result.outcome, 'accepted');
  assert.deepEqual(result.evidence, {
    schema: 'yarbi.commercial.v1', adapter: 'yarbi-commercial-evidence.v1',
    origin: 'interactive_service_selection', service: 'modificacion_tuberia',
    visit_requested: false, event_id: 'F3C-button-001', occurred_at: time
  });
  assert.equal(extractCommercialEvidence({ id: 'F3C-message-001', timestamp: time, metadata: { commercial_context: result.evidence } }).service, 'modificacion_tuberia');
});

test('F3C accepts a structured visit selection and leaves promotion to 3B', async () => {
  const result = adaptCommercialEvidence(createVerifiedWebhookEvidenceEvent({
    providerVerified: true, eventId: 'F3C-visit-001', messageId: 'F3C-message-visit', occurredAt: time,
    interactive: { type: 'list_reply', selection_id: 'yarbi.commercial.v1.visit.requested' }
  }));
  let payload;
  const updated = await updateCommercialContext({
    contactId: 10,
    message: { id: 'F3C-message-visit', timestamp: time, metadata: { commercial_context: result.evidence } },
    supabase: async (_route, init) => {
      payload = JSON.parse(init.body);
      return { response: { ok: true }, data: [{ outcome: 'status_changed' }] };
    }
  });
  assert.equal(payload.p_visit_requested, true);
  assert.equal(payload.p_service, null);
  assert.equal(updated.outcome, 'status_changed');
});

test('F3C duplicate source event is deterministic and carries the same idempotency key', () => {
  const input = {
    providerVerified: true, eventId: 'F3C-duplicate-001', messageId: 'F3C-message-duplicate', occurredAt: time,
    interactive: { type: 'button_reply', selection_id: 'yarbi.commercial.v1.service.reparacion' }
  };
  const first = adaptCommercialEvidence(createVerifiedWebhookEvidenceEvent(input));
  const second = adaptCommercialEvidence(createVerifiedWebhookEvidenceEvent(input));
  assert.deepEqual(second.evidence, first.evidence);
  assert.equal(first.evidence.event_id, 'F3C-duplicate-001');
});

test('F3C rejects incomplete, untrusted and manipulated metadata without classifying free text', () => {
  assert.equal(adaptCommercialEvidence(createVerifiedWebhookEvidenceEvent({
    providerVerified: true, eventId: 'F3C-bad', messageId: 'F3C-bad-message', occurredAt: time,
    interactive: { type: 'button_reply', selection_id: 'not-allowlisted' }
  })).outcome, 'unsupported');
  assert.deepEqual(adaptCommercialEvidence({
    providerVerified: true, origin: 'interactive_service_selection', service: 'instalacion_nueva'
  }).outcome, 'ignored');
  assert.equal(extractCommercialEvidence({
    id: 'F3C-free-text', timestamp: time, text: 'quiero instalación y visita',
    metadata: { commercial_context: {
      schema: 'yarbi.commercial.v1', origin: 'interactive_service_selection',
      service: 'instalacion_nueva', visit_requested: true
    } }
  }), null);
});

test('F3C supports only a verified operator action and preserves unknown when visit is the only evidence', () => {
  const result = adaptCommercialEvidence(createVerifiedOperatorEvidenceEvent({
    operatorVerified: true, eventId: 'F3C-operator-001', messageId: 'F3C-operator-message', occurredAt: time,
    visitRequested: true
  }));
  assert.equal(result.outcome, 'accepted');
  assert.equal(result.evidence.origin, 'operator_verified');
  assert.equal(result.evidence.service, 'unknown');
  assert.equal(result.evidence.visit_requested, true);
});
