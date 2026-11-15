const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const frontend = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function reference() {
  const start = frontend.indexOf('function gfcAgendaClientReference');
  const end = frontend.indexOf('function gfcManualAgendaDraft', start);
  const context = {};
  vm.createContext(context);
  vm.runInContext(frontend.slice(start, end), context);
  return context.gfcAgendaClientReference;
}

test('agenda identity separates the client name from a district clue', () => {
  const result = reference()('Vamos a agendar visita para Oswaldo de Comas');
  assert.equal(result.name, 'Oswaldo');
  assert.equal(result.district, 'Comas');
});

test('agenda identity preserves location clues after the client name', () => {
  const result = reference()('Agendemos construcción para señora Monica que envió ubicación ayer por la mañana');
  assert.equal(result.name, 'Monica');
  assert.equal(result.requires_location, true);
  assert.equal(result.text_hint, 'ubicacion');
});

test('agenda lookup forwards multiple clues to the existing candidate scorer', () => {
  const start = frontend.indexOf('async function gfcResolveAgendaCreationIdentity');
  const end = frontend.indexOf('// Fecha de agenda determinista', start);
  const block = frontend.slice(start, end);
  assert.match(block, /district_hint:args\.district_hint/);
  assert.match(block, /text_hint:args\.text_hint/);
  assert.match(block, /service_hint:args\.service_hint/);
  assert.match(block, /requires_location:args\.requires_location/);
});
