'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const mirror = fs.readFileSync(path.join(root, 'lib', 'whatsapp-messages.js'), 'utf8');
const frontend = fs.readFileSync(path.join(root, 'frontend', 'index.html'), 'utf8');
const build = fs.readFileSync(path.join(root, 'scripts', 'build-unified-frontend.cjs'), 'utf8');
const { buildFinanceContext } = require('../lib/yarbi-finance-context');
const { replyForContext } = require('../lib/yarbi-client-context-read');

test('local mirror exposes only canonical receivable fields for a verified dossier balance', () => {
  assert.match(mirror, /yarbi_receivables\?select=id,contact_id,agreed_amount,paid_amount,balance_amount,status,next_action,next_action_due,created_at,updated_at/);
  assert.match(mirror, /entities: \{ contacts, identifiers, memories, agenda, alerts, analyses, observations, receivables,/);
  assert.match(mirror, /\[\.\.\.contacts,[\s\S]*\.\.\.receivables,/);
});

test('browser local mirror stores receivables and resolves balance through the shared pure context', () => {
  assert.match(frontend, /\['receivable', entities\.receivables \|\| \[\], row => row\.id\]/);
  assert.match(frontend, /\['contact', 'identifier', 'memory', 'agenda', 'alert', 'observation', 'reply_style', 'analysis', 'receivable', 'message'\]/);
  assert.match(frontend, /YarbiFinanceContext\?\.buildFinanceContext/);
  assert.match(frontend, /<script src="\.\/yarbi-finance-context\.js"><\/script>/);
  assert.match(build, /fs\.copyFileSync\(financeContext, path\.join\(out, 'yarbi-finance-context\.js'\)\)/);
});

test('a local dossier reports only a positive canonical receivable, never a quote or missing record', () => {
  const finance = buildFinanceContext({
    contactId: 44,
    analyses: [{ id: 'quote-only', contact_id: 44, extracted_data: { quote: 'S/ 900' } }],
    receivables: [{ id: 'balance-44', contact_id: 44, agreed_amount: 500, paid_amount: 200, balance_amount: 300, status: 'partial', updated_at: '2026-11-11T12:00:00Z' }],
    movements: null
  });
  const found = replyForContext({ utterance: '¿Cuánto debe Carla?', context: { contact: { display_name: 'Carla' }, finance } });
  assert.equal(found.outcome, 'client_balance_found');
  assert.match(found.reply, /S\/ 300\.00/);

  const unavailable = replyForContext({ utterance: '¿Cuánto debe Carla?', context: { contact: { display_name: 'Carla' }, finance: buildFinanceContext({ contactId: 44, analyses: [{ contact_id: 44, extracted_data: { quote: 'S/ 900' } }], receivables: [], movements: null }) } });
  assert.equal(unavailable.outcome, 'no_verified_balance');
});
