'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyIntelligenceRoute, transitionFor } = require('../lib/yarbi-intelligence-router');
const { requestDeepAnalysis } = require('../lib/yarbi-deep-analysis');
const { runOwnerConversation, summarizePerformance } = require('../lib/yarbi-conversation-runtime');
const { createScopedAsyncCache } = require('../lib/yarbi-scoped-cache');

const NOW = Date.parse('2026-11-05T17:00:00.000Z');

test('F03 clasifica lecturas verificables como FAST, lenguaje abierto como STANDARD y análisis como DEEP', () => {
  assert.equal(classifyIntelligenceRoute({ utterance: '¿Qué tengo mañana?', now: NOW }).tier, 'FAST');
  assert.equal(classifyIntelligenceRoute({ utterance: '¿Cuánto hemos cobrado por instalaciones este mes?', now: NOW }).tier, 'FAST');
  assert.equal(classifyIntelligenceRoute({ utterance: '¿Qué pasó con Carlos?', now: NOW }).tier, 'STANDARD');
  assert.equal(classifyIntelligenceRoute({ utterance: 'Analiza la rentabilidad y el ROAS de campañas', now: NOW }).tier, 'DEEP');
  assert.deepEqual(transitionFor({ from: 'FAST', to: 'STANDARD', reason: 'facts_incomplete' }), { from: 'FAST', to: 'STANDARD', reason: 'facts_incomplete', execute: false });
});

test('F03 FAST no llama Gemini para Agenda y conserva efectos comerciales desactivados', async () => {
  let providerCalls = 0;
  const result = await runOwnerConversation({
    utterance: '¿Qué tengo mañana?', now: NOW,
    agendaEvents: [{ id: 'F03-A1', contact_id: 11, event_type: 'visita', service: 'reparacion', status: 'scheduled', starts_at: '2026-11-06T15:00:00.000Z' }],
    provider: async () => { providerCalls += 1; throw new Error('must_not_call'); }
  });
  assert.equal(result.outcome, 'fast_local_agenda');
  assert.equal(result.intelligence.route.tier, 'FAST');
  assert.equal(providerCalls, 0);
  assert.equal(result.commercial_effects_allowed, false);
});

test('F03 FAST responde el saldo o historial del contacto ya seleccionado sin llamar al proveedor', async () => {
  let providerCalls = 0;
  const state = { selected_entity: { contact_id: 11, display_name: 'Cliente sintético' } };
  const dossier = {
    contact_id: 11,
    dossier: { client_name: 'Cliente sintético' },
    finance: { summary: { pending_amount: 150 } },
    timeline: [{ id: 'agenda:8', kind: 'agenda', title: 'Visita', detail: 'agendado' }]
  };
  const debt = await runOwnerConversation({ utterance: '¿Cuánto debe?', state, dossier, provider: async () => { providerCalls += 1; } });
  assert.equal(debt.outcome, 'fast_local_contact_context');
  assert.match(debt.reply, /S\/ 150\.00/);
  const history = await runOwnerConversation({ utterance: '¿Qué pasó con este cliente?', state, dossier, provider: async () => { providerCalls += 1; } });
  assert.equal(history.outcome, 'fast_local_contact_context');
  assert.match(history.reply, /Visita/);
  assert.equal(providerCalls, 0);
  assert.equal(history.commercial_effects_allowed, false);
});

test('F03 never reads a dossier that does not match the selected contact', async () => {
  let providerCalls = 0;
  const result = await runOwnerConversation({
    utterance: '¿Cuánto debe?',
    state: { selected_entity: { contact_id: 11, display_name: 'Cliente A' } },
    dossier: { contact_id: 12, finance: { summary: { pending_amount: 150 } } },
    provider: async () => { providerCalls += 1; const error = new Error('provider should be attempted'); error.code = 'synthetic'; throw error; }
  });
  assert.equal(result.outcome, 'provider_unavailable');
  assert.equal(providerCalls, 1);
});

test('F03 STANDARD conserva contexto y no inventa datos ante fallo de Gemini', async () => {
  const state = { active_constraints: { district: { value: 'Surco' } } };
  const result = await runOwnerConversation({ utterance: '¿Qué pasó con Carlos?', state, now: NOW, provider: async () => { const error = new Error('timeout'); error.code = 'gemini_timeout'; throw error; } });
  assert.equal(result.intelligence.route.tier, 'STANDARD');
  assert.equal(result.outcome, 'provider_unavailable');
  assert.equal(result.state, state);
  assert.equal(result.proposal.execute, false);
});

test('F03 DEEP no usa memoria de proceso: sin cola durable se bloquea antes del proveedor', async () => {
  let providerCalls = 0;
  const result = await runOwnerConversation({ utterance: 'Analiza las campañas y recomienda presupuesto', ownerId: 'owner-a', deepIdempotencyKey: 'F03-DEEP-1', now: NOW, provider: async () => { providerCalls += 1; return {}; } });
  assert.equal(result.outcome, 'deep_infrastructure_unavailable');
  assert.equal(result.intelligence.route.tier, 'DEEP');
  assert.equal(result.commercial_effects_allowed, false);
  assert.equal(providerCalls, 0);
});

test('F03 DEEP admite sólo un store durable explícito y una llave idempotente', async () => {
  let received = null;
  const result = await requestDeepAnalysis({ ownerId: 'owner-a', kind: 'sales_analysis', idempotencyKey: 'F03-DEEP-2', durableStore: { enqueue: async request => { received = request; return { ok: true, job_id: 'job-synthetic-1' }; } } });
  assert.equal(result.outcome, 'deep_queued');
  assert.equal(result.accepted, true);
  assert.match(received.idempotency_key, /owner-a:sales_analysis:F03-DEEP-2/);
  const invalid = await requestDeepAnalysis({ ownerId: 'owner-a', kind: 'unknown', idempotencyKey: 'x' });
  assert.equal(invalid.outcome, 'deep_request_invalid');
});

test('F03 caché se aísla por propietario y permite invalidación por contacto', async () => {
  const cache = createScopedAsyncCache({ ttlMs: 10_000, maxEntries: 8 });
  let loads = 0;
  const read = ownerId => cache.getOrLoad({ ownerId, contactIds: [11], key: { query: 'Carlos' }, load: async () => ({ ownerId, serial: ++loads }) });
  assert.equal((await read('owner-a')).value.serial, 1);
  assert.equal((await read('owner-a')).cache, 'hit');
  assert.equal((await read('owner-b')).value.serial, 2);
  assert.ok(cache.invalidate({ contactId: 11 }) >= 2);
  assert.equal((await read('owner-a')).value.serial, 3);
});

test('F03 métricas separan tiers y no presentan Preview o Android como medidos', () => {
  const summary = summarizePerformance([
    { metrics: { intelligence_tier: 'FAST', total_ms: 8, gemini_ms: 0 } },
    { metrics: { intelligence_tier: 'STANDARD', total_ms: 30, gemini_ms: 21 } },
    { metrics: { intelligence_tier: 'DEEP', total_ms: 2, gemini_ms: 0 } }
  ]);
  assert.equal(summary.tiers.fast.samples, 1);
  assert.equal(summary.tiers.standard.samples, 1);
  assert.equal(summary.tiers.deep.samples, 1);
  assert.equal(summary.gemini.calls, 1);
  assert.equal(summary.preview_http, 'not_measured');
  assert.equal(summary.android_device, 'not_measured');
});
