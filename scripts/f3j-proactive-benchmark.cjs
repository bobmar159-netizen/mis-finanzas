'use strict';

// Benchmark reproducible del núcleo 3J. Usa solo snapshots F3J sintéticos:
// no abre red, no persiste datos ni carga variables de entorno.
const { performance } = require('node:perf_hooks');
const { runProactiveLoop } = require('../lib/yarbi-proactive-loop');

function context(id) {
  return {
    schema: 'yarbi.unified-contact.v1', contact_id: id, found: true,
    identity: { display_name: `F3J-${id}`, phone: null },
    commercial: { status: id % 3 === 0 ? 'caliente' : 'tibio', service: 'reparacion', service_source: 'commercial_context', last_contact_at: '2026-10-30T10:00:00.000Z', last_contact_message_id: `F3J-${id}` },
    memory: { service: null, district: null, location: null, pending_step: id % 3 === 0 ? { step: 'schedule_required' } : null, visit: id % 3 === 0 ? { requested: true } : null, customer_commitment: null, business_commitment: null, objection: null },
    missing: id % 3 === 0 ? ['district', 'location'] : ['district'], diagnostics: []
  };
}

class BenchmarkStore {
  constructor(count) {
    this.rows = Array.from({ length: count }, (_, index) => ({ contact_id: index + 1, opportunity_id: `F3J-BENCH-${index + 1}` }));
    this.contexts = new Map(this.rows.map(row => [row.contact_id, context(row.contact_id)]));
    this.run = null;
    this.calls = { claim: 0, state: 0, candidates: 0, business: 0, contexts: 0, evaluation: 0, delivery: 0, complete: 0 };
  }
  async claimRun(input) { this.calls.claim += 1; this.run = { id: 1, ...input }; return { claimed: true, run_id: 1 }; }
  async completeRun() { this.calls.complete += 1; return { completed: true }; }
  async getNotificationState() { this.calls.state += 1; return { recent_fingerprints: [] }; }
  async loadCandidates() { this.calls.candidates += 1; return this.rows; }
  async loadBusinessState() { this.calls.business += 1; return { daily_goal_amount: 700, confirmed_revenue_today: null, currency: 'PEN' }; }
  async loadUnifiedContexts({ contact_ids }) { this.calls.contexts += 1; return contact_ids.map(contact_id => ({ contact_id, context: this.contexts.get(contact_id) })); }
  async persistEvaluation() { this.calls.evaluation += 1; return { recorded: true }; }
  async deliverOwnerBrief() { this.calls.delivery += 1; return { outcome: 'delivered', inbox_id: 1 }; }
}

async function measure(count) {
  const store = new BenchmarkStore(count);
  const started = performance.now();
  const result = await runProactiveLoop({
    store,
    now: '2026-10-30T15:00:00.000Z',
    policy: { candidate_limit: count, interval_ms: 15 * 60 * 1000 }
  });
  return { candidates: count, duration_ms: Number((performance.now() - started).toFixed(3)), status: result.status, evaluated: result.metrics.contexts, calls: store.calls };
}

(async () => {
  const results = [];
  for (const count of [10, 100, 500]) results.push(await measure(count));
  process.stdout.write(JSON.stringify({ schema: 'yarbi.f3j.benchmark.v1', results }, null, 2) + '\n');
})().catch(error => {
  process.stderr.write(JSON.stringify({ error: error?.code || error?.message || 'f3j_benchmark_failed' }) + '\n');
  process.exitCode = 1;
});
