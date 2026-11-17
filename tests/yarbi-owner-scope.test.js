'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCanonicalOwnerScopeResolver, createPaginatedCanonicalOwnerScopeResolver, verifiedOwnerId } = require('../lib/yarbi-owner-scope');
const { getAuthenticatedOwnerReferenceCandidates } = require('../lib/yarbi-owner-reference-candidates');

const OWNER_A = '11111111-1111-4111-8111-111111111111';
const OWNER_B = '22222222-2222-4222-8222-222222222222';

function store(calls, scoped = { [OWNER_A]: [11], [OWNER_B]: [21] }) {
  return async path => {
    calls.push(path);
    const owner = decodeURIComponent(path).match(/owner_account_id=eq\.([^&]+)/)?.[1];
    if (path.startsWith('/rest/v1/yarbi_owner_contact_scope')) {
      const params = new URL('https://scope.invalid' + path).searchParams;
      const limit = Number(params.get('limit') || 100);
      const cursor = Number(params.get('contact_id')?.match(/^gt\.(\d+)$/)?.[1] || 0);
      return { response: { ok: true }, data: (scoped[owner] || []).filter(contact_id => contact_id > cursor).slice(0, limit).map(contact_id => ({ contact_id })) };
    }
    if (path.startsWith('/rest/v1/crm_contacts')) {
      const ids = decodeURIComponent(path).match(/id=in\.\(([^)]+)\)/)?.[1] || '';
      const data = ids === '11' ? [{ id: 11, display_name: 'F3A-SCOPE-A', commercial_status: 'frio', latest_service: null, last_contact_at: '2026-11-01T12:00:00Z' }] : ids === '21' ? [{ id: 21, display_name: 'F3A-SCOPE-B', commercial_status: 'frio', latest_service: null, last_contact_at: '2026-11-01T12:00:00Z' }] : [];
      return { response: { ok: true }, data };
    }
    if (path.startsWith('/rest/v1/contact_identifiers') || path.startsWith('/rest/v1/yarbi_contact_operational_memory')) return { response: { ok: true }, data: [] };
    throw new Error('unexpected_path:' + path);
  };
}

test('scope canónico separa dos dueños con contactos de nombre equivalente', async () => {
  const calls = []; const resolver = createCanonicalOwnerScopeResolver({ supabase: store(calls) });
  const a = await resolver({ kind: 'validated_auth_identity', subject: OWNER_A });
  const b = await resolver({ kind: 'validated_auth_identity', subject: OWNER_B });
  assert.deepEqual(a.contact_ids, [11]); assert.deepEqual(b.contact_ids, [21]);
  assert.ok(calls.every(path => path.startsWith('/rest/v1/yarbi_owner_contact_scope')));
});

test('identidad no validada falla cerrada sin consultar', async () => {
  let calls = 0;
  await assert.rejects(() => createCanonicalOwnerScopeResolver({ supabase: async () => { calls += 1; return { response: { ok: true }, data: [] }; } })({ subject: OWNER_A }), /owner_identity_unverified/);
  assert.equal(calls, 0);
});

test('adaptador autenticado lee scope antes de contactos y nunca chats', async () => {
  const calls = [];
  const result = await getAuthenticatedOwnerReferenceCandidates({ supabase: store(calls), authenticatedIdentity: { kind: 'validated_auth_identity', subject: OWNER_A }, understanding: {}, timeZone: 'America/Lima' });
  assert.equal(result.outcome, 'candidates_found'); assert.deepEqual(result.candidates.map(row => row.contact_id), [11]);
  assert.match(calls[0], /yarbi_owner_contact_scope/);
  assert.equal(calls.some(path => /whatsapp_messages|ai_message_analysis/.test(path)), false);
});

test('scope vacío no filtra por nombres, teléfonos ni chats', async () => {
  const calls = [];
  const result = await getAuthenticatedOwnerReferenceCandidates({ supabase: store(calls, { [OWNER_A]: [] }), authenticatedIdentity: { kind: 'validated_auth_identity', subject: OWNER_A }, understanding: {}, timeZone: 'America/Lima' });
  assert.equal(result.outcome, 'owner_scope_empty'); assert.equal(calls.length, 1);
});

test('contrato exige un UUID de autenticación validada', () => {
  assert.equal(verifiedOwnerId({ kind: 'validated_auth_identity', subject: OWNER_A }), OWNER_A);
  assert.throws(() => verifiedOwnerId({ kind: 'validated_auth_identity', subject: 'client-supplied' }), /owner_identity_unverified/);
});

for (const count of [97, 500, 2000]) {
  test(`scope paginado conserva los ${count} contactos sin truncamiento`, async () => {
    const calls = [];
    const ids = Array.from({ length: count }, (_, index) => index + 1);
    const resolver = createPaginatedCanonicalOwnerScopeResolver({ supabase: store(calls, { [OWNER_A]: ids }) });
    const scope = await resolver({ kind:'validated_auth_identity', subject:OWNER_A });
    assert.equal(scope.contact_ids.length, count);
    assert.equal(scope.contact_ids.at(-1), count);
    assert.equal(scope.pagination.complete, true);
    assert.ok(calls.length >= Math.ceil(count / 500));
    assert.ok(calls.every(path => /contact_id=gt\.\d+/.test(path) && !path.includes('offset=')));
  });
}

test('scope paginado mantiene aislamiento entre propietarios', async () => {
  const calls = [];
  const resolver = createPaginatedCanonicalOwnerScopeResolver({ supabase: store(calls, { [OWNER_A]: [11, 12], [OWNER_B]: [21, 22] }) });
  const a = await resolver({ kind:'validated_auth_identity', subject:OWNER_A });
  const b = await resolver({ kind:'validated_auth_identity', subject:OWNER_B });
  assert.deepEqual(a.contact_ids, [11, 12]);
  assert.deepEqual(b.contact_ids, [21, 22]);
});
