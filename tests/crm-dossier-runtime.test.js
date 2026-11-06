'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getScopedCrmDossier } = require('../lib/yarbi-crm-dossier-runtime');

const OWNER_A = '00000000-0000-4000-8000-0000000000a1';
const OWNER_B = '00000000-0000-4000-8000-0000000000b2';
const identity = subject => ({ kind: 'validated_auth_identity', subject });
const scope = owner => async () => ({ owner_id: owner, contact_ids: owner === OWNER_A ? [101] : [202], verification: 'canonical_owner_contact_scope' });

function store(calls) {
  return async path => {
    calls.push(path);
    const respond = data => ({ response: { ok: true, status: 200 }, data });
    if (path.includes('crm_contacts')) return respond([{ id: 101, display_name: 'F02 Cliente Sintético', commercial_status: 'tibio', latest_service: 'reparacion', last_contact_at: '2026-11-05T15:00:00Z' }]);
    if (path.includes('contact_identifiers')) return respond([{ contact_id: 101, normalized_value: '900000101', is_primary: true }]);
    if (path.includes('operational_memory')) return respond([{ contact_id: 101, memory_type: 'pending_step', value: { step: 'confirmar visita' } }]);
    if (path.includes('whatsapp_messages')) return respond([{ id: 'F02-MSG-1', contact_id: 101, title: 'Consulta', text: 'Servicio sintético', timestamp: '2026-11-05T15:00:00Z' }]);
    if (path.includes('ai_message_analysis')) return respond([{ id: 9, contact_id: 101, intent: 'consulta', service: 'reparacion', extracted_data: {}, completed_at: '2026-11-05T15:01:00Z' }]);
    if (path.includes('agenda_events')) return respond([{ id: 8, contact_id: 101, service: 'reparacion', status: 'pendiente', description: 'Visita sintética', starts_at: '2026-11-06T15:00:00Z' }]);
    if (path.includes('yarbi_receivables')) return respond([]);
    if (path.includes('yarbi_contact_observations')) return respond([{ id: 7, contact_id: 101, observation_type: 'fact', category: 'distrito', value: 'Comas', status: 'active', observed_at: '2026-11-05T15:02:00Z' }]);
    throw new Error('unexpected path ' + path);
  };
}

test('F02 dossier is built from canonical owner scope with a bounded chronological record', async () => {
  const calls = [];
  const result = await getScopedCrmDossier({ supabase: store(calls), validatedIdentity: identity(OWNER_A), ownerScopeResolver: scope(OWNER_A), contactId: 101 });
  assert.equal(result.outcome, 'dossier_found');
  assert.equal(result.contact_id, 101);
  assert.equal(result.dossier.client_name, 'F02 Cliente Sintético');
  assert.equal(result.dossier.phone, '900000101');
  assert.equal(result.timeline.length, 4);
  assert.equal(result.activities.schema, 'yarbi.agenda-summary.v1');
  assert.equal(result.activities.activities.length, 1);
  assert.ok(result.timeline.every(event => !Object.prototype.hasOwnProperty.call(event, 'owner_id')));
  assert.equal(calls.every(path => /(?:id|contact_id)=in\.\(101\)|contact_id=eq\.101/.test(decodeURIComponent(path))), true);
  assert.equal(calls.every(path => !/https?:\/\/(?![^/]*supabase\.co)/i.test(path)), true);
});

test('F02 dossier refuses a contact outside the verified owner scope before reading contact data', async () => {
  const calls = [];
  const result = await getScopedCrmDossier({ supabase: store(calls), validatedIdentity: identity(OWNER_B), ownerScopeResolver: scope(OWNER_B), contactId: 101 });
  assert.equal(result.outcome, 'contact_not_in_owner_scope');
  assert.equal(result.dossier, null);
  assert.deepEqual(calls, []);
});
