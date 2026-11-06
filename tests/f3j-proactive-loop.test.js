'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runProactiveLoop } = require('../lib/yarbi-proactive-loop');

const NOW = '2026-10-30T15:00:00.000Z';

function context(id, overrides = {}) {
  return {
    schema: 'yarbi.unified-contact.v1', contact_id: id, found: true,
    identity: { display_name: `F3J ${id}`, phone: `95500${id}` },
    commercial: { status: 'caliente', service: 'reparacion', service_source: 'commercial_context', last_contact_at: '2026-10-30T10:00:00Z', last_contact_message_id: `F3J-MSG-${id}` },
    memory: { service: null, district: null, location: null, pending_step: null, visit: { requested: true }, customer_commitment: null, business_commitment: null, objection: null },
    missing: ['district', 'location'], diagnostics: [], ...overrides,
    commercial: { status: 'caliente', service: 'reparacion', service_source: 'commercial_context', last_contact_at: '2026-10-30T10:00:00Z', last_contact_message_id: `F3J-MSG-${id}`, ...(overrides.commercial || {}) },
    memory: { service: null, district: null, location: null, pending_step: null, visit: { requested: true }, customer_commitment: null, business_commitment: null, objection: null, ...(overrides.memory || {}) }
  };
}

class SyntheticStore {
  constructor({ candidates = [{ contact_id: 1, opportunity_id: 'F3J-1', scheduled_visit_at: '2026-10-30T16:00:00Z' }], contexts = new Map(), businessState = {}, state = {}, failContexts = new Set() } = {}) {
    this.candidates = candidates; this.contexts = contexts; this.businessState = businessState; this.state = { recent_fingerprints: [], ...state };
    this.failContexts = failContexts; this.runs = new Map(); this.inbox = new Map(); this.calls = []; this.evaluations = [];
  }
  async claimRun(input) { this.calls.push(['claim', input]); if (this.runs.has(input.run_key)) return { claimed: false, run_id: this.runs.get(input.run_key).id }; const row = { id: this.runs.size + 1, ...input }; this.runs.set(input.run_key, row); return { claimed: true, run_id: row.id }; }
  async completeRun(input) { this.calls.push(['complete', input]); const row = [...this.runs.values()].find(run => run.id === input.run_id); Object.assign(row, input); return { completed: true }; }
  async getNotificationState() { this.calls.push(['state']); return JSON.parse(JSON.stringify(this.state)); }
  async loadCandidates(input) { this.calls.push(['candidates', input]); return this.candidates; }
  async loadBusinessState() { this.calls.push(['business']); return this.businessState; }
  async loadUnifiedContexts({ contact_ids }) { this.calls.push(['contexts', contact_ids]); return contact_ids.map(contact_id => this.failContexts.has(contact_id) ? { contact_id, error: Object.assign(new Error('F3J-context-failure'), { code: 'F3J_CONTEXT_FAILURE' }) } : { contact_id, context: this.contexts.get(contact_id) }); }
  async persistEvaluation(input) { this.calls.push(['evaluation', input]); this.evaluations.push(input); this.state.next_review_at = input.next_review_at; return { recorded: true }; }
  async deliverOwnerBrief(input) { this.calls.push(['delivery', input]); const key = input.brief.notification_fingerprint; if (this.inbox.has(key)) return { outcome: 'duplicate_recent_notification', inbox_id: this.inbox.get(key).id }; const row = { id: this.inbox.size + 1, fingerprint: key, urgency: input.brief.urgency, mode: input.brief.notification_mode, payload: input.brief.items }; this.inbox.set(key, row); this.state.last_notified_at = input.now; this.state.last_fingerprint = key; this.state.recent_fingerprints = [{ fingerprint: key, notified_at: input.now }]; return { outcome: 'delivered', inbox_id: row.id }; }
}

function storeFor(options = {}) {
  const contexts = options.contexts || new Map([[1, context(1)]]);
  return new SyntheticStore({ ...options, contexts });
}
function run(store, extra = {}) { return runProactiveLoop({ store, now: NOW, policy: { interval_ms: 15 * 60 * 1000, ...extra.policy }, ...extra }); }

test('F3J claims exactly one effective run when two workers share the same scheduler window', async () => {
  const store = storeFor();
  const [one, two] = await Promise.all([run(store), run(store)]);
  assert.deepEqual([one.status, two.status].sort(), ['completed', 'duplicate_run']);
  assert.equal(store.runs.size, 1);
  assert.equal(store.inbox.size, 1);
});

test('F3J exits safely with no candidates and no inbox delivery', async () => {
  const store = storeFor({ candidates: [] });
  const result = await run(store);
  assert.deepEqual([result.status, result.reason, store.inbox.size], ['no_candidates', 'no_candidates', 0]);
});

