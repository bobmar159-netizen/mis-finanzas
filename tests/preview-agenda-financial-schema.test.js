const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'PROPOSED_20261116_preview_agenda_receivables.sql'), 'utf8');

test('Preview Agenda schema covers the current canonical appointment and CRM read contracts', () => {
  for (const column of ['contact_id','event_type','title','service','description','location','maps_url','latitude','longitude','starts_at','ends_at','timezone','status','source','dedupe_key','price','service_details','parent_event_id','parent_local_id','local_ref','metadata','created_at','updated_at']) {
    assert.match(sql, new RegExp('\\b' + column + '\\b'));
  }
  assert.match(sql, /foreign key|references public\.crm_contacts\(id\)/i);
  assert.match(sql, /agenda_events_yarbi_dedupe_key_uq/);
  assert.match(sql, /source = 'yarbi_form' and dedupe_key is not null/);
});

test('Preview receivables enforce unique agenda binding and exact partial-payment arithmetic', () => {
  assert.match(sql, /agenda_event_id bigint not null unique references public\.agenda_events\(id\) on delete restrict/);
  assert.match(sql, /paid_amount \+ balance_amount = agreed_amount/);
  assert.match(sql, /status in \('paid','partial','unpaid'\)/);
  assert.match(sql, /yarbi_receivables_contact_status_search_idx/);
});

test('new Preview tables are service-role-only and enable forced RLS', () => {
  for (const table of ['agenda_events','yarbi_receivables']) {
    assert.match(sql, new RegExp('alter table public\\.' + table + ' enable row level security'));
    assert.match(sql, new RegExp('alter table public\\.' + table + ' force row level security'));
  }
  assert.match(sql, /revoke all on public\.agenda_events, public\.yarbi_receivables from public, anon, authenticated/);
  assert.match(sql, /grant select, insert, update, delete on public\.agenda_events, public\.yarbi_receivables to service_role/);
  assert.doesNotMatch(sql, /\bdrop\s+table\b|\btruncate\b|\bdelete\s+from\b/i);
});
