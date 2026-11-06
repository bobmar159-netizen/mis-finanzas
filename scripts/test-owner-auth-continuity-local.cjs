'use strict';

const assert = require('node:assert/strict');
const { authenticatedOwnerIdentity, authenticatedPreviewOwner } = require('../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-owner-ui-auth');

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const CONFIG = { supabaseUrl: 'https://uevilhbstnmmdlgyshlv.supabase.co', supabaseKey: 'isolated-service-key', ownerAccountId: UUID };
const TOKEN = 'synthetic-access-token';
function req(token = TOKEN) { return { headers: token === null ? {} : { authorization: `Bearer ${token}` } }; }
function response(ok, body = { id: UUID }) { return { ok, json: async () => body }; }
function authFetch(statuses, calls) { let index = 0; return async (url, init) => { calls.push({ url, authorization: init?.headers?.Authorization, apikey: init?.headers?.apikey }); return response(statuses[index++] !== false); }; }
const results = [];
async function test(name, fn) { try { await fn(); results.push({ name, status: 'PASS' }); } catch (error) { results.push({ name, status: 'FAIL', error: error.message }); } }

(async () => {
  await test('una solicitud válida conserva exactamente el Bearer recibido', async () => {
    const calls = []; const result = await authenticatedOwnerIdentity(req(), CONFIG, authFetch([true], calls));
    assert.equal(result.ok, true); assert.equal(calls.length, 1); assert.equal(calls[0].url, 'https://uevilhbstnmmdlgyshlv.supabase.co/auth/v1/user'); assert.equal(calls[0].authorization, `Bearer ${TOKEN}`); assert.equal(calls[0].apikey, CONFIG.supabaseKey);
  });
  await test('tres solicitudes consecutivas válidas conservan identidad estable', async () => {
    const calls = []; const fetchImpl = authFetch([true, true, true], calls); const values = []; for (let i = 0; i < 3; i += 1) values.push(await authenticatedOwnerIdentity(req(), CONFIG, fetchImpl));
    assert.equal(values.every(value => value.ok && value.user.id === UUID), true); assert.equal(calls.every(call => call.authorization === `Bearer ${TOKEN}`), true);
  });
  await test('dieciséis solicitudes consecutivas válidas no requieren estado de sesión en el handler', async () => {
    const calls = []; const fetchImpl = authFetch(Array(16).fill(true), calls); const values = []; for (let i = 0; i < 16; i += 1) values.push(await authenticatedOwnerIdentity(req(), CONFIG, fetchImpl));
    assert.equal(values.length, 16); assert.equal(values.every(value => value.ok && value.identity.kind === 'validated_auth_identity'), true); assert.equal(calls.length, 16); assert.equal(calls.every(call => call.authorization === `Bearer ${TOKEN}`), true);
  });
  await test('token inválido y token expirado siguen rechazados', async () => {
    const invalid = await authenticatedOwnerIdentity(req('invalid-token'), CONFIG, authFetch([false], [])); const expired = await authenticatedOwnerIdentity(req('expired-token'), CONFIG, authFetch([false], []));
    assert.deepEqual({ ok: invalid.ok, status: invalid.status, code: invalid.code }, { ok: false, status: 401, code: 'owner_reference_unauthorized' }); assert.deepEqual({ ok: expired.ok, status: expired.status, code: expired.code }, { ok: false, status: 401, code: 'owner_reference_unauthorized' });
  });
  await test('una sesión renovada es válida tras un token rechazado', async () => {
    const first = await authenticatedOwnerIdentity(req('expired-token'), CONFIG, authFetch([false], [])); const renewed = await authenticatedOwnerIdentity(req('fresh-token'), CONFIG, authFetch([true], []));
    assert.equal(first.ok, false); assert.equal(renewed.ok, true); assert.equal(renewed.user.id, UUID);
  });
  await test('sesión ausente no llega al servicio de Auth', async () => {
    let called = false; const result = await authenticatedOwnerIdentity(req(null), CONFIG, async () => { called = true; return response(true); });
    assert.equal(result.ok, false); assert.equal(result.status, 401); assert.equal(called, false);
  });
  await test('owner autenticado distinto sigue bloqueado en la capa de owner', async () => {
    const result = await authenticatedPreviewOwner(req(), CONFIG, async () => response(true, { id: '123e4567-e89b-42d3-a456-426614174001' }));
    assert.deepEqual({ ok: result.ok, status: result.status, code: result.code }, { ok: false, status: 403, code: 'owner_ui_forbidden' });
  });
  const failed = results.filter(item => item.status === 'FAIL');
  process.stdout.write(JSON.stringify({ phase: 'owner_auth_continuity_local', result: failed.length ? 'FAIL' : 'PASS', passed: results.length - failed.length, total: results.length, failures: failed, network_calls: 0, gemini_calls: 0, commercial_actions: 0 }) + '\n');
  process.exitCode = failed.length ? 1 : 0;
})();
