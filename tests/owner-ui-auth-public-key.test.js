'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { authenticatedOwnerIdentity } = require('../lib/yarbi-owner-ui-auth');

const USER_ID = '11111111-1111-4111-8111-111111111111';

test('F04: la validación de sesión usa la publishable key sin revelar la secret key', async () => {
  let request = null;
  const result = await authenticatedOwnerIdentity(
    { headers: { authorization: 'Bearer synthetic-user-token' } },
    { supabaseUrl: 'https://uevilhbstnmmdlgyshlv.supabase.co', supabaseKey: 'server-secret-not-exposed', supabasePublishableKey: 'public-key-for-auth' },
    async (_url, options) => { request = options; return { ok: true, json: async () => ({ id: USER_ID }) }; }
  );
  assert.equal(result.ok, true);
  assert.equal(request.headers.apikey, 'public-key-for-auth');
  assert.equal(request.headers.Authorization, 'Bearer synthetic-user-token');
});

test('F04: un Bearer rechazado sigue sin autorizar CRM', async () => {
  const result = await authenticatedOwnerIdentity(
    { headers: { authorization: 'Bearer invalid-token' } },
    { supabaseUrl: 'https://uevilhbstnmmdlgyshlv.supabase.co', supabaseKey: 'server-key', supabasePublishableKey: 'public-key-for-auth' },
    async () => ({ ok: false, json: async () => ({}) })
  );
  assert.deepEqual(result, { ok: false, status: 401, code: 'owner_reference_unauthorized' });
});
