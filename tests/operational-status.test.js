const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildContactStatusPatch,
  evidenceIsOnlyLocationSignal,
  normalizeStatusEvidence
} = require('../lib/yarbi-statuses');

const root = path.join(__dirname, '..');

test('status: keeps commercial interest and operational workflow independent', () => {
  const normalized = normalizeStatusEvidence({
    commercial_status: 'caliente',
    status_reason: 'Pidió precio y confirmó interés',
    commercial_status_source_message_ids: ['m1'],
    operational_status: 'esperando_cliente',
    operational_reason: 'Falta confirmar fecha',
    operational_status_source_message_ids: ['m2']
  }, ['m1', 'm2']);

  assert.equal(normalized.commercial_status, 'caliente');
  assert.equal(normalized.operational_status, 'esperando_cliente');
});

test('status: rejects states without traceable source messages', () => {
  const normalized = normalizeStatusEvidence({
    commercial_status: 'caliente',
    commercial_status_source_message_ids: ['foreign'],
    operational_status: 'visita_agendada',
    operational_status_source_message_ids: []
  }, ['m1']);
  const patch = buildContactStatusPatch({}, normalized, [{ id: 'm1', timestamp: 1790990000000 }]);

  assert.deepEqual(patch, {});
});

test('status: an older message cannot overwrite a newer operational state', () => {
  const analysis = normalizeStatusEvidence({
    operational_status: 'seguimiento_pendiente',
    operational_reason: 'Pidió que lo llamen',
    operational_status_source_message_ids: ['old']
  }, ['old']);
  const patch = buildContactStatusPatch(
    { operational_status: 'visita_agendada', operational_event_at: '2026-10-02T20:00:00.000Z' },
    analysis,
    [{ id: 'old', timestamp: new Date('2026-10-02T19:00:00.000Z').getTime() }]
  );

  assert.equal(Object.hasOwn(patch, 'operational_status'), false);
});

test('status: newer evidence updates only the supported dimension', () => {
  const analysis = normalizeStatusEvidence({
    operational_status: 'cobro_pendiente',
    operational_reason: 'Servicio terminado, falta pago',
    operational_status_source_message_ids: ['m3']
  }, ['m3']);
  const patch = buildContactStatusPatch(
    { commercial_status: 'caliente', operational_event_at: '2026-10-02T20:00:00.000Z' },
    analysis,
    [{ id: 'm3', timestamp: new Date('2026-10-02T21:00:00.000Z').getTime() }]
  );

  assert.equal(patch.operational_status, 'cobro_pendiente');
  assert.equal(Object.hasOwn(patch, 'commercial_status'), false);
});

test('status: processor, mirror and frontend expose both independent dimensions', () => {
  const processor = fs.readFileSync(path.join(root, 'api', 'ai', 'process.js'), 'utf8');
  const mirror = fs.readFileSync(path.join(root, 'lib', 'whatsapp-messages.js'), 'utf8');
  const frontend = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  assert.match(processor, /commercial_status mide SOLO interés comercial/);
  assert.match(processor, /updateContactStatuses/);
  assert.match(mirror, /operational_status,operational_reason,operational_event_at/);
  assert.match(frontend, /_yarbiOperationalStatus = insight\.operational_status/);
  assert.match(frontend, /OPERATIONAL_STATUS_V1/);
});

test('status: a Maps location alone becomes visit pending confirmation, never completed', () => {
  const messages = [{ id: 'loc-1', maps_url: 'https://maps.app.goo.gl/test', text: 'Ubicación compartida', timestamp: 1790990000000 }];
  assert.equal(evidenceIsOnlyLocationSignal(messages, ['loc-1']), true);
  const analysis = normalizeStatusEvidence({
    commercial_status: 'caliente',
    commercial_status_source_message_ids: ['loc-1'],
    operational_status: 'servicio_completado',
    operational_reason: 'Suposición incorrecta',
    operational_status_source_message_ids: ['loc-1']
  }, ['loc-1']);
  const patch = buildContactStatusPatch({}, analysis, messages);
  assert.equal(patch.commercial_status, 'caliente');
  assert.equal(patch.operational_status, 'visita_por_confirmar');
  assert.match(patch.operational_reason, /todavía no está confirmada/i);
});

test('status: location plus explicit confirmation can advance the real workflow', () => {
  const messages = [{ id: 'loc-2', maps_url: 'https://maps.app.goo.gl/test', text: 'Confirmo la visita para mañana', timestamp: 1790990000000 }];
  const analysis = normalizeStatusEvidence({
    operational_status: 'visita_agendada',
    operational_status_source_message_ids: ['loc-2']
  }, ['loc-2']);
  const patch = buildContactStatusPatch({}, analysis, messages);
  assert.equal(patch.operational_status, 'visita_agendada');
});
