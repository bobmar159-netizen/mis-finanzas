const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'assistant', 'command.js'), 'utf8');

test('command accepts only a confirmed conversation focus', () => {
  assert.match(source, /function compactConversationFocus/);
  assert.match(source, /value\.confirmed !== true/);
  assert.match(source, /const conversationFocus = compactConversationFocus\(body\.conversationFocus\)/);
});

test('command prioritizes focus over stale alert and keeps the focused agenda id', () => {
  assert.match(source, /body\.clientName \|\| conversationFocus\?\.clientName \|\| activeAlert\?\.clientName/);
  assert.match(source, /body\.phone \|\| conversationFocus\?\.phone \|\| activeAlert\?\.phone/);
  assert.match(source, /FOCO CONVERSACIONAL CONFIRMADO/);
  assert.match(source, /conversationFocus\?\.agendaId && \['update_agenda', 'delete_agenda'\]/);
});

test('command keeps the existing phone conflict guard for focused mutations', () => {
  assert.match(source, /const lockedPhone = cleanPhone\(conversationFocus\?\.phone \|\| activeAlert\?\.phone/);
  assert.match(source, /phoneIsTrusted\(action\.phone, lockedPhone, text\)/);
});

test('command keeps a confirmed agenda for natural date and time continuations', () => {
  assert.match(source, /function isFocusedAgendaContinuation/);
  assert.match(source, /conversationFocus\?\.agendaId && isFocusedAgendaContinuation\(text\)/);
  assert.match(source, /action\.intent = 'update_agenda'/);
});

test('client ambiguity asks for a human clue before asking for phone digits', () => {
  assert.match(source, /distrito, servicio, ubicación o fecha aproximada/);
  assert.match(source, /último recurso/);
});
