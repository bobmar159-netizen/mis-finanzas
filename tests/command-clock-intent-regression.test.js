const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'assistant', 'command.js'), 'utf8');
const start = source.indexOf('function isCurrentDateQuestion');
const end = source.indexOf('async function loadMessagesForLimaDate', start);
assert.ok(start >= 0 && end > start, 'No se encontró isCurrentDateQuestion');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(source.slice(start, end), sandbox);

test('command clock intent accepts only explicit clock questions', () => {
  assert.equal(sandbox.isCurrentDateQuestion('¿Qué fecha es hoy?'), true);
  assert.equal(sandbox.isCurrentDateQuestion('Dime la fecha actual'), true);
  assert.equal(sandbox.isCurrentDateQuestion('¿Qué día es hoy?'), true);
});

test('command clock intent does not hijack a client or agenda sentence containing hoy día', () => {
  assert.equal(sandbox.isCurrentDateQuestion('Este es el cliente que envió la ubicación hoy día.'), false);
  assert.equal(sandbox.isCurrentDateQuestion('Cambia los datos de Ernesto, él mandó ubicación hoy día.'), false);
  assert.equal(sandbox.isCurrentDateQuestion('Agenda a Ernesto hoy día a las cinco.'), false);
});
