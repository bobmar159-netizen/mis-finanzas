const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const command = fs.readFileSync(path.join(__dirname, '..', 'api_handlers', 'assistant', 'command.js'), 'utf8');
const deletion = fs.readFileSync(path.join(__dirname, '..', 'api', 'actions', 'approve.js'), 'utf8');

test('agenda routing separates future construction from finalized service', () => {
  assert.match(command, /crea una construcción futura/i);
  assert.match(command, /action\.intent = 'create_construction'/);
  assert.match(command, /action\.new_status = 'agendado'/);
  assert.match(command, /Usa register_service exclusivamente/);
});

test('agenda routing recognizes reprogramming and explicit deletion', () => {
  assert.match(command, /action\.new_status = 'reprogramado'/);
  assert.match(command, /action\.intent = 'delete_agenda'/);
  assert.match(command, /Para eliminar usa delete_agenda solo ante una orden explícita/);
});

test('agenda deletion is authenticated, scoped and read-back verified', () => {
  assert.match(deletion, /token !== ASSISTANT_TOKEN/);
  assert.match(deletion, /operation === 'delete_agenda'/);
  assert.match(deletion, /source=eq\.yarbi_form/);
  assert.match(deletion, /method: 'DELETE'/);
  assert.match(deletion, /agenda_delete_not_verified/);
  assert.match(deletion, /readback_verified: true/);
});
