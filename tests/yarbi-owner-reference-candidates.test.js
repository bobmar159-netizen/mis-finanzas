'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { getOwnerReferenceCandidates, createFixtureOwnerScopeResolver, temporalRange } = require('../lib/yarbi-owner-reference-candidates');

const NOW = new Date('2026-11-01T15:00:00.000Z'); // 10:00 a. m. en Lima.
const OWNER_A = 'F3R-owner-A';
const OWNER_B = 'F3R-owner-B';
const ownerScopeResolver = createFixtureOwnerScopeResolver({
  [OWNER_A]: { owner_id: OWNER_A, contact_ids: Array.from({ length: 21 }, (_, index) => 701 + index), verification: 'fixture_owner_scope', provenance: 'F3R-test' },
  [OWNER_B]: { owner_id: OWNER_B, contact_ids: [901], verification: 'fixture_owner_scope', provenance: 'F3R-test' }
});
const contacts = [
  ...Array.from({ length: 20 }, (_, index) => ({ id: 701 + index, display_name: 'F3R-A-Reciente-' + index, commercial_status: 'tibio', latest_service: index === 4 ? 'punto_adicional' : 'reparacion', last_contact_at: new Date(Date.UTC(2026, 10, 1, 14 - (index % 5), 0, 0)).toISOString() })),
  { id: 721, display_name: 'F3R-A-Comas-Antiguo', commercial_status: 'frio', latest_service: 'punto_adicional', last_contact_at: '2026-09-26T15:00:00.000Z' },
  { id: 901, display_name: 'F3R-B-MismoNombre', commercial_status: 'caliente', latest_service: 'instalacion_nueva', last_contact_at: '2026-11-01T15:00:00.000Z' }
];
const identifiers = contacts.map((contact, index) => ({ contact_id: contact.id, identifier_type: 'phone', identifier_value: '955000' + String(index + 1).padStart(2, '0'), normalized_value: '955000' + String(index + 1).padStart(2, '0'), is_primary: true }));
const memory = [
  ...contacts.filter(row => row.id >= 701 && row.id <= 720).map(row => ({ contact_id: row.id, memory_type: 'district', value: { district: 'Ate' }, occurred_at: NOW.toISOString() })),
  { contact_id: 721, memory_type: 'district', value: { district: 'Comas' }, occurred_at: NOW.toISOString() },
  { contact_id: 901, memory_type: 'district', value: { district: 'Comas' }, occurred_at: NOW.toISOString() },
  { contact_id: 701, memory_type: 'location', value: { label: 'F3R-Ate' }, occurred_at: NOW.toISOString() }
];

function idsIn(path) {
  const matched = decodeURIComponent(path).match(/contact_id=in\.\(([^)]+)\)|id=in\.\(([^)]+)\)/);
  return new Set((matched?.[1] || matched?.[2] || '').split(',').map(Number).filter(Boolean));
}
function fakeStore(calls) {
  return async path => {
    calls.push(path);
    const decoded = decodeURIComponent(path);
    if (path.startsWith('/rest/v1/yarbi_contact_operational_memory')) {
      const permitted = idsIn(path);
      let data = memory.filter(row => permitted.has(row.contact_id));
      const district = decoded.match(/value->>district=eq\.([^&]+)/)?.[1];
      if (district) data = data.filter(row => row.memory_type === 'district' && row.value.district === district);
      return { response: { ok: true }, data };
    }
    if (path.startsWith('/rest/v1/contact_identifiers')) {
      const permitted = idsIn(path);
      let data = identifiers.filter(row => permitted.has(row.contact_id));
      const phone = decoded.match(/normalized_value=eq\.([^&]+)/)?.[1];
      if (phone) data = data.filter(row => row.normalized_value === phone);
      return { response: { ok: true }, data };
    }
    if (path.startsWith('/rest/v1/crm_contacts')) {
      const permitted = idsIn(path);
      let data = contacts.filter(row => permitted.has(row.id));
      const service = decoded.match(/latest_service=eq\.([^&]+)/)?.[1];
      if (service) data = data.filter(row => row.latest_service === service);
      const from = decoded.match(/last_contact_at=gte\.([^&]+)/)?.[1];
      const to = decoded.match(/last_contact_at=lt\.([^&]+)/)?.[1];
      if (from) data = data.filter(row => new Date(row.last_contact_at) >= new Date(from));
      if (to) data = data.filter(row => new Date(row.last_contact_at) < new Date(to));
      return { response: { ok: true }, data: data.sort((a, b) => b.last_contact_at.localeCompare(a.last_contact_at)).slice(0, 8) };
    }
    throw new Error('unexpected ' + path);
  };
}
async function find({ ownerId = OWNER_A, constraints = {}, temporal_clues = [], state = {}, resolver = ownerScopeResolver } = {}) {
  const calls = [];
  const result = await getOwnerReferenceCandidates({ supabase: fakeStore(calls), ownerId, ownerScopeResolver: resolver, understanding: { constraints, temporal_clues }, conversationState: state, now: NOW, timeZone: 'America/Lima' });
  return { result, calls };
}

