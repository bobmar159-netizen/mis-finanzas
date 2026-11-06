const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workspace = path.resolve(__dirname, '..', '..');
const read = name => fs.readFileSync(path.join(workspace, name), 'utf8');
const migrations = {
  foundation: read('YARBI_PROCESSOR_MIGRATIONS_20260927.sql'),
  settings: read('YARBI_ACCOUNT_SETTINGS_MIGRATION_20260927.sql'),
  observations: read('YARBI_CONTACT_OBSERVATIONS_MIGRATION_20261002.sql'),
  operational: read('YARBI_OPERATIONAL_STATUS_MIGRATION_20261002.sql'),
  habits: read('YARBI_HABIT_LEARNING_MIGRATION_20261002.sql'),
  replyStyle: read('YARBI_REPLY_STYLE_MIGRATION_20261003.sql'),
  receivables: read('YARBI_RECEIVABLES_MIGRATION_20261002.sql')
};
const allSql = Object.values(migrations).join('\n');

test('supabase contract: migrations are additive and contain no destructive table/data command', () => {
  assert.doesNotMatch(allSql, /\bdrop\s+table\b/i);
  assert.doesNotMatch(allSql, /\btruncate\b/i);
  assert.doesNotMatch(allSql, /\bdelete\s+from\b/i);
  assert.doesNotMatch(allSql, /\balter\s+table\s+[^;]+\bdrop\s+column\b/i);
});

test('supabase contract: canonical CRM, processing, memory and agenda tables are defined', () => {
  for (const table of ['crm_contacts','contact_identifiers','ai_processing_runs','ai_message_analysis','ai_conversation_memory','ai_memory_versions','agenda_events','ai_intelligent_alerts']) {
    assert.match(migrations.foundation, new RegExp('create table if not exists public\\.' + table));
  }
  assert.match(migrations.foundation, /whatsapp_messages_contact_id_fkey/);
});

test('supabase contract: queue has trigger, claim RPC, retry index and service-role restriction', () => {
  assert.match(migrations.foundation, /whatsapp_messages_enqueue_yarbi_ai/);
  assert.match(migrations.foundation, /claim_yarbi_message_analysis/);
  assert.match(migrations.foundation, /ai_message_analysis_ready_queue_idx/);
  assert.match(migrations.foundation, /for update skip locked/);
  assert.match(migrations.foundation, /grant execute[\s\S]+to service_role/i);
});

test('supabase contract: settings are owned by the authenticated user', () => {
  assert.match(migrations.settings, /user_id uuid primary key references auth\.users/);
  assert.match(migrations.settings, /enable row level security/);
  assert.match(migrations.settings, /auth\.uid\(\) = user_id/g);
});

test('supabase contract: observations, habits and receivables are traceable and idempotent', () => {
  assert.match(migrations.observations, /source_message_ids text\[\]/);
  assert.match(migrations.observations, /dedupe_key text not null unique/);
  assert.match(migrations.habits, /unique \(owner_key, habit_key\)/);
  assert.match(migrations.habits, /record_yarbi_habit_candidate/);
  assert.match(migrations.replyStyle, /unique \(owner_key, pattern_key\)/);
  assert.match(migrations.replyStyle, /record_yarbi_reply_style_pattern/);
  assert.match(migrations.receivables, /unique \(agenda_event_id\)/);
  assert.match(migrations.receivables, /references public\.agenda_events\(id\)/);
});

test('supabase contract: every new sensitive table enables RLS and critical lookups have indexes', () => {
  assert.match(migrations.observations, /alter table public\.ai_contact_observations enable row level security/);
  assert.match(migrations.habits, /alter table public\.yarbi_habit_candidates enable row level security/);
  assert.match(migrations.replyStyle, /alter table public\.yarbi_reply_style_patterns enable row level security/);
  assert.match(migrations.receivables, /alter table public\.yarbi_receivables enable row level security/);
  assert.match(migrations.operational, /crm_contacts_operational_status_idx/);
  assert.match(migrations.observations, /ai_contact_observations_contact_idx/);
  assert.match(migrations.habits, /yarbi_habit_candidates_ready_idx/);
  assert.match(migrations.replyStyle, /yarbi_reply_style_active_idx/);
  assert.match(migrations.receivables, /yarbi_receivables_open_idx/);
});

test('supabase contract: SQL files do not contain embedded bearer or service-role secrets', () => {
  assert.doesNotMatch(allSql, /eyJ[a-zA-Z0-9_-]{20,}/);
  assert.doesNotMatch(allSql, /service_role\s*[=:]\s*['\"][^'\"]+/i);
});
