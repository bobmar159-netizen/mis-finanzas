'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { runOwnerConversation, summarizePerformance } = require('../lib/yarbi-conversation-runtime');
const { createConversationToken, readConversationToken } = require('../lib/yarbi-conversation-continuity');
const { adaptV4Understanding } = require('../lib/yarbi-v4-provider');

const OWNER_A = '00000000-0000-4000-8000-0000000000a1';
const OWNER_B = '00000000-0000-4000-8000-0000000000b2';
const SECRET = 'f05-conversation-continuity-secret-not-real-1234567890';
const NOW = Date.parse('2026-11-05T17:00:00.000Z');

function v4Correction() {
  return {
    schema: 'yarbi.owner-understanding.v4', intent: 'reference_lookup', conversational_act: 'correction', target_type: 'contact',
    mentions: [
      { kind: 'proper_name', value: 'Carlos', polarity: 'negated', certainty: 'confirmed', claimed_source: 'utterance' },
      { kind: 'proper_name', value: 'Carla', polarity: 'affirmed', certainty: 'confirmed', claimed_source: 'utterance' }
    ],
    control: { correction: 'replace_previous', continuation: 'none', cancel_scope: 'none' },
    confidence: 0.92, ambiguity: false, missing_information: []
  };
}

test('F05 FAST_LOCAL responde Agenda y Finanzas verificables sin llamar al proveedor', async () => {
  let calls = 0;
  const forbiddenProvider = async () => { calls += 1; throw new Error('provider_should_not_be_called'); };
  const agenda = await runOwnerConversation({
    utterance: '¿Qué tengo mañana?', provider: forbiddenProvider, now: NOW,
    agendaEvents: [{ id: 'F05-AGENDA-1', contact_id: 17, event_type: 'visita', service: 'instalacion_nueva', status: 'scheduled', starts_at: '2026-11-06T15:00:00.000Z' }]
  });
  assert.equal(agenda.outcome, 'fast_local_agenda');
  assert.match(agenda.reply, /actividad\(es\) verificable/i);
  assert.equal(agenda.proposal.execute, false);
  assert.equal(agenda.commercial_effects_allowed, false);

  const finance = await runOwnerConversation({
    utterance: '¿Cuánto hemos cobrado por instalaciones este mes?', provider: forbiddenProvider, now: NOW,
    financeRows: [{ contact_id: 17, service: 'instalacion_nueva', collected_amount: 200, verified: true }]
  });
  assert.equal(finance.outcome, 'fast_local_finance');
  assert.match(finance.reply, /S\/ 200\.00/);
  assert.equal(finance.proposal.execute, false);
  assert.equal(calls, 0);
});

test('F05 conserva corrección V4, no promueve la mención negada y no ejecuta acciones', async () => {
  const utterance = 'No era Carlos, era Carla';
  const state = { active_constraints: { name: { value: 'Carlos' } } };
  const adapted = adaptV4Understanding({ raw: v4Correction(), utterance, state });
  assert.equal(adapted.understanding.constraints.name.value, 'Carla');
  assert.equal(Object.values(adapted.understanding.constraints).some(item => item?.value === 'Carlos'), false);
  const result = await runOwnerConversation({ utterance, state, provider: async () => adapted.understanding, now: NOW });
  assert.equal(result.commercial_effects_allowed, false);
  assert.equal(result.proposal.execute, false);
  assert.equal(result.state.active_constraints.name.value, 'Carla');
});

test('F05 continuidad es firmada, aislada por owner y no convierte ordinales en ejecución', async () => {
  const token = createConversationToken({ ownerId: OWNER_A, state: { active_constraints: { district: { value: 'Surco' } }, selected_entity: { contact_id: 72, display_name: 'No se serializa' } }, candidateIds: [71, 72], secret: SECRET, now: NOW });
  const valid = readConversationToken({ token, ownerId: OWNER_A, secret: SECRET, now: NOW + 1 });
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.candidate_ids, [71, 72]);
  assert.deepEqual(valid.state.selected_entity, { contact_id: 72 });
  assert.equal(readConversationToken({ token, ownerId: OWNER_B, secret: SECRET, now: NOW + 1 }).ok, false);
  assert.equal(readConversationToken({ token: token + 'x', ownerId: OWNER_A, secret: SECRET, now: NOW + 1 }).ok, false);
  const selected = await runOwnerConversation({ utterance: 'El segundo cliente', candidates: valid.candidate_ids, now: NOW });
  assert.equal(selected.outcome, 'continuation_selected');
  assert.equal(selected.selected_contact_id, 72);
  assert.equal(selected.proposal.execute, false);
  assert.equal(selected.commercial_effects_allowed, false);
});

test('F05 falla de proveedor sin inventar datos ni perder el estado conversacional', async () => {
  const initial = { active_constraints: { name: { value: 'Carla' } } };
  const result = await runOwnerConversation({ utterance: '¿Qué pasó con Carlos?', state: initial, provider: async () => { const error = new Error('timeout'); error.code = 'timeout'; throw error; }, now: NOW });
  assert.equal(result.outcome, 'provider_unavailable');
  assert.equal(result.state, initial);
  assert.equal(result.proposal.execute, false);
  assert.equal(result.commercial_effects_allowed, false);
  assert.doesNotMatch(result.reply, /Carlos.*pas[oó]/i);
});

test('F05 métricas separan CPU local de Preview, Android y Gemini aún no medidos', async () => {
  const summary = summarizePerformance([{ metrics: { total_ms: 3, gemini_ms: 0 } }, { metrics: { total_ms: 7, gemini_ms: 0 } }, { metrics: { total_ms: 5, gemini_ms: 0 } }]);
  assert.deepEqual(summary.local_cpu, { p50_ms: 5, p95_ms: 7 });
  assert.equal(summary.preview_http, 'not_measured');
  assert.equal(summary.android_device, 'not_measured');
});

test('chat local no intenta el cerebro remoto cuando el runtime declara modo offline', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'index.html'), 'utf8');
  const start = source.indexOf('async function gfcSendCopilotChatMessage(promptText) {');
  assert.ok(start >= 0);
  const offline = source.indexOf('const remoteEnabled = typeof window.gfcRuntimeRemoteEnabled', start);
  const remoteCommand = source.indexOf('const commandResult = await gfcTryYarbiCommand(text);', start);
  assert.ok(offline > start && remoteCommand > offline);
  assert.match(source.slice(offline, remoteCommand), /Yarbi está en modo local/);
  assert.match(source.slice(offline, remoteCommand), /no inventaré una respuesta/i);
});
