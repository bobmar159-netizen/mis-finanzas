'use strict';

// Mediciones locales deterministas. No conectan a Vercel, Supabase ni Gemini.
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { classifyOwnerPersonalInbound } = require('../lib/yarbi-owner-personal-identity');
const { processOwnerPersonalTurn } = require('../lib/yarbi-owner-personal-conversation');
const { resolveCandidateReference } = require('../lib/yarbi-candidate-resolver');
const { buildOwnerInstructionRequest } = require('../lib/yarbi-owner-personal-conversation');

const secret = 'P05-performance-synthetic-only-secret-123456';
const identities = [{ phone: '+51999000011', owner_key: 'primary' }, { phone: '+51999000012', owner_key: 'primary' }];
const classificationInput = { destinationPhone: '+51999000001', senderPhone: '+51999000011', personalDestinationPhone: '+51999000001', authorizedIdentities: identities, hmacSecret: secret };
const candidates = Array.from({ length: 8 }, (_, index) => ({ contact_id: index + 1, display_name: `ENTITY_${index + 1}`, district: index % 2 ? 'DISTRICT_A' : 'DISTRICT_B', service: index % 2 ? 'reparacion' : 'instalacion_nueva', phones: [`9550000${index}`], last_contact_at: '2026-11-05T12:00:00.000Z' }));
const understanding = { intent: 'open_client', conversational_act: 'request', target_type: 'contact', target_reference: {}, entity_mentions: [{ kind: 'proper_name', value: 'ENTITY_3', source: 'utterance', certainty: 'confirmed', evidence: 'ENTITY_3' }], constraints: { name: { value: 'ENTITY_3', certainty: 'confirmed' } }, correction: {}, continuation: {}, cancel_scope: 'none', temporal_clues: [], location_clues: [], service_clues: [], confidence: 0.9, ambiguity: false, missing_information: [] };

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
}

async function measure(name, count, action) {
  const samples = [];
  for (let index = 0; index < count; index += 1) {
    const started = performance.now();
    await action(index);
    samples.push(performance.now() - started);
  }
  return { name, samples: count, median_ms: Number(percentile(samples, 0.5).toFixed(4)), p95_ms: Number(percentile(samples, 0.95).toFixed(4)), min_ms: Number(Math.min(...samples).toFixed(4)), max_ms: Number(Math.max(...samples).toFixed(4)) };
}

async function main() {
  const provider = async () => ({ schema: 'yarbi.owner-understanding.v1', ...understanding });
  const metrics = [];
  metrics.push(await measure('owner_identity_classification', 200, () => classifyOwnerPersonalInbound(classificationInput)));
  metrics.push(await measure('context_recovery', 200, () => buildOwnerInstructionRequest({ ownerKey: 'primary', instruction: 'INSTRUCTION_SYNTHETIC', eventId: 'P05-PERF', hmacSecret: secret })));
  metrics.push(await measure('local_candidate_search', 200, () => resolveCandidateReference({ candidates, state: {}, understanding, now: '2026-11-05T12:00:00.000Z' })));
  metrics.push(await measure('owner_turn_processing', 100, index => processOwnerPersonalTurn({ classification: classifyOwnerPersonalInbound(classificationInput), provider, utterance: 'ENTITY_3', candidates, providerEventId: `P05-PERF-${index}`, messageId: `P05-MSG-${index}`, hmacSecret: secret, now: '2026-11-05T12:00:00.000Z' })));
  const report = { schema: 'yarbi.p05.local-performance.v1', generated_at: new Date().toISOString(), environment: 'local_no_network', metrics, limitations: ['No incluye red, Supabase, Gemini, cold-start, Vercel ni almacenamiento remoto.', 'No representa latencia de producción.'] };
  const output = path.join(__dirname, '..', 'P05_LOCAL_PERFORMANCE_EVIDENCE.json');
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ phase: 'P05', result: 'LOCAL_METRICS_WRITTEN', output: path.basename(output), metrics }) + '\n');
}

main().catch(error => { process.stderr.write(`P05_PERFORMANCE_FAILED:${error.code || error.message}\n`); process.exitCode = 1; });