test('F3J preserves no-notification and defer results without visible inbox delivery', async () => {
  const quiet = storeFor({ contexts: new Map([[1, context(1, { commercial: { status: 'frio', service: 'reparacion' }, memory: { visit: null } })]]) });
  const quietResult = await run(quiet);
  assert.equal(quietResult.brief.decision, 'no_notification');
  assert.equal(quiet.inbox.size, 0);
  const deferred = storeFor({ contexts: new Map([[1, context(1, { memory: { customer_commitment: { kind: 'customer_will_reply', expected_at: '2026-10-31T15:00:00Z' } } })]]) });
  const deferredResult = await run(deferred);
  assert.equal(deferredResult.brief.decision, 'no_notification');
  assert.equal(deferred.inbox.size, 0);
});

test('F3J delivers notify briefs once, escalates urgent briefs, and keeps authorization only as data', async () => {
  const notifyStore = storeFor({ candidates: [{ contact_id: 1, opportunity_id: 'F3J-notify' }], contexts: new Map([[1, context(1, { memory: { visit: null }, commercial: { status: 'caliente', service: null } })]]) });
  const notified = await run(notifyStore);
  assert.deepEqual([notified.status, notified.delivery.outcome, notifyStore.inbox.size], ['completed', 'delivered', 1]);
  assert.equal(notified.brief.items.some(item => item.requires_authorization), true);
  const urgentStore = storeFor();
  const escalated = await run(urgentStore);
  assert.deepEqual([escalated.brief.decision, escalated.brief.notification_mode, escalated.delivery.outcome], ['escalate', 'interrupt', 'delivered']);
});

test('F3J keeps a delivery fingerprint idempotent and allows a materially new brief in a later window', async () => {
  const store = storeFor();
  const first = await run(store);
  store.state.next_review_at = null;
  const same = await run(store, { now: '2026-10-30T15:15:00.000Z' });
  assert.equal(same.delivery, null);
  assert.equal(store.inbox.size, 1);
  store.state.next_review_at = null;
  store.contexts.set(1, context(1, { memory: { visit: { requested: true }, location: { url: 'https://maps.example/F3J' }, pending_step: { step: 'schedule_required' } } }));
  const changed = await run(store, { now: '2026-10-30T17:15:00.000Z', policy: { owner_proactive_policy: { urgent_bypass_cooldown: true } } });
  assert.notEqual(changed.brief.notification_fingerprint, first.brief.notification_fingerprint);
  assert.equal(store.inbox.size, 2);
});

test('F3J returns not_due_yet before loading candidates and never schedules a past review', async () => {
  const store = storeFor({ state: { next_review_at: '2026-10-30T16:00:00.000Z' } });
  const result = await run(store);
  assert.equal(result.status, 'not_due_yet');
  assert.equal(store.calls.some(call => call[0] === 'candidates'), false);
  const overdue = storeFor({ state: { next_review_at: '2026-10-30T14:00:00.000Z' } });
  const evaluated = await run(overdue);
  assert.ok(new Date(evaluated.next_review_at) > new Date(NOW));
});

test('F3J records per-contact errors, continues safe contacts, and handles critical delivery failure without duplicate inbox', async () => {
  const store = storeFor({ candidates: [{ contact_id: 1, opportunity_id: 'F3J-good' }, { contact_id: 2, opportunity_id: 'F3J-bad' }], contexts: new Map([[1, context(1)], [2, context(2)]]), failContexts: new Set([2]) });
  const result = await run(store);
  assert.equal(result.errors.some(error => error.contact_id === 2 && error.code === 'F3J_CONTEXT_FAILURE'), true);
  assert.equal(result.delivery.outcome, 'delivered');
  const failureStore = storeFor();
  const failed = await run(failureStore, { deliveryAdapter: { deliver: async () => { throw Object.assign(new Error('delivery'), { code: 'F3J_DELIVERY_FAILURE' }); } } });
  assert.deepEqual([failed.status, failed.delivery.status, failureStore.inbox.size], ['failed', 'failed', 0]);
});

test('F3J treats rejected evaluation persistence as critical and never delivers an uncertain brief', async () => {
  const store = storeFor();
  store.persistEvaluation = async () => ({ recorded: false });
  const result = await run(store);
  assert.equal(result.status, 'failed');
  assert.equal(store.inbox.size, 0);
  assert.equal(result.errors[0].stage, 'critical');
});

test('F3J keeps revenue unknown, configuration explicit, and has no external or commercial side effects', async () => {
  const store = storeFor({ businessState: { daily_goal_amount: 900, confirmed_revenue_today: null, currency: 'PEN' } });
  const result = await run(store, { policy: { daily_goal_amount: 700 } });
  assert.deepEqual([result.brief.business_snapshot.daily_goal, result.brief.business_snapshot.confirmed_today], [900, null]);
  const source = require('node:fs').readFileSync(require.resolve('../lib/yarbi-proactive-loop'), 'utf8');
  assert.equal(/fetch\s*\(|whatsapp|gemini|agenda|calendar|notion|maps/i.test(source), false);
});
