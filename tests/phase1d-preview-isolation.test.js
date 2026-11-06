const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { decidePreviewAuditRequest, validPreviewAuditConfig } = require('../lib/preview-audit-policy');
const { executeSyntheticTrace } = require('../lib/preview-audit-synthetic');

const root = path.join(__dirname, '..');
const previewRef = 'abcdefghijklmnopqrst';

function env(overrides = {}) {
  return {
    VERCEL_ENV: 'preview',
    YARBI_PREVIEW_AUDIT_ONLY: 'true',
    YARBI_PREVIEW_SUPABASE_PROJECT_REF: previewRef,
    SUPABASE_URL: `https://${previewRef}.supabase.co`,
    SUPABASE_SECRET_KEY: 's'.repeat(40),
    YARBI_TRACE_HMAC_KEY: 't'.repeat(40),
    YARBI_AUDIT_TOKEN: 'a'.repeat(40),
    ENABLE_LEGACY_WEBHOOK_EXTRACTION: 'false',
    ...overrides
  };
}

function request(pathname, method = 'POST', token = '') {
  return {
    url: `https://preview.example${pathname}`,
    method,
    headers: token ? { 'x-yarbi-audit-token': token } : {}
  };
}

test('Fase 1D: producción permanece inalterada cuando el modo auditoría está apagado', () => {
  const decision = decidePreviewAuditRequest(request('/api/webhook', 'POST'), { VERCEL_ENV: 'production', YARBI_PREVIEW_AUDIT_ONLY: 'false' });
  assert.equal(decision.allow, true);
  assert.equal(decision.code, 'audit_preview_inactive');
});

test('Fase 1D: cualquier preview sin modo auditoría explícito falla cerrado', () => {
  const decision = decidePreviewAuditRequest(request('/api/webhook', 'POST'), { VERCEL_ENV: 'preview' });
  assert.equal(decision.allow, false);
  assert.equal(decision.status, 503);
  assert.equal(decision.code, 'audit_preview_mode_required');
});

test('Fase 1D: el modo auditoría falla cerrado si faltan variables obligatorias', () => {
  const decision = decidePreviewAuditRequest(request('/api/audit/trace', 'POST'), env({ YARBI_TRACE_HMAC_KEY: '' }));
  assert.equal(decision.allow, false);
  assert.equal(decision.status, 503);
  assert.equal(decision.code, 'audit_preview_trace_hmac_missing');
});

test('Fase 1D: una URL o referencia de Supabase producción no es válida en preview', () => {
  const productionUrl = decidePreviewAuditRequest(request('/api/audit/trace', 'POST'), env({ SUPABASE_URL: 'https://haifktjvyhbsazmiyqps.supabase.co' }));
  assert.equal(productionUrl.allow, false);
  assert.equal(productionUrl.code, 'audit_preview_supabase_url_not_authorized');
  const productionRef = validPreviewAuditConfig(env({ YARBI_PREVIEW_SUPABASE_PROJECT_REF: 'haifktjvyhbsazmiyqps', SUPABASE_URL: 'https://haifktjvyhbsazmiyqps.supabase.co' }));
  assert.equal(productionRef.valid, false);
  assert.equal(productionRef.code, 'audit_preview_project_ref_is_production');
});

test('Fase 1D: una clave de Supabase claramente inválida falla antes de cualquier ruta', () => {
  const decision = decidePreviewAuditRequest(request('/api/audit/trace', 'POST'), env({ SUPABASE_SECRET_KEY: 'corta' }));
  assert.equal(decision.allow, false);
  assert.equal(decision.code, 'audit_preview_supabase_key_invalid');
});

test('Fase 1D: credenciales de integraciones externas invalidan el modo auditoría', () => {
  const decision = decidePreviewAuditRequest(request('/api/audit/trace', 'POST', 'a'.repeat(40)), env({ GEMINI_API_KEY: 'not-allowed-in-preview' }));
  assert.equal(decision.allow, false);
  assert.match(decision.code, /^audit_preview_external_integration_forbidden:GEMINI_API_KEY$/);
});

test('Fase 1D: webhook y mutaciones empresariales se bloquean antes del handler', () => {
  const token = 'a'.repeat(40);
  for (const pathname of ['/api/webhook', '/api/whatsapp/messages', '/api/actions/approve', '/api/assistant/send-whatsapp', '/api/assistant/scheduled-followups', '/api/ai/process', '/api/no-existe']) {
    const decision = decidePreviewAuditRequest(request(pathname, 'POST', token), env());
    assert.equal(decision.allow, false, pathname);
    assert.equal(decision.status, 403, pathname);
    assert.equal(decision.code, 'audit_preview_route_blocked', pathname);
  }
});

test('Fase 1D: endpoint auditoría exige POST y autenticación exacta', () => {
  const noToken = decidePreviewAuditRequest(request('/api/audit/trace'), env());
  assert.equal(noToken.allow, false);
  assert.equal(noToken.status, 401);
  const invalid = decidePreviewAuditRequest(request('/api/audit/trace', 'POST', 'b'.repeat(40)), env());
  assert.equal(invalid.allow, false);
  assert.equal(invalid.status, 401);
  const wrongMethod = decidePreviewAuditRequest(request('/api/audit/trace', 'GET', 'a'.repeat(40)), env());
  assert.equal(wrongMethod.allow, false);
  assert.equal(wrongMethod.status, 405);
});

test('Fase 1D: acceso legítimo permite únicamente la auditoría sintética', () => {
  const decision = decidePreviewAuditRequest(request('/api/audit/trace', 'POST', 'a'.repeat(40)), env());
  assert.equal(decision.allow, true);
  assert.equal(decision.code, 'audit_preview_allowed');
  assert.equal(decision.config.config.supabaseProjectRef, previewRef);
});

test('Fase 1D: prueba sintética ejecuta 20 eventos, deduplica y no incluye PII', async () => {
  const rows = new Map();
  const record = async event => {
    if (rows.has(event.event_id)) return { ok: true, inserted: false, duplicate: true, event_id: event.event_id };
    rows.set(event.event_id, event);
    return { ok: true, inserted: true, duplicate: false, event_id: event.event_id };
  };
  let ticks = 0;
  const output = await executeSyntheticTrace({
    secret: 't'.repeat(40),
    record,
    runId: 'local-test-only',
    now: () => ++ticks
  });
  assert.equal(rows.size, 20);
  assert.equal(output.completed_event_count, 20);
  assert.equal(output.duplicate.duplicate, true);
  assert.equal(output.reconstruction.event_count, 20);
  assert.equal(output.reconstruction.global_status, 'open');
  assert.equal(output.duration_ms, 1);
  const serialized = JSON.stringify(output.events);
  assert.doesNotMatch(serialized, /\b\d{9,}\b|hola|cliente|AIza|Bearer/i);
});

test('Fase 1D: el proxy cubre todas las rutas /api antes de las Functions', () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.equal(vercel.proxy.entrypoint, 'proxy.js');
  assert.deepEqual(vercel.proxy.matcher, ['/api/:path*']);
  const proxy = fs.readFileSync(path.join(root, 'proxy.js'), 'utf8');
  // Fase 2D.1 añade un selector común: en modo audit-only sigue delegando
  // exactamente a decidePreviewAuditRequest, pero el proxy ya no la llama
  // de forma directa.
  assert.match(proxy, /decidePreviewRouteRequest/);
  assert.match(proxy, /new Response/);
});
