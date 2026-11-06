'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { buildUnifiedContactContext, getUnifiedContactContext, getUnifiedContactContexts } = require('../lib/yarbi-unified-contact-context');

function memory(overrides = {}) {
  return {
    service: null, district: null, location: null, pending_step: null, visit: null,
    customer_commitment: null, business_commitment: null, objection: null,
    ...overrides
  };
}

function contact(overrides = {}) {
  return {
    id: 301, display_name: 'F3F Cliente', full_name: null, commercial_status: 'frio', latest_service: null,
    last_contact_at: null, last_contact_message_id: null, ...overrides
  };
}

function unified(input = {}) {
  return buildUnifiedContactContext({ contactId: 301, contact: contact(), identifiers: [], memory: memory(), ...input });
}

test('F3F contact without context returns bounded nulls and deterministic missing fields', () => {
  const result = unified({ contact: null });
  assert.equal(result.found, false);
  assert.deepEqual(result.identity, { display_name: null, phone: null });
  assert.deepEqual(result.missing, ['service', 'district']);
  assert.deepEqual(result.diagnostics, []);
});

test('F3F returns a verified commercial service and chooses the primary phone only', () => {
  const result = unified({
    contact: contact({ latest_service: 'punto_adicional', commercial_status: 'tibio', last_contact_at: '2026-10-30T10:00:00Z', last_contact_message_id: 'F3F-MSG-1' }),
    identifiers: [
      { identifier_type: 'phone', normalized_value: '955000001', is_primary: false },
      { identifier_type: 'phone', normalized_value: '955000002', is_primary: true }
    ]
  });
  assert.equal(result.commercial.service, 'punto_adicional');
  assert.equal(result.commercial.service_source, 'commercial_context');
  assert.equal(result.identity.phone, '955000002');
});

test('F3F reports an objectively missing location for a hot requested visit', () => {
  const result = unified({
    contact: contact({ commercial_status: 'caliente', latest_service: 'instalacion_nueva' }),
    memory: memory({ visit: { requested: true }, pending_step: { step: 'waiting_for_location' } })
  });
  assert.deepEqual(result.missing, ['district', 'location']);
  assert.deepEqual(result.memory.pending_step, { step: 'waiting_for_location' });
});

test('F3F only receives active memory supplied by the operational-memory reader', () => {
  const result = unified({ memory: memory({ district: { district: 'Comas' }, location: { url: 'https://maps.example/F3F' } }) });
  assert.deepEqual(result.memory.district, { district: 'Comas' });
  assert.equal(result.memory.service, null);
  assert.equal(result.missing.includes('district'), false);
});

test('F3F never carries identity or active memory from another contact', () => {
  const first = buildUnifiedContactContext({
    contactId: 301,
    contact: contact({ display_name: 'F3F Uno', latest_service: 'reparacion' }),
    identifiers: [{ identifier_type: 'phone', normalized_value: '955301001', is_primary: true }],
    memory: memory({ district: { district: 'Comas' } })
  });
  const second = buildUnifiedContactContext({
    contactId: 302,
    contact: contact({ id: 302, display_name: 'F3F Dos', latest_service: null }),
    identifiers: [{ identifier_type: 'phone', normalized_value: '955302002', is_primary: true }],
    memory: memory({ district: { district: 'Ate' } })
  });
  assert.equal(first.identity.phone, '955301001');
  assert.deepEqual(first.memory.district, { district: 'Comas' });
  assert.equal(second.identity.phone, '955302002');
  assert.deepEqual(second.memory.district, { district: 'Ate' });
});

test('F3F exposes service disagreements instead of silently choosing a source', () => {
  const result = unified({
    contact: contact({ latest_service: 'reparacion' }),
    memory: memory({ service: { service: 'punto_adicional' } })
  });
  assert.equal(result.commercial.service, null);
  assert.equal(result.missing.includes('service'), false);
  assert.deepEqual(result.diagnostics, [{ code: 'context_conflict', field: 'service', sources: ['commercial_context', 'operational_memory'] }]);
});

