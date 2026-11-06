'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getNextBestAction } = require('../lib/yarbi-next-best-action');

const NOW = '2026-10-30T15:00:00.000Z';

function context(overrides = {}) {
  const base = {
    schema: 'yarbi.unified-contact.v1', contact_id: 701, found: true,
    identity: { display_name: 'F3G Cliente', phone: '955700701' },
    commercial: { status: 'frio', service: null, service_source: null, last_contact_at: null, last_contact_message_id: null },
    memory: { service: null, district: null, location: null, pending_step: null, visit: null, customer_commitment: null, business_commitment: null, objection: null },
    missing: ['service', 'district'], diagnostics: []
  };
  return {
    ...base,
    ...overrides,
    commercial: { ...base.commercial, ...(overrides.commercial || {}) },
    memory: { ...base.memory, ...(overrides.memory || {}) }
  };
}

function decide(value, policy) { return getNextBestAction({ context: value, now: NOW, policy }); }

test('F3G proposes a high-priority location request only for a hot requested visit without location', () => {
  const result = decide(context({ commercial: { status: 'caliente', service: 'instalacion_nueva' }, memory: { visit: { requested: true } } }));
  assert.deepEqual([result.decision, result.action, result.reason, result.priority], ['propose', 'ask_for_location', 'visit_requested_without_location', 'high']);
  assert.equal(result.requires_owner_confirmation, true);
});

test('F3G does not ask location again when it is present and proposes schedule only when structured pending evidence says so', () => {
  const complete = decide(context({ commercial: { status: 'caliente', service: 'instalacion_nueva' }, memory: { visit: { requested: true }, location: { url: 'https://maps.example/F3G' } } }));
  assert.notEqual(complete.action, 'ask_for_location');
  const schedule = decide(context({ commercial: { status: 'caliente', service: 'instalacion_nueva' }, memory: { visit: { requested: true }, location: { url: 'https://maps.example/F3G' }, pending_step: { step: 'schedule_required' } } }));
  assert.equal(schedule.action, 'ask_for_schedule');
});

test('F3G proposes only the minimum missing information relevant to the commercial state', () => {
  assert.equal(decide(context()).action, 'ask_for_service');
  assert.equal(decide(context({ commercial: { status: 'tibio', service: 'reparacion' } })).action, 'ask_for_district');
  assert.equal(decide(context({ commercial: { status: 'frio', service: 'reparacion' } })).action, 'no_action');
});

test('F3G waits for customer and business commitments instead of blaming the customer', () => {
  const customer = decide(context({ memory: { customer_commitment: { kind: 'customer_will_reply', expected_at: '2026-10-31T15:00:00Z' } } }));
  assert.deepEqual([customer.decision, customer.action, customer.reason], ['wait', 'wait_for_customer', 'customer_committed_to_reply']);
  const business = decide(context({ commercial: { status: 'caliente', service: 'reparacion' }, memory: { business_commitment: { kind: 'send_quote' } } }));
  assert.deepEqual([business.decision, business.action, business.reason], ['propose', 'prepare_quote', 'business_commitment_quote_pending']);
});

test('F3G applies cooldown to a question that was recently requested', () => {
  const result = decide(context({
    commercial: { status: 'caliente', service: 'reparacion' },
    memory: { visit: { requested: true }, pending_step: { action: 'ask_for_location', requested_at: '2026-10-30T10:00:00Z' } }
  }));
  assert.deepEqual([result.decision, result.action, result.reason], ['wait', 'wait_for_customer', 'cooldown_active']);
  assert.equal(result.blocks.includes('cooldown_active'), true);
});

test('F3G respects follow-up cooldowns and the configured maximum instead of insisting', () => {
  const recent = decide(context({
    commercial: { status: 'tibio', service: 'reparacion', last_contact_at: '2026-10-30T14:00:00Z' },
    memory: { pending_step: { step: 'follow_up_due', consecutive_follow_ups: 0 } }
  }));
  assert.deepEqual([recent.decision, recent.reason], ['wait', 'follow_up_cooldown_active']);
  const limited = decide(context({
    commercial: { status: 'tibio', service: 'reparacion', last_contact_at: '2026-10-20T14:00:00Z' },
    memory: { pending_step: { step: 'follow_up_due', consecutive_follow_ups: 2 } }
  }));
  assert.deepEqual([limited.decision, limited.reason], ['no_action', 'follow_up_limit_reached']);
});

test('F3G chooses no_action for a complete contact and never revives resolved or superseded memory', () => {
  const complete = decide(context({
    commercial: { status: 'caliente', service: 'reparacion' },
    memory: { district: { district: 'Comas' }, location: { url: 'https://maps.example/F3G-complete' } }
  }));
  assert.deepEqual([complete.decision, complete.action, complete.reason], ['no_action', 'no_action', 'not_needed_yet']);
  const noActiveHistoricalMemory = decide(context({ commercial: { status: 'frio', service: 'reparacion' }, memory: {} }));
  assert.equal(noActiveHistoricalMemory.action, 'no_action');
});

test('F3G is deterministic, conflict-safe, and does not make hot equal send', () => {
  const conflict = context({ commercial: { status: 'caliente', service: null }, diagnostics: [{ code: 'context_conflict', field: 'service' }] });
  const reviewed = decide(conflict);
  assert.deepEqual([reviewed.decision, reviewed.action, reviewed.reason], ['needs_review', 'review_context_conflict', 'context_conflict']);
  const hot = context({ commercial: { status: 'caliente', service: 'reparacion' } });
  const first = decide(hot), second = decide(hot);
  assert.deepEqual(first, second);
  assert.notEqual(first.action, 'send_message');
});

test('F3G uses only the supplied contact context and cannot mutate it or use external services', () => {
  const first = context({ contact_id: 701, commercial: { status: 'caliente', service: 'reparacion' }, memory: { district: { district: 'Comas' } } });
  const second = context({ contact_id: 702, commercial: { status: 'tibio', service: 'punto_adicional' }, memory: { district: { district: 'Ate' } } });
  const before = JSON.stringify(first);
  const one = decide(first), two = decide(second);
  assert.equal(JSON.stringify(first), before);
  assert.equal(one.contact_id, 701);
  assert.equal(two.contact_id, 702);
  assert.equal(typeof global.fetch, 'function');
  assert.equal(/gemini|whatsapp|agenda|calendar|notion/i.test(require('node:fs').readFileSync(require.resolve('../lib/yarbi-next-best-action'), 'utf8')), false);
});

test('F3G reports invalid time or context conservatively without throwing', () => {
  const invalidTime = getNextBestAction({ context: context(), now: 'not-a-time' });
  assert.equal(invalidTime.decision, 'needs_review');
  const invalidContext = getNextBestAction({ context: {}, now: NOW });
  assert.equal(invalidContext.reason, 'unified_context_invalid');
});
