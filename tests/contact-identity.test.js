const test = require('node:test');
const assert = require('node:assert/strict');

const {
  cleanPersonName,
  normalizeDeclaredIdentity,
  buildContactNamePatch
} = require('../lib/yarbi-contact-identity');

test('identity: accepts a high-confidence name backed by an incoming message', () => {
  const identity = normalizeDeclaredIdentity({
    name: 'Omar Mejía',
    source_message_ids: ['in-1'],
    confidence: 0.97
  }, [
    { id: 'in-1', metadata: { direction: 'incoming' } },
    { id: 'out-1', metadata: { direction: 'outgoing' } }
  ]);
  assert.deepEqual(identity, {
    name: 'Omar Mejía',
    source_message_ids: ['in-1'],
    confidence: 0.97
  });
});

test('identity: rejects outgoing, unsupported or low-confidence names', () => {
  const messages = [{ id: 'out-1', metadata: { direction: 'outgoing' } }];
  assert.equal(normalizeDeclaredIdentity({ name: 'Omar Mejía', source_message_ids: ['out-1'], confidence: 0.99 }, messages), null);
  assert.equal(normalizeDeclaredIdentity({ name: 'Omar Mejía', source_message_ids: ['missing'], confidence: 0.99 }, messages), null);
  assert.equal(normalizeDeclaredIdentity({ name: 'Omar Mejía', source_message_ids: ['out-1'], confidence: 0.5 }, messages), null);
});

test('identity: replaces placeholders but preserves an existing full name', () => {
  const identity = { name: 'Omar Mejía' };
  assert.deepEqual(
    buildContactNamePatch({ display_name: 'Cliente WhatsApp', full_name: 'Cliente WhatsApp' }, identity, '955411248'),
    { patch: { display_name: 'Omar Mejía', full_name: 'Omar Mejía' }, reason: 'placeholder_replaced' }
  );
  assert.deepEqual(
    buildContactNamePatch({ display_name: 'Omar M.', full_name: 'Omar Manuel' }, identity, '955411248'),
    { patch: { display_name: 'Omar Mejía' }, reason: 'display_name_promoted_full_name_preserved' }
  );
});

test('identity: sanitizes unsafe or non-person values', () => {
  assert.equal(cleanPersonName('https://maps.google.com/123'), '');
  assert.equal(cleanPersonName('Cliente WhatsApp'), '');
  assert.equal(cleanPersonName('Omar Mejía'), 'Omar Mejía');
});

test('identity: never replaces a useful manual or phonebook name with a chat-declared alias', () => {
  assert.deepEqual(
    buildContactNamePatch({ display_name: 'Nombre guardado', full_name: 'Nombre guardado', source: 'yarbi_form' }, { name: 'Nombre del chat' }, '955411248'),
    { patch: null, reason: 'manual_name_preserved' }
  );
});
