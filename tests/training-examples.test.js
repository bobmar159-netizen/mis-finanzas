const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'api', 'assistant', 'preferences.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'migrations', 'YARBI_TRAINING_EXAMPLES_MIGRATION_20261019.sql'), 'utf8');

test('training examples use an authenticated, owner-scoped, read-back API', () => {
  assert.match(source, /action === 'training'/);
  assert.match(source, /handleTraining\(req, res, owner\)/);
  assert.match(source, /owner_key=eq\./);
  assert.match(source, /on_conflict=owner_key,id/);
  assert.match(source, /source: 'supabase'/);
  assert.match(source, /body\.confirm !== true/);
});

test('training migration is additive, indexed and protected by RLS', () => {
  assert.match(migration, /create table if not exists public\.yarbi_training_examples/i);
  assert.match(migration, /primary key \(owner_key, id\)/i);
  assert.match(migration, /create index if not exists yarbi_training_examples_active_idx/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all .* anon, authenticated/i);
  assert.doesNotMatch(migration, /drop table|truncate table|delete from/i);
});
