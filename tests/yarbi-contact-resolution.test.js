const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveOrCreateContactByPhone } = require('../lib/yarbi-contact-resolution');

test('identity resolver normalizes a Peruvian phone and returns an existing contact', async () => {
  const calls = [];
  const result = await resolveOrCreateContactByPhone({
    phone: '+51 955-411-248', messageId: 'F3A-existing-1', analysisId: 41,
    supabase: async (path, options) => {
      calls.push({ path, payload: JSON.parse(options.body) });
      return { response: { ok: true }, data: [{ contact_id: 22, outcome: 'resolved_existing' }] };
    }
  });
  assert.deepEqual(result, { outcome: 'resolved_existing', contact_id: 22, normalized_phone: '955411248' });
  assert.deepEqual(calls, [{
    path: '/rest/v1/rpc/resolve_or_create_contact_by_phone',
    payload: { p_phone: '955411248', p_message_id: 'F3A-existing-1', p_analysis_id: 41 }
  }]);
});

test('identity resolver returns a new contact outcome without fabricating a name', async () => {
  const result = await resolveOrCreateContactByPhone({
    phone: '955411248', messageId: 'F3A-new-1', analysisId: 42,
    supabase: async (_, options) => {
      const payload = JSON.parse(options.body);
      assert.equal(Object.hasOwn(payload, 'p_name'), false);
      return { response: { ok: true }, data: [{ contact_id: 23, outcome: 'created_new' }] };
    }
  });
  assert.equal(result.outcome, 'created_new');
  assert.equal(result.contact_id, 23);
});

test('identity resolver retains invalid phones as identity_pending and does not call storage', async () => {
  let calls = 0;
  const result = await resolveOrCreateContactByPhone({
    phone: 'sin telefono', messageId: 'F3A-invalid-1', analysisId: 43,
    supabase: async () => { calls += 1; throw new Error('must not run'); }
  });
  assert.deepEqual(result, { outcome: 'identity_pending', contact_id: null, normalized_phone: '' });
  assert.equal(calls, 0);
});

test('identity resolver surfaces a storage failure as identity_error', async () => {
  await assert.rejects(
    () => resolveOrCreateContactByPhone({
      phone: '955411248', messageId: 'F3A-error-1', analysisId: 44,
      supabase: async () => ({ response: { ok: false, status: 409 }, data: null })
    }),
    error => error.code === 'identity_resolution_failed'
  );
});
