const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const frontend = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const api = fs.readFileSync(path.join(root, 'api', 'assistant', 'collections.js'), 'utf8');
const vercel = fs.readFileSync(path.join(root, 'vercel.json'), 'utf8');
const migration = fs.readFileSync(path.join(root, '..', 'YARBI_RECEIVABLES_MIGRATION_20261002.sql'), 'utf8');

function collectionContext() {
  const start = frontend.indexOf('function gfcAgendaAgreedTotal(item)');
  const end = frontend.indexOf('function gfcAgentCompact', start);
  const context = {
    gfcYarbiLocalNormalize: value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
  };
  vm.createContext(context);
  vm.runInContext(frontend.slice(start, end), context);
  return context;
}

test('collections: spoken balance must match the exact amount passed to the tool', () => {
  const context = collectionContext();
  assert.equal(context.gfcCollectionSpokenBalance('Quedó debiendo S/200.'), 200);
  assert.equal(context.gfcCollectionInputSupports(200, 'Quedó debiendo S/200.'), true);
  assert.equal(context.gfcCollectionInputSupports(250, 'Quedó debiendo S/200.'), false);
  assert.equal(context.gfcCollectionInputSupports(0, 'Sí, se cobró todo'), true);
  assert.equal(context.gfcCollectionSpokenBalance('Creo que después vemos'), null);
});

test('collections: frontend requires completed work, exact agenda id and remote confirmation', () => {
  const start = frontend.indexOf('async function gfcRecordCollectionBalance(args)');
  const end = frontend.indexOf('// PROACTIVE_ALERTS_V1', start);
  const block = frontend.slice(start, end);
  assert.match(frontend, /COLLECTION_BALANCE_V1/);
  assert.match(block, /String\(row\?\.id \|\| ''\) === agendaId/);
  assert.match(block, /actual\.status !== 'executed'/);
  assert.match(block, /gfcCollectionInputSupports\(balanceAmount, inputText\)/);
  assert.match(block, /persisted_remote: true/);
  assert.match(block, /payload\?\.canonical_updates\?\.verified !== true/);
  assert.match(block, /canonical_updates_verified: true/);
  assert.match(block, /abrirModalCobro\(item\.id\)/);
  assert.doesNotMatch(block, /telefono/);
});

test('collections: Supabase persistence is idempotent and service-role only', () => {
  assert.match(migration, /unique \(agenda_event_id\)/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all.*anon, authenticated/i);
  assert.match(api, /on_conflict=agenda_event_id/);
  assert.match(api, /event\.status !== 'completed'/);
  assert.match(api, /balanceAmount > agreedAmount/);
  assert.match(api, /const readBack = await supabaseRequest\('\/rest\/v1\/yarbi_receivables\?id=eq\.'/);
  assert.match(api, /readback_verified: true/);
  assert.match(api, /read-back no confirmó sus datos/);
  assert.match(api, /El evento no tiene un contacto canónico/);
  assert.match(api, /operational_status: operationalStatus/);
  assert.match(api, /ai_conversation_memory\?on_conflict=contact_id/);
  assert.match(api, /ai_memory_versions/);
  assert.match(api, /canonical_updates: canonicalUpdates/);
});

test('collections: secure route is declared and does not expose the Supabase key', () => {
  assert.match(vercel, /\/api\/assistant\/collections/);
  assert.match(api, /bearer\(req\) !== ASSISTANT_TOKEN/);
  assert.doesNotMatch(api, /return res\.status\([^\n]+SUPABASE_KEY/);
});
