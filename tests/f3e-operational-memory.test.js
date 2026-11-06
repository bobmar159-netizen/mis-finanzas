'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adaptCommercialEvidence, createVerifiedOperatorEvidenceEvent } = require('../lib/yarbi-commercial-evidence');
const {
  createVerifiedOperatorMemoryResolution,
  createVerifiedOperatorOperationalFact,
  deriveOperationalFactsFromCommercialEvidence,
  getContactOperationalMemory,
  resolveOperationalMemory,
  upsertOperationalMemory
} = require('../lib/yarbi-operational-memory');

function commercialMessage({ id = 'F3E-message-1', eventId = 'F3E-event-1', service = 'punto_adicional', visitRequested = false, occurredAt = 1761801000 } = {}) {
  return {
    id,
    timestamp: occurredAt,
    metadata: {
      commercial_context: adaptCommercialEvidence(createVerifiedOperatorEvidenceEvent({
        operatorVerified: true, eventId, messageId: id, occurredAt, service, visitRequested
      })).evidence
    }
  };
}

test('F3E derives only compact facts from validated structured commercial evidence', () => {
  const facts = deriveOperationalFactsFromCommercialEvidence(commercialMessage({ visitRequested: true }));
  assert.deepEqual(facts.map(fact => [fact.memory_type, fact.value]), [
    ['service', { service: 'punto_adicional' }],
    ['visit', { requested: true }],
    ['pending_step', { step: 'visit_requested' }]
  ]);
  assert.equal(deriveOperationalFactsFromCommercialEvidence({ id: 'F3E-free-text', text: 'quiero una visita', metadata: {} }).length, 0);
});

test('F3E sends a deterministic trusted fact to the atomic store and reports replay/stale outcomes', async () => {
  const fact = createVerifiedOperatorOperationalFact({
    operatorVerified: true, memoryType: 'district', value: { district: 'Comas' },
    eventId: 'F3E-event-district-1', messageId: 'F3E-message-district-1', occurredAt: '2026-10-30T10:00:00.000Z'
  });
  const calls = [];
  const supabase = async (_path, init) => {
    calls.push(JSON.parse(init.body));
    return { response: { ok: true }, data: [{ outcome: calls.length === 1 ? 'created' : (calls.length === 2 ? 'duplicate_event' : 'stale_recorded'), memory_id: calls.length, state: calls.length === 3 ? 'superseded' : 'active' }] };
  };
  assert.equal((await upsertOperationalMemory({ supabase, contactId: 81, fact })).outcome, 'created');
  assert.equal((await upsertOperationalMemory({ supabase, contactId: 81, fact })).outcome, 'duplicate_event');
  assert.equal(calls[0].p_memory_type, 'district');
  assert.equal(calls[0].p_value.district, 'Comas');
  await assert.rejects(() => upsertOperationalMemory({
    supabase,
    contactId: 81,
    fact: {
      source: fact.source,
      memory_type: fact.memory_type,
      memory_key: fact.memory_key,
      value: fact.value,
      source_message_id: fact.source_message_id,
      source_event_id: fact.source_event_id,
      occurred_at: fact.occurred_at
    }
  }), error => error.code === 'operational_memory_fact_untrusted');
});

test('F3E retrieves an empty compact context, maps active facts and resolves a pending step', async () => {
  const empty = await getContactOperationalMemory({ supabase: async () => ({ response: { ok: true }, data: [] }), contactId: 82 });
  assert.deepEqual(empty, {
    contact_id: 82, service: null, district: null, location: null, pending_step: null,
    visit: null, customer_commitment: null, business_commitment: null, objection: null
  });
  const context = await getContactOperationalMemory({
    contactId: 82,
    supabase: async () => ({ response: { ok: true }, data: [
      { memory_type: 'pending_step', memory_key: 'current', value: { step: 'waiting_for_location' }, occurred_at: '2026-10-30T12:00:00Z' },
      { memory_type: 'service', memory_key: 'current', value: { service: 'reparacion' }, occurred_at: '2026-10-30T11:00:00Z' }
    ] })
  });
  assert.deepEqual(context.pending_step, { step: 'waiting_for_location' });
  assert.deepEqual(context.service, { service: 'reparacion' });

  const resolution = createVerifiedOperatorMemoryResolution({
    operatorVerified: true, memoryType: 'pending_step', eventId: 'F3E-event-resolution',
    messageId: 'F3E-message-resolution', occurredAt: '2026-10-30T13:00:00Z'
  });
  let body = null;
  const result = await resolveOperationalMemory({
    contactId: 82, resolution,
    supabase: async (_path, init) => { body = JSON.parse(init.body); return { response: { ok: true }, data: [{ outcome: 'resolved', memory_id: 9, state: 'resolved' }] }; }
  });
  assert.equal(result.outcome, 'resolved');
  assert.equal(body.p_source_event_id, 'F3E-event-resolution');
});

test('F3E accepts no raw or ambiguous values as operational facts', () => {
  assert.equal(createVerifiedOperatorOperationalFact({ operatorVerified: false, memoryType: 'district', value: { district: 'Comas' }, eventId: 'F3E-nope', occurredAt: Date.now() }), null);
  assert.equal(createVerifiedOperatorOperationalFact({ operatorVerified: true, memoryType: 'district', value: 'Comas', eventId: 'F3E-nope', occurredAt: Date.now() }), null);
  assert.equal(createVerifiedOperatorMemoryResolution({ operatorVerified: true, memoryType: 'not-a-memory', eventId: 'F3E-nope', occurredAt: Date.now() }), null);
});
