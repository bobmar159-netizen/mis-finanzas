'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runOwnerConversation } = require('../lib/yarbi-conversation-runtime');
const { adaptV4Understanding } = require('../lib/yarbi-v4-provider');

const NOW = Date.parse('2026-11-05T17:00:00.000Z');
const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'f05-semantic-acceptance.json'), 'utf8'));

function correctionV4() { return {
  schema: 'yarbi.owner-understanding.v4', intent: 'reference_lookup', conversational_act: 'correction', target_type: 'contact',
  mentions: [
    { kind: 'proper_name', value: 'Carlos', polarity: 'negated', certainty: 'confirmed', claimed_source: 'utterance' },
    { kind: 'proper_name', value: 'Carla', polarity: 'affirmed', certainty: 'confirmed', claimed_source: 'utterance' }
  ], control: { correction: 'replace_previous', continuation: 'none', cancel_scope: 'none' }, confidence: 0.92, ambiguity: false, missing_information: []
}; }

test('F05 batería independiente: 10 casos sintéticos preservan lectura, negación y ausencia de efectos comerciales', async () => {
  assert.equal(fixtures.length, 10);
  const results = [];
  for (const fixture of fixtures) {
    let result;
    if (fixture.kind === 'agenda_day') {
      result = await runOwnerConversation({ utterance: fixture.utterance, now: NOW, agendaEvents: [{ id: fixture.id, contact_id: 1, event_type: 'visita', service: 'instalacion_nueva', status: 'scheduled', starts_at: '2026-11-06T15:00:00.000Z' }] });
      assert.equal(result.outcome, 'fast_local_agenda');
    } else if (fixture.kind === 'agenda_follow_up' || fixture.kind === 'agenda_pending') {
      result = await runOwnerConversation({ utterance: fixture.utterance, now: NOW, agendaEvents: [{ id: fixture.id, contact_id: 1, event_type: 'seguimiento', service: 'reparacion', status: 'pending', starts_at: '2026-11-01T15:00:00.000Z' }] });
      assert.equal(result.outcome, 'fast_local_agenda');
    } else if (fixture.kind === 'finance') {
      result = await runOwnerConversation({ utterance: fixture.utterance, now: NOW, financeRows: [{ contact_id: 1, service: 'instalacion_nueva', collected_amount: 200, verified: true }] });
      assert.equal(result.outcome, 'fast_local_finance');
    } else if (fixture.kind === 'v4_correction') {
      const adapted = adaptV4Understanding({ raw: correctionV4(), utterance: fixture.utterance, state: { active_constraints: { name: { value: 'Carlos' } } } });
      result = await runOwnerConversation({ utterance: fixture.utterance, now: NOW, state: { active_constraints: { name: { value: 'Carlos' } } }, provider: async () => adapted.understanding });
      assert.equal(result.state.active_constraints.name.value, 'Carla');
      assert.equal(Object.values(result.understanding.constraints).some(value => value?.value === 'Carlos'), false);
    } else if (fixture.kind === 'ordinal_continuation') {
      result = await runOwnerConversation({ utterance: fixture.utterance, now: NOW, candidates: [11, 12] });
      assert.equal(result.selected_contact_id, 12);
    } else {
      result = await runOwnerConversation({ utterance: fixture.utterance, now: NOW, provider: async () => { const error = new Error('synthetic_provider_unavailable'); error.code = 'synthetic_provider_unavailable'; throw error; } });
      assert.equal(result.outcome, 'provider_unavailable');
    }
    assert.equal(result.proposal.execute, false, fixture.id);
    assert.equal(result.commercial_effects_allowed, false, fixture.id);
    results.push({ id: fixture.id, outcome: result.outcome });
  }
  assert.equal(results.length, 10);
  assert.equal(results.filter(result => result.outcome === 'provider_unavailable').length, 4);
});
