const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildObservationRows,
  normalizeObservationBundle
} = require('../lib/yarbi-observations');

const root = path.join(__dirname, '..');

test('observations: separates facts, signals and inferences with source traceability', () => {
  const observations = normalizeObservationBundle({
    facts: [{ category: 'Precio confirmado', value: 'S/ 180', source_message_ids: ['m1'], confidence: 0.99 }],
    signals: [{ category: 'Ubicación enviada', value: 'El cliente compartió Maps', source_message_ids: ['m2'] }],
    inferences: [{ category: 'Interés comercial', value: 'Probablemente alto', source_message_ids: ['m1', 'm2'], confidence: 0.72 }]
  }, ['m1', 'm2']);

  assert.equal(observations.facts[0].observation_type, 'fact');
  assert.equal(observations.signals[0].observation_type, 'signal');
  assert.equal(observations.inferences[0].observation_type, 'inference');
  assert.deepEqual(observations.inferences[0].source_message_ids, ['m1', 'm2']);
});

test('observations: rejects untraceable or foreign message ids', () => {
  const observations = normalizeObservationBundle({
    facts: [
      { category: 'fecha', value: 'mañana', source_message_ids: [] },
      { category: 'telefono', value: '999', source_message_ids: ['foreign'] },
      { category: 'servicio', value: 'Instalación', source_message_ids: ['m1', 'foreign'] }
    ]
  }, ['m1']);

  assert.equal(observations.facts.length, 1);
  assert.deepEqual(observations.facts[0].source_message_ids, ['m1']);
});

test('observations: deterministic dedupe prevents repeated processing duplicates', () => {
  const observations = normalizeObservationBundle({
    facts: [{ category: 'servicio', value: 'Instalación nueva', source_message_ids: ['m1'] }]
  }, ['m1']);
  const first = buildObservationRows({ contactId: 7, analysisId: 10, processingRunId: 20, observations, observedAt: '2026-10-02T20:00:00.000Z' });
  const second = buildObservationRows({ contactId: 7, analysisId: 11, processingRunId: 21, observations, observedAt: '2026-10-02T20:01:00.000Z' });

  assert.equal(first[0].dedupe_key, second[0].dedupe_key);
  assert.equal(first[0].value, 'Instalación nueva');
});

test('observations: processor requests traceable evidence and the local mirror exposes it', () => {
  const processor = fs.readFileSync(path.join(root, 'api', 'ai', 'process.js'), 'utf8');
  const mirror = fs.readFileSync(path.join(root, 'lib', 'whatsapp-messages.js'), 'utf8');
  const frontend = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  assert.match(processor, /source_message_ids debe contener solo IDs de MENSAJES NUEVOS/);
  assert.match(processor, /saveContactObservations/);
  assert.match(mirror, /ai_contact_observations/);
  assert.match(mirror, /yarbi-local-mirror-v3/);
  assert.match(frontend, /\['observation', entities\.observations/);
  assert.match(frontend, /observations: observations\.filter/);
});
