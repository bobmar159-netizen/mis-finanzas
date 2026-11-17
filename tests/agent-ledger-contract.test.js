const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const api = fs.readFileSync(path.join(root, 'api_handlers', 'assistant', 'preferences.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'migrations', 'YARBI_AGENT_ACTION_LEDGER_20261025.sql'), 'utf8');

test('agent ledger inside Preferences persists an idempotent action ledger', () => {
  assert.match(api, /yarbi_agent_actions/);
  assert.match(api, /existing\?\.status === 'executed' && event\.status === 'executed'/);
  assert.match(api, /resource === 'audit'/);
});

test('agent ledger inside Preferences persists and reads cross-device client resolutions', () => {
  assert.match(api, /operation === 'upsert_resolution'/);
  assert.match(api, /resource === 'resolutions'/);
  assert.match(api, /yarbi_client_resolutions/);
});

test('ledger migration keeps tables backend-only through RLS and grants', () => {
  assert.match(migration, /alter table public\.yarbi_agent_actions enable row level security/i);
  assert.match(migration, /revoke all on table public\.yarbi_agent_actions from anon, authenticated/i);
  assert.match(migration, /grant select, insert, update on table public\.yarbi_agent_actions to service_role/i);
  assert.match(migration, /alter table public\.yarbi_client_resolutions enable row level security/i);
});