test('F3F unified reader uses exactly three bounded reads, remains stable, and never scans messages', async () => {
  const calls = [];
  const supabase = async path => {
    calls.push(path);
    if (path.startsWith('/rest/v1/crm_contacts')) return { response: { ok: true }, data: [contact({ latest_service: 'reparacion' })] };
    if (path.startsWith('/rest/v1/contact_identifiers')) return { response: { ok: true }, data: [{ identifier_type: 'phone', normalized_value: '955333444', is_primary: true }] };
    if (path.startsWith('/rest/v1/yarbi_contact_operational_memory')) return { response: { ok: true }, data: [{ memory_type: 'service', memory_key: 'current', value: { service: 'reparacion' }, occurred_at: '2026-10-30T10:00:00Z' }] };
    throw new Error('unexpected path ' + path);
  };
  const started = performance.now();
  const first = await getUnifiedContactContext({ supabase, contactId: 301 });
  const elapsedMs = performance.now() - started;
  const second = await getUnifiedContactContext({ supabase, contactId: 301 });
  assert.deepEqual(first, second);
  assert.equal(calls.length, 6);
  assert.equal(calls.every(path => !/whatsapp_messages|ai_message_analysis|gemini|agenda/i.test(path)), true);
  assert.equal(calls.filter(path => path.startsWith('/rest/v1/yarbi_contact_operational_memory')).every(path => path.includes('state=eq.active')), true);
  assert.ok(JSON.stringify(first).length < 1800);
  assert.ok(elapsedMs < 100, `local bounded reader took ${elapsedMs}ms`);
});

test('F3F returns safe failures for an invalid contact or unavailable source', async () => {
  await assert.rejects(() => getUnifiedContactContext({ supabase: async () => ({ response: { ok: true }, data: [] }), contactId: 0 }), error => error.code === 'unified_context_contact_invalid');
  await assert.rejects(() => getUnifiedContactContext({ supabase: async () => ({ response: { ok: false }, data: [] }), contactId: 301 }), error => error.code === 'unified_context_contact_read_failed');
});

test('F3F batch reader retrieves multiple contexts with three bounded reads rather than N+1 scans', async () => {
  const calls = [];
  const supabase = async path => {
    calls.push(path);
    if (path.startsWith('/rest/v1/crm_contacts')) return { response: { ok: true }, data: [contact({ id: 301, latest_service: 'reparacion' }), contact({ id: 302, display_name: 'F3F Dos', latest_service: 'punto_adicional', commercial_status: 'tibio' })] };
    if (path.startsWith('/rest/v1/contact_identifiers')) return { response: { ok: true }, data: [{ contact_id: 301, identifier_type: 'phone', normalized_value: '955301001', is_primary: true }, { contact_id: 302, identifier_type: 'phone', normalized_value: '955302002', is_primary: true }] };
    if (path.startsWith('/rest/v1/yarbi_contact_operational_memory')) return { response: { ok: true }, data: [{ contact_id: 301, memory_type: 'district', value: { district: 'Comas' }, occurred_at: '2026-10-30T10:00:00Z' }, { contact_id: 302, memory_type: 'district', value: { district: 'Ate' }, occurred_at: '2026-10-30T10:00:00Z' }] };
    throw new Error('unexpected path ' + path);
  };
  const rows = await getUnifiedContactContexts({ supabase, contactIds: [301, 302, 301] });
  assert.equal(calls.length, 3);
  assert.deepEqual(rows.map(row => [row.contact_id, row.identity.phone, row.memory.district?.district]), [[301, '955301001', 'Comas'], [302, '955302002', 'Ate']]);
  assert.equal(calls.every(path => !/whatsapp_messages|ai_message_analysis|gemini|agenda/i.test(path)), true);
});
