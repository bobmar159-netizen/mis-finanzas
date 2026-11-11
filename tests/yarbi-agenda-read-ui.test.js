'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const agenda = require('../lib/yarbi-agenda-intelligence');

const NOW = Date.parse('2026-11-10T15:00:00.000Z');
function uiWith(events) {
  const window = { YarbiAgendaIntelligence:agenda, gfcGetAgendaReadInput:() => ({ now:NOW, events }) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'frontend', 'yarbi-agenda-read-ui.js'), 'utf8'), { window, String, Array, Date, Intl });
  return window;
}

test('Agenda fast read answers tomorrow and pending visits from local records only', () => {
  const window = uiWith([
    { id:'tomorrow', client_name:'CLIENTE_A', event_type:'visita', service:'reparacion', status:'agendado', starts_at:'2026-11-11T15:00:00.000Z' },
    { id:'pending', client_name:'CLIENTE_B', event_type:'visita', service:'instalacion_nueva', status:'pendiente' }
  ]);
  const tomorrow = window.gfcTryAgendaReadMessage('¿Qué tengo mañana?');
  assert.equal(tomorrow.handled, true);
  assert.match(tomorrow.reply, /## 📅 Agenda de mañana/);
  assert.match(tomorrow.reply, /CLIENTE_A/);
  assert.match(tomorrow.reply, /miércoles,? 11 de noviembre/);
  assert.match(tomorrow.reply, /programada/);
  assert.equal(tomorrow.execute, false);
  const pending = window.gfcTryAgendaReadMessage('¿Qué visitas siguen pendientes?');
  assert.match(pending.reply, /## 🛠️ Visitas pendientes/);
  assert.match(pending.reply, /CLIENTE_B/);
  assert.equal(window.gfcTryAgendaReadMessage('Recuérdame llamar al cliente el lunes'), null);
});

test('Agenda fast UI performs no fetch, storage write, or scheduling action', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'yarbi-agenda-read-ui.js'), 'utf8');
  assert.equal(/fetch\s*\(|localStorage\.setItem|sessionStorage\.setItem|agenda.*(?:save|create|update|delete)/i.test(source), false);
});