test('A: dos dueños con nombre equivalente nunca se mezclan', async () => {
  const a = await find({ constraints: { name: { value: 'F3R-A', certainty: 'confirmed' } } });
  const b = await find({ ownerId: OWNER_B, constraints: { name: { value: 'MismoNombre', certainty: 'confirmed' } } });
  assert.ok(a.result.candidates.every(row => row.contact_id !== 901));
  assert.deepEqual(b.result.candidates.map(row => row.contact_id), [901]);
});
test('B: owner scope ausente falla cerrado antes de consultar', async () => {
  let calls = 0;
  const result = await getOwnerReferenceCandidates({ supabase: async () => { calls += 1; return { response: { ok: true }, data: [] }; }, ownerId: OWNER_A, understanding: {} });
  assert.equal(result.outcome, 'owner_scope_unavailable'); assert.equal(calls, 0);
});
test('C: distrito se filtra en memoria antes del límite final', async () => {
  const { result, calls } = await find({ constraints: { district: { value: 'Comas', certainty: 'confirmed' } } });
  assert.deepEqual(result.candidates.map(row => row.contact_id), [721]);
  assert.match(decodeURIComponent(calls[0]), /memory_type=eq\.district/);
  assert.match(decodeURIComponent(calls[0]), /value->>district=eq\.Comas/);
  assert.match(decodeURIComponent(calls[1]), /id=in\.\(721\)/);
});
test('D: servicio se filtra en almacenamiento antes del límite', async () => {
  const { result, calls } = await find({ constraints: { service: { value: 'punto_adicional', certainty: 'confirmed' } } });
  assert.ok(result.candidates.every(row => row.service === 'punto_adicional'));
  assert.match(decodeURIComponent(calls[0]), /latest_service=eq\.punto_adicional/);
});
test('E: esta mañana es una ventana intradía local explícita', async () => {
  const { result, calls } = await find({ temporal_clues: [{ days: 0, day_part: 'morning', certainty: 'confirmed' }] });
  assert.ok(result.candidates.every(row => new Date(row.last_contact_at) >= new Date('2026-11-01T11:00:00Z') && new Date(row.last_contact_at) < new Date('2026-11-01T17:00:00Z')));
  assert.match(decodeURIComponent(calls[0]), /last_contact_at=gte\.2026-11-01T11:00:00.000Z/);
});
test('F: anoche usa la noche del día local anterior', () => {
  const range = temporalRange({}, { temporal_clues: [{ days: 1, day_part: 'night', certainty: 'confirmed' }] }, NOW, 'America/Lima');
  assert.equal(range.from, '2026-10-31T23:00:00.000Z'); assert.equal(range.to, '2026-11-01T05:00:00.000Z');
});
test('G: hace como un mes conserva tolerancia aproximada', () => {
  const range = temporalRange({ recency: { days: 30, certainty: 'approximate' } }, {}, NOW, 'America/Lima');
  assert.ok(new Date(range.from) <= new Date('2026-09-11T15:00:00Z')); assert.ok(new Date(range.to) >= new Date('2026-10-23T15:00:00Z'));
});
test('H: segunda pista de mañana reutiliza candidatos activos y hace cero consultas', async () => {
  const active = { verified_owner_scope: { owner_id: OWNER_A, contact_ids: [701], verification: 'fixture_owner_scope', reuse_allowed: true }, active_candidates: [{ contact_id: 701, display_name: 'F3R-A-Reciente-0', last_contact_at: '2026-11-01T14:00:00.000Z' }] };
  const result = await getOwnerReferenceCandidates({ ownerId: OWNER_A, understanding: { temporal_clues: [{ days: 0, day_part: 'morning' }] }, conversationState: active, now: NOW, timeZone: 'America/Lima' });
  assert.equal(result.outcome, 'reused_conversation_candidates'); assert.equal(result.metrics.query_count, 0);
});
test('I: teléfono exacto sigue siendo ruta fuerte y acotada', async () => {
  const calls = []; const result = await getOwnerReferenceCandidates({ supabase: fakeStore(calls), ownerId: OWNER_A, ownerScopeResolver, understanding: { constraints: { phone: identifiers[0].normalized_value } }, now: NOW, timeZone: 'America/Lima' });
  assert.deepEqual(result.candidates.map(row => row.contact_id), [701]); assert.match(calls[0], /contact_identifiers/);
});
test('J: no se leen chats completos', async () => { const { calls } = await find({ constraints: { name: { value: 'F3R-A', certainty: 'confirmed' } } }); assert.equal(calls.some(path => /whatsapp_messages/.test(path)), false); });
test('K: no hay egress fuera del adaptador Supabase inyectado', async () => { const { calls } = await find({}); assert.ok(calls.every(path => path.startsWith('/rest/v1/'))); });
test('L: límite, timezone obligatoria y regresión de contrato', async () => {
  const missingZone = await getOwnerReferenceCandidates({ supabase: fakeStore([]), ownerId: OWNER_A, ownerScopeResolver, understanding: { temporal_clues: [{ days: 0, day_part: 'morning' }] }, now: NOW });
  assert.equal(missingZone.outcome, 'timezone_required'); const { result } = await find({}); assert.ok(result.candidates.length <= 8);
});
