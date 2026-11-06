'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'PROPOSED_20261105_yarbi_owner_personal_whatsapp.sql'), 'utf8');

test('P05 proposed owner-personal schema is isolated from commercial customer tables and starts fail-closed', () => {
  assert.match(sql, /^begin;/m);
  assert.match(sql, /owner_personal_objects_already_exist_manual_contract_review_required/);
  assert.match(sql, /yarbi_owner_authorized_identities/);
  assert.match(sql, /yarbi_owner_personal_conversations/);
  assert.match(sql, /yarbi_owner_personal_messages/);
  assert.match(sql, /yarbi_owner_provider_events/);
  assert.match(sql, /yarbi_owner_personal_audio_assets/);
  assert.doesNotMatch(sql, /references\s+public\.(crm_contacts|clients|whatsapp_messages|ai_message_analysis)/i);
});

test('P05 proposed schema has durable idempotency, bounded audio and strict service-only RLS grants', () => {
  assert.match(sql, /unique\(provider, event_fingerprint\)/i);
  assert.match(sql, /unique\(conversation_id, provider_message_fingerprint\)/i);
  assert.match(sql, /size_bytes <= 16777216/i);
  assert.match(sql, /duration_ms <= 600000/i);
  assert.match(sql, /enable row level security/ig);
  assert.match(sql, /revoke all[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant select, insert, update[\s\S]*to service_role/i);
  assert.doesNotMatch(sql, /grant all on table/i);
});
