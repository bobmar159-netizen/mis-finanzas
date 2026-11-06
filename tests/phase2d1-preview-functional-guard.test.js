const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { decidePreviewFunctionalRequest } = require('../lib/preview-functional-policy');
const { decidePreviewRouteRequest, invokeAfterPreviewGuard } = require('../lib/preview-route-policy');

const root = path.join(__dirname, '..');
const previewRef = 'uevilhbstnmmdlgyshlv';
const host = 'yarbi-f2d1-synthetic.vercel.app';
const token = 'p'.repeat(40);
const assistantToken = 'a'.repeat(40);

function env(overrides = {}) {
  return {
    VERCEL_ENV: 'preview',
    YARBI_PREVIEW_FUNCTIONAL_SYNTHETIC_ONLY: 'true',
    YARBI_PREVIEW_AUDIT_ONLY: 'false',
    YARBI_PREVIEW_SUPABASE_PROJECT_REF: previewRef,
    SUPABASE_URL: `https://${previewRef}.supabase.co`,
    SUPABASE_SECRET_KEY: 's'.repeat(40),
    YARBI_TRACE_HMAC_KEY: 't'.repeat(40),
    ASSISTANT_API_TOKEN: assistantToken,
    YARBI_PREVIEW_SYNTHETIC_TOKEN: token,
    YARBI_PREVIEW_DEPLOYMENT_HOST: host,
    AI_PROCESSOR_URL: `https://${host}`,
    VERCEL_URL: host,
    ENABLE_LEGACY_WEBHOOK_EXTRACTION: 'false',
    ...overrides
  };
}

function request(pathname, method = 'POST', headers = {}) {
  return { url: `https://${host}${pathname}`, method, headers };
}

function headers({ preview = token, assistant = '' } = {}) {
  return {
    ...(preview ? { 'x-yarbi-preview-token': preview } : {}),
    ...(assistant ? { 'x-assistant-token': assistant } : {})
  };
}

test('Fase 2D.1: rutas no permitidas no cargan el handler', async () => {
  let loaded = 0;
  for (const route of ['/api/assistant/send-whatsapp', '/api/audit/trace', '/api/no-existe']) {
    const outcome = await invokeAfterPreviewGuard(request(route, 'POST', headers()), env(), async () => { loaded += 1; return 'unexpected'; });
    assert.equal(outcome.decision.code, 'functional_preview_route_blocked');
    assert.equal(outcome.invoked, false);
  }
  assert.equal(loaded, 0);
});

test('Fase 2D.1: credenciales ausentes o inválidas fallan antes del handler', async () => {
  const missing = decidePreviewFunctionalRequest(request('/api/webhook', 'POST', headers()), env({ SUPABASE_SECRET_KEY: '' }));
  assert.equal(missing.allow, false);
  assert.equal(missing.code, 'functional_preview_supabase_key_invalid');
  const invalid = await invokeAfterPreviewGuard(request('/api/webhook', 'POST', headers({ preview: 'x'.repeat(40) })), env(), async () => { throw new Error('handler no debió cargarse'); });
  assert.equal(invalid.decision.code, 'functional_preview_unauthorized');
  assert.equal(invalid.invoked, false);
});

test('Fase 2D.1: producción y fallback histórico se rechazan', () => {
  const production = decidePreviewFunctionalRequest(request('/api/webhook', 'POST', headers()), env({ SUPABASE_URL: 'https://haifktjvyhbsazmiyqps.supabase.co' }));
  assert.equal(production.code, 'functional_preview_supabase_url_not_authorized');
  const missingProcessor = decidePreviewFunctionalRequest(request('/api/webhook', 'POST', headers()), env({ AI_PROCESSOR_URL: '' }));
  assert.equal(missingProcessor.code, 'functional_preview_processor_url_missing_or_invalid');
  const historical = decidePreviewFunctionalRequest(request('/api/webhook', 'POST', headers()), env({ YARBI_PREVIEW_DEPLOYMENT_HOST: 'misfinanzas-backend-omar-dfc4.vercel.app', AI_PROCESSOR_URL: 'https://misfinanzas-backend-omar-dfc4.vercel.app', VERCEL_URL: 'misfinanzas-backend-omar-dfc4.vercel.app' }));
  assert.equal(historical.code, 'functional_preview_processor_host_forbidden');
});

test('Fase 2D.1: integraciones externas y extracción legacy se rechazan', () => {
  const gemini = decidePreviewFunctionalRequest(request('/api/webhook', 'POST', headers()), env({ GEMINI_API_KEY: 'forbidden' }));
  assert.equal(gemini.code, 'functional_preview_external_integration_forbidden:GEMINI_API_KEY');
  const legacy = decidePreviewFunctionalRequest(request('/api/webhook', 'POST', headers()), env({ ENABLE_LEGACY_WEBHOOK_EXTRACTION: 'true' }));
  assert.equal(legacy.code, 'functional_preview_legacy_extraction_forbidden');
});

test('Fase 2D.1: solo webhook y procesador sintéticos con autenticación completa pasan', async () => {
  const webhook = await invokeAfterPreviewGuard(request('/api/webhook', 'POST', headers()), env(), async () => 'webhook-loaded');
  assert.equal(webhook.decision.code, 'functional_preview_allowed');
  assert.equal(webhook.invoked, true);
  assert.equal(webhook.value, 'webhook-loaded');
  const processor = await invokeAfterPreviewGuard(request('/api/ai/process', 'POST', headers({ assistant: assistantToken })), env(), async () => 'process-loaded');
  assert.equal(processor.decision.code, 'functional_preview_allowed');
  assert.equal(processor.invoked, true);
  const noAssistant = decidePreviewFunctionalRequest(request('/api/ai/process', 'POST', headers()), env());
  assert.equal(noAssistant.code, 'functional_preview_processor_unauthorized');
});

test('Fase 2D.1: audit-only mantiene su contrato y el proxy usa el selector común', () => {
  const auditEnv = {
    VERCEL_ENV: 'preview', YARBI_PREVIEW_AUDIT_ONLY: 'true',
    YARBI_PREVIEW_SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst',
    SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
    SUPABASE_SECRET_KEY: 's'.repeat(40), YARBI_TRACE_HMAC_KEY: 't'.repeat(40),
    YARBI_AUDIT_TOKEN: 'q'.repeat(40), ENABLE_LEGACY_WEBHOOK_EXTRACTION: 'false'
  };
  const audit = decidePreviewRouteRequest({ url: 'https://preview.example/api/audit/trace', method: 'POST', headers: { 'x-yarbi-audit-token': 'q'.repeat(40) } }, auditEnv);
  assert.equal(audit.allow, true);
  assert.equal(audit.code, 'audit_preview_allowed');
  const proxy = fs.readFileSync(path.join(root, 'proxy.js'), 'utf8');
  assert.match(proxy, /decidePreviewRouteRequest/);
});
