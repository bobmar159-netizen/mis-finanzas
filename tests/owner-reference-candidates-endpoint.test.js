'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { decidePreviewOwnerReferenceRequest } = require('../lib/preview-owner-reference-policy');

const OWNER_A = '00000000-0000-4000-8000-0000000000a1';
const OWNER_B = '00000000-0000-4000-8000-0000000000b2';
const OWNER_EMPTY = '00000000-0000-4000-8000-0000000000c3';
const ENV = {
  VERCEL_ENV: 'preview',
  YARBI_PREVIEW_OWNER_REFERENCES_ONLY: 'true',
  YARBI_PREVIEW_SUPABASE_PROJECT_REF: 'uevilhbstnmmdlgyshlv',
  SUPABASE_URL: 'https://uevilhbstnmmdlgyshlv.supabase.co',
  SUPABASE_SECRET_KEY: 'isolated-service-key-not-real-123456789012345678',
  YARBI_TRACE_HMAC_KEY: 'trace-hmac-isolated-not-real-123456789012345678'
};
const contacts = [
  { id: 101, display_name: 'F3REF-Mismo Nombre', commercial_status: 'tibio', latest_service: 'reparacion', last_contact_at: '2026-11-01T15:00:00.000Z' },
  { id: 202, display_name: 'F3REF-Mismo Nombre', commercial_status: 'caliente', latest_service: 'instalacion_nueva', last_contact_at: '2026-11-01T15:01:00.000Z' }
];
const identifiers = [
  { contact_id: 101, identifier_type: 'phone', identifier_value: '900000101', normalized_value: '900000101', is_primary: true },
  { contact_id: 202, identifier_type: 'phone', identifier_value: '900000202', normalized_value: '900000202', is_primary: true }
];
const memory = [
  { contact_id: 101, memory_type: 'district', value: { district: 'Comas' }, occurred_at: '2026-11-01T15:00:00.000Z' },
  { contact_id: 202, memory_type: 'district', value: { district: 'Ate' }, occurred_at: '2026-11-01T15:01:00.000Z' }
];

