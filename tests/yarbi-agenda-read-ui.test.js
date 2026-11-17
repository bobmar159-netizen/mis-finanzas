'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const agenda = require('../lib/yarbi-agenda-intelligence');
const renderer = require('../frontend/yarbi-conversation-renderer');

const NOW = Date.parse('2026-11-10T15:00:00.000Z');
function uiWith(events) {
  const window = { YarbiAgendaIntelligence:agenda, YarbiConversationRenderer:renderer, gfcGetAgendaReadInput:() => ({ now:NOW, events }) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'frontend', 'yarbi-agenda-read-ui.js'), 'utf8'), { window, String, Array, Date, Intl });
  return window;
}

test('Agenda fast read answers tomorrow and pending visits from local records only', async () => {
  const window = uiWith([
    { id:'tomorrow', client_name:'CLIENTE_A', event_type:'visita', service:'reparacion', status:'agendado', starts_at:'2026-11-11T15:00:00.000Z' },
    { id:'pending', client_name:'CLIENTE_B', event_type:'visita', service:'instalacion_nueva', status:'pendiente' }
  ]);
  const tomorrow = await window.gfcTryAgendaReadMessage('¿Qué tengo mañana?');
  assert.equal(tomorrow.handled, true);
  assert.match(tomorrow.reply, /## 📅 Agenda de mañana/);
  assert.match(tomorrow.reply, /CLIENTE_A/);
  assert.match(tomorrow.reply, /miércoles,? 11 de noviembre/);
  assert.match(tomorrow.reply, /programada/);
  assert.equal(tomorrow.execute, false);
  const richTomorrow = renderer.validateContent(tomorrow.presentation);
  assert.equal(richTomorrow.ok, true);
  assert.ok(richTomorrow.blocks.some(block => block.type === 'appointment_card'));
  const pending = await window.gfcTryAgendaReadMessage('¿Qué visitas siguen pendientes?');
  assert.match(pending.reply, /## 🛠️ Visitas pendientes/);
  assert.match(pending.reply, /CLIENTE_B/);
  assert.equal(await window.gfcTryAgendaReadMessage('Recuérdame llamar al cliente el lunes'), null);
});

test('Agenda empty reads use the same renderer and make no activity up', async () => {
  const result = await uiWith([]).gfcTryAgendaReadMessage('¿Qué tengo mañana?');
  const rich = renderer.validateContent(result.presentation);
  assert.equal(rich.ok, true);
  assert.ok(rich.blocks.some(block => block.type === 'information_panel'));
  assert.equal(result.execute, false);
});

test('Agenda read includes the existing IndexedDB mirror and prefers unsynced local state on duplicate IDs', async () => {
  const window = uiWith([{ id:'same-id', client_name:'Cliente local', event_type:'visita técnica', status:'agendado', starts_at:'2026-11-11T15:00:00.000Z' }]);
  window.gfcYarbiLocalRows = async kind => {
    if (kind === 'contact') return [{ id:42, display_name:'Cliente réplica' }];
    assert.equal(kind, 'agenda');
    return [
      { id:'same-id', client_name:'Versión anterior', event_type:'visita', status:'agendado', starts_at:'2026-11-11T15:00:00.000Z' },
      { id:'mirror-only', contact_id:42, event_type:'visita', status:'agendado', starts_at:'2026-11-11T17:00:00.000Z' }
    ];
  };
  const result = await window.gfcTryAgendaReadMessage('¿Qué tengo mañana?');
  assert.match(result.reply, /Cliente local/);
  assert.match(result.reply, /Cliente réplica/);
  assert.doesNotMatch(result.reply, /Versión anterior/);
  assert.equal(result.facts.count, 2);
});

test('Agenda fast UI performs no fetch, storage write, or scheduling action', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'yarbi-agenda-read-ui.js'), 'utf8');
  assert.equal(/fetch\s*\(|localStorage\.setItem|sessionStorage\.setItem|agenda.*(?:save|create|update|delete)/i.test(source), false);
});
