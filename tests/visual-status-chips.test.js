const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const frontend = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function loadVisualChips() {
  const start = frontend.indexOf('const AGENDA_ESTADOS = {');
  const end = frontend.indexOf('const AGENDA_SERVICIOS = [', start);
  const context = {
    _migEst: value => String(value || 'agendado'),
    gfcYarbiLocalNormalize: value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(),
    crmText: value => String(value || '')
  };
  vm.createContext(context);
  vm.runInContext(frontend.slice(start, end), context);
  return context;
}

test('visual chips: completed visit is shown as Visitado', () => {
  const context = loadVisualChips();
  const chips = context.gfcAgendaVisualChips({ tipo:'visita', estado:'interesado' });
  assert.equal(chips[0].label, 'Visitado');
});

test('visual chips: completed work and pending balance are both visible', () => {
  const context = loadVisualChips();
  const chips = context.gfcAgendaVisualChips({ tipo:'trabajo', estado:'se_finalizo', montoPendienteCobro:80 });
  assert.equal(chips[0].label, 'Realizado');
  assert.ok(chips.some(chip => chip.kind === 'balance' && /80\.00/.test(chip.label)));
});

test('visual chips: Agenda and CRM reuse the same renderer', () => {
  assert.match(frontend, /VISUAL_STATUS_CHIPS_V1/);
  const calls = frontend.match(/gfcAgendaVisualChipsHtml\(/g) || [];
  assert.ok(calls.length >= 3);
  assert.match(frontend, /const visualChipsHtml = gfcAgendaVisualChipsHtml\(item\)/);
  assert.match(frontend, /agenda \? '<div style="margin-top:7px">' \+ gfcAgendaVisualChipsHtml\(agenda\)/);
});

test('visual chips: a completed visit counts as executed in the operational cycle', () => {
  const start = frontend.indexOf('function gfcAgendaOperationalCycle(item)');
  const end = frontend.indexOf('// DAILY_CLOSE_V1', start);
  const block = frontend.slice(start, end);
  assert.match(block, /completedVisit/);
  assert.match(block, /interesado\|convertido\|visitado/);
  assert.match(block, /completedVisit \|\|/);
});
