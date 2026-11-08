const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  blockedOwnerInput, scopedContact, scopedFilter, authenticateScopedOwner
} = require('../lib/yarbi-authenticated-route');

const root = path.resolve(__dirname, '..');
const UUID_A = '11111111-1111-4111-8111-111111111111';

test('F02: el navegador no puede declarar owner ni scope propios', () => {
  assert.equal(blockedOwnerInput({ owner_id: UUID_A }), true);
  assert.equal(blockedOwnerInput({ filters: { contact_ids: [1, 2] } }), true);
  assert.equal(blockedOwnerInput({ query: 'Carlos', filters: { district: 'Surco' } }), false);
});

test('F02: el scope canónico separa contactos de propietarios', async () => {
  const config = { supabaseUrl: 'https://isolated.example.test', supabasePublishableKey: 'publishable' };
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/auth/v1/user')) return { ok: true, json: async () => ({ id: UUID_A }) };
    throw new Error('unexpected_auth_request');
  };
  const supabase = async pathName => ({
    response: { ok: true },
    data: String(pathName).includes(UUID_A) ? [{ contact_id: 11 }, { contact_id: 12 }] : []
  });
  const result = await authenticateScopedOwner({ headers: { authorization: 'Bearer session-a' } }, config, supabase, fetchImpl);
  assert.equal(result.ok, true);
  assert.equal(scopedContact(result.scope, 11), true);
  assert.equal(scopedContact(result.scope, 99), false);
  assert.equal(scopedFilter(result.scope), 'in.(11,12)');
});

test('F02: token compartido no sustituye una sesión Bearer', async () => {
  const config = { supabaseUrl: 'https://isolated.example.test', supabasePublishableKey: 'publishable' };
  const result = await authenticateScopedOwner({ headers: { 'x-assistant-token': 'legacy-shared-token' } }, config, async () => ({ response: { ok: true }, data: [] }), async () => { throw new Error('must_not_call_auth_without_bearer'); });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(result.code, 'owner_reference_unauthorized');
});

test('F02: rutas interactivas requieren identidad canónica, no ASSISTANT_TOKEN', () => {
  const routes = [
    'api_handlers/location/resolve.js',
    'api_handlers/assistant/collections.js',
    'api_handlers/assistant/preferences.js',
    'api_handlers/assistant/scheduled-followups.js',
    'api/actions/approve.js',
    'api/supabase-secure.js'
  ];
  for (const relative of routes) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    assert.match(source, /requirePublicAuth:\s*true/, relative);
    assert.doesNotMatch(source, /const ASSISTANT_TOKEN\s*=/, relative);
  }
});

test('F02: frontend descarta el secreto legado y adjunta sesión sólo a rutas migradas', () => {
  const frontend = fs.readFileSync(path.join(root, 'frontend', 'index.html'), 'utf8');
  assert.match(frontend, /GFC_SESSION_AUTH_ROUTES/);
  assert.match(frontend, /headers\.delete\('X-Assistant-Token'\)/);
  assert.match(frontend, /gfcAccountFreshAccessToken\(\)/);
  assert.match(frontend, /'fnz_' \+ 'assistant_token'/);
});