function responseBox() { let statusCode; let body; return { status(value) { statusCode = value; return this; }, json(value) { body = value; return this; }, get value() { return { statusCode, body }; } }; }
function setEnv() {
  const keys = [...Object.keys(ENV), 'YARBI_PREVIEW_AUDIT_ONLY', 'YARBI_PREVIEW_FUNCTIONAL_SYNTHETIC_ONLY', 'YARBI_PREVIEW_PROACTIVE_LOOP_ONLY', 'YARBI_PREVIEW_OWNER_ACTION_ONLY', 'YARBI_PREVIEW_OWNER_UI_ONLY'];
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(ENV)) process.env[key] = value;
  for (const key of keys.slice(Object.keys(ENV).length)) delete process.env[key];
  return () => Object.entries(before).forEach(([key, value]) => value === undefined ? delete process.env[key] : process.env[key] = value);
}
function idsFrom(url) { const value = decodeURIComponent(url).match(/(?:contact_id|id)=in\.\(([^)]+)\)/)?.[1] || ''; return new Set(value.split(',').map(Number).filter(Boolean)); }
function ownerFrom(url) { return decodeURIComponent(url).match(/owner_account_id=eq\.([^&]+)/)?.[1] || ''; }
function tokenOwner(options) { const value = options?.headers?.Authorization || ''; return value === 'Bearer jwt-owner-a' ? OWNER_A : value === 'Bearer jwt-owner-b' ? OWNER_B : value === 'Bearer jwt-empty' ? OWNER_EMPTY : null; }
function mockFetch(calls, ledger) {
  return async (rawUrl, options = {}) => {
    const url = String(rawUrl); calls.push({ url, method: options.method || 'GET' });
    assert.equal(new URL(url).hostname, 'uevilhbstnmmdlgyshlv.supabase.co', 'sin egress fuera de Supabase aislado');
    if (url.includes('/auth/v1/user')) {
      const id = tokenOwner(options); return new Response(JSON.stringify(id ? { id } : { error: 'invalid' }), { status: id ? 200 : 401 });
    }
    if (url.includes('/rest/v1/yarbi_agent_actions')) {
      if (options.method === 'POST') { const row = JSON.parse(options.body)[0]; ledger.push(row); return new Response(JSON.stringify([row]), { status: 201 }); }
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (url.includes('/rest/v1/yarbi_owner_contact_scope')) {
      const owner = ownerFrom(url); const rows = owner === OWNER_A ? [{ contact_id: 101 }] : owner === OWNER_B ? [{ contact_id: 202 }] : [];
      return new Response(JSON.stringify(rows), { status: 200 });
    }
    if (url.includes('/rest/v1/crm_contacts')) {
      const ids = idsFrom(url); return new Response(JSON.stringify(contacts.filter(row => ids.has(row.id))), { status: 200 });
    }
    if (url.includes('/rest/v1/contact_identifiers')) {
      const ids = idsFrom(url); return new Response(JSON.stringify(identifiers.filter(row => ids.has(row.contact_id))), { status: 200 });
    }
    if (url.includes('/rest/v1/yarbi_contact_operational_memory')) {
      const ids = idsFrom(url); return new Response(JSON.stringify(memory.filter(row => ids.has(row.contact_id))), { status: 200 });
    }
    throw new Error('unexpected isolated request ' + url);
  };
}
async function invoke({ token = 'jwt-owner-a', body = { understanding: { constraints: { name: { value: 'F3REF-Mismo Nombre', certainty: 'confirmed' } } } } } = {}) {
  const restore = setEnv(); const original = global.fetch; const calls = []; const ledger = [];
  try {
    global.fetch = mockFetch(calls, ledger);
    const handler = require('../api_handlers/assistant/reference-candidates'); const res = responseBox();
    await handler({ method: 'POST', url: '/api/assistant/reference-candidates', headers: { authorization: 'Bearer ' + token }, body }, res);
    return { ...res.value, calls, ledger };
  } finally { global.fetch = original; restore(); }
}

test('A/B: sesión autenticada obtiene solamente candidatos de su scope canónico y cierra traza', async () => {
  const a = await invoke(); const b = await invoke({ token: 'jwt-owner-b' });
  assert.equal(a.statusCode, 200); assert.equal(b.statusCode, 200);
  assert.deepEqual(a.body.candidates.map(row => row.contact_id), [101]);
  assert.deepEqual(b.body.candidates.map(row => row.contact_id), [202]);
  assert.equal(a.body.execute, false); assert.equal(a.body.schema, 'yarbi.authenticated-reference-response.v1');
  assert.equal(a.ledger.filter(row => row.result_payload?.stage === 'operation_closed').length, 1);
  assert.equal(a.calls.every(call => call.url.startsWith('https://uevilhbstnmmdlgyshlv.supabase.co/')), true);
  assert.equal(JSON.stringify(a.body).includes(ENV.SUPABASE_SECRET_KEY), false);
});

test('C/D/E: teléfono exacto conserva el scope, sesión inválida falla y scope vacío no filtra datos ajenos', async () => {
  const exact = await invoke({ body: { understanding: { constraints: { phone: '900000101' } } } });
  assert.equal(exact.statusCode, 200); assert.equal(exact.body.execute, false); assert.deepEqual(exact.body.candidates.map(row => row.contact_id), [101]);
  const absent = await invoke({ body: { understanding: { constraints: { phone: '999999999' } } } });
  assert.equal(absent.statusCode, 200); assert.equal(absent.body.execute, false); assert.equal(absent.body.candidate_outcome, 'no_candidates');
  const invalid = await invoke({ token: 'not-a-jwt' }); assert.equal(invalid.statusCode, 401);
  const empty = await invoke({ token: 'jwt-empty' }); assert.equal(empty.statusCode, 200); assert.equal(empty.body.execute, false); assert.equal(empty.body.candidate_outcome, 'owner_scope_empty'); assert.deepEqual(empty.body.candidates, []);
});

test('F/G: el cliente no puede aportar owner_id/scope ni activar reutilización de candidatos', async () => {
  const rejected = await invoke({ body: { owner_id: OWNER_B, understanding: {} } });
  assert.equal(rejected.statusCode, 400); assert.equal(rejected.body.error, 'owner_scope_client_input_forbidden');
  const injected = await invoke({ body: { conversation_state: { verified_owner_scope: { owner_id: OWNER_B, contact_ids: [202] }, active_candidates: [{ contact_id: 202 }] }, understanding: { constraints: { name: { value: 'F3REF-Mismo Nombre', certainty: 'confirmed' } } } } });
  assert.equal(injected.statusCode, 400); assert.equal(injected.body.error, 'owner_scope_client_input_forbidden');
});

test('H/I: la ruta está limitada a Preview, POST y a un bearer; otras rutas no llegan al handler', () => {
  assert.equal(decidePreviewOwnerReferenceRequest({ method: 'GET', url: '/api/assistant/reference-candidates', headers: { authorization: 'Bearer jwt-owner-a' } }, ENV).allow, false);
  assert.equal(decidePreviewOwnerReferenceRequest({ method: 'POST', url: '/api/assistant/owner-inbox', headers: { authorization: 'Bearer jwt-owner-a' } }, ENV).allow, false);
  assert.equal(decidePreviewOwnerReferenceRequest({ method: 'POST', url: '/api/assistant/reference-candidates', headers: {} }, ENV).status, 401);
  const prod = { ...ENV, VERCEL_ENV: 'production' };
  assert.equal(decidePreviewOwnerReferenceRequest({ method: 'POST', url: '/api/assistant/reference-candidates', headers: { authorization: 'Bearer jwt-owner-a' } }, prod).allow, false);
});

test('auth-config: únicamente el bootstrap público exacto queda disponible en Preview aislado', () => {
  const allowed = decidePreviewOwnerReferenceRequest({ method: 'GET', url: '/api/assistant/preferences?action=auth-config', headers: {} }, ENV);
  assert.equal(allowed.allow, true);
  assert.equal(allowed.code, 'owner_reference_preview_auth_config_allowed');
  assert.equal(decidePreviewOwnerReferenceRequest({ method: 'POST', url: '/api/assistant/preferences?action=auth-config', headers: {} }, ENV).allow, false);
  assert.equal(decidePreviewOwnerReferenceRequest({ method: 'GET', url: '/api/assistant/preferences?action=account-settings', headers: {} }, ENV).allow, false);
  assert.equal(decidePreviewOwnerReferenceRequest({ method: 'GET', url: '/api/assistant/preferences?action=auth-config&extra=1', headers: {} }, ENV).allow, false);
  assert.equal(decidePreviewOwnerReferenceRequest({ method: 'GET', url: '/api/assistant/preferences?action=auth-config', headers: {} }, { ...ENV, VERCEL_ENV: 'production' }).allow, false);
});

test('J: presupuesto local de lectura queda medido sin egress ni llamadas de IA', async () => {
  const samples = [];
  for (let index = 0; index < 20; index += 1) {
    const started = performance.now();
    const result = await invoke();
    samples.push(performance.now() - started);
    assert.equal(result.statusCode, 200);
    assert.equal(result.calls.some(call => /gemini|whatsapp|ycloud|googleapis|notion/i.test(call.url)), false);
  }
  const p95 = samples.slice().sort((left, right) => left - right)[Math.ceil(samples.length * 0.95) - 1];
  const p50 = samples.slice().sort((left, right) => left - right)[Math.ceil(samples.length * 0.5) - 1];
  console.log('FAST_LOCAL_MOCK_METRICS=' + JSON.stringify({ samples: samples.length, p50_ms: Number(p50.toFixed(3)), p95_ms: Number(p95.toFixed(3)), max_ms: Number(Math.max(...samples).toFixed(3)) }));
  assert.ok(p95 < 250, `p95 local inesperado: ${p95}ms`);
});
