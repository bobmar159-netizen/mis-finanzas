const test = require('node:test');
const assert = require('node:assert/strict');
const { detectAgendaClientSignal } = require('../lib/yarbi-agenda-client-signals');

test('agenda client signals detect explicit confirm, cancel and reprogram messages', () => {
  assert.equal(detectAgendaClientSignal([{ id: 'a', text: 'Confirmo la visita', metadata: { direction: 'incoming' } }]).kind, 'confirm');
  assert.equal(detectAgendaClientSignal([{ id: 'b', text: 'Quiero cancelar la cita', metadata: { direction: 'incoming' } }]).kind, 'cancel');
  assert.equal(detectAgendaClientSignal([{ id: 'c', text: 'Podemos cambiar la fecha para otro día', metadata: { direction: 'incoming' } }]).kind, 'reprogram');
  assert.equal(detectAgendaClientSignal([{ id: 'd', text: 'Se me olvidó y tenía el celular apagado, ¿puede reprogramarme para el martes?', metadata: { direction: 'incoming' } }]).kind, 'reprogram');
  assert.equal(detectAgendaClientSignal([{ id: 'e', text: 'La visita para el martes por favor', metadata: { direction: 'incoming' } }]).kind, 'reprogram');
});

test('agenda client signals ignore outgoing and historical messages', () => {
  assert.equal(detectAgendaClientSignal([{ id: 'a', text: 'Confirmo la visita', metadata: { direction: 'outgoing' } }]), null);
  assert.equal(detectAgendaClientSignal([{ id: 'b', text: 'Quiero cancelar la cita', metadata: { historical: true } }]), null);
});
