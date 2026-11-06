const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const frontend = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('cycle: agenda exposes planned, actual and next action independently', () => {
  assert.match(frontend, /function gfcAgendaOperationalCycle\(item\)/);
  assert.match(frontend, /planned: \{ status:/);
  assert.match(frontend, /actual: \{ status: actual/);
  assert.match(frontend, /next_action: nextAction/);
  assert.match(frontend, /OPERATIONAL_CYCLE_V1/);
});

test('cycle: a planned date never proves execution', () => {
  const start = frontend.indexOf('function gfcAgendaOperationalCycle(item)');
  const end = frontend.indexOf('function gfcAgentCompact', start);
  const block = frontend.slice(start, end);
  assert.match(block, /actual = completed \? 'executed'/);
  assert.match(block, /'unconfirmed'/);
  assert.match(block, /La fecha planificada no demuestra ejecución/);
});
