const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const { createRequire } = require('node:module');

const { validateServerRouteConfig } = require('../lib/yarbi-runtime-config');

const ROOT = path.resolve(__dirname, '..');
const ISOLATED_REF = 'uevilhbstnmmdlgyshlv';
const DEPLOYMENT_HOST = 'p03-synthetic-preview.vercel.app';
const routes = [
  { file: 'api/actions/approve.js', processor: 'none' },
  { file: 'api/assistant/collections.js', stagedFile: 'api_handlers/assistant/collections.js', processor: 'none' },
  { file: 'api/assistant/command.js', stagedFile: 'api_handlers/assistant/command.js', processor: 'none' },
  { file: 'api/assistant/preferences.js', stagedFile: 'api_handlers/assistant/preferences.js', processor: 'none' },
  { file: 'api/assistant/scheduled-followups.js', stagedFile: 'api_handlers/assistant/scheduled-followups.js', processor: 'required' },
  { file: 'api/assistant/send-whatsapp.js', processor: 'optional' },
  { file: 'api/supabase-secure.js', processor: 'none' }
];

function configOptions(route, env) {
  return {
    env,
    requireProcessor: route.processor === 'required',
    optionalProcessor: route.processor === 'optional'
  };
}

function sourceFile(route) {
  return route.stagedFile || route.file;
}

function isolatedEnv(overrides = {}) {
  return {
    VERCEL_ENV: 'preview',
    YARBI_PREVIEW_AUDIT_ONLY: 'false',
    YARBI_PREVIEW_FUNCTIONAL_SYNTHETIC_ONLY: 'true',
    YARBI_PREVIEW_SUPABASE_PROJECT_REF: ISOLATED_REF,
    YARBI_PREVIEW_DEPLOYMENT_HOST: DEPLOYMENT_HOST,
    VERCEL_URL: DEPLOYMENT_HOST,
    SUPABASE_URL: `https://${ISOLATED_REF}.supabase.co`,
    SUPABASE_SECRET_KEY: 's'.repeat(40),
    YARBI_TRACE_HMAC_KEY: 'h'.repeat(40),
    ASSISTANT_API_TOKEN: 'a'.repeat(40),
    YARBI_PREVIEW_SYNTHETIC_TOKEN: 't'.repeat(40),
    AI_PROCESSOR_URL: `https://${DEPLOYMENT_HOST}`,
    ENABLE_LEGACY_WEBHOOK_EXTRACTION: 'false',
    ...overrides
  };
}

function developmentEnv(overrides = {}) {
  return {
    VERCEL_ENV: 'development',
    SUPABASE_URL: 'https://local-isolated.example.test',
    SUPABASE_SECRET_KEY: 'k'.repeat(40),
    AI_PROCESSOR_URL: 'https://local-processor.example.test',
    ...overrides
  };
}

function responseCapture() {
  return {
    code: 0,
    body: null,
    setHeader() {},
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
    end(body) { this.body = body; return this; }
  };
}

function loadRoute(route) {
  const file = path.join(ROOT, sourceFile(route));
  if (!/\bexport default\b/.test(fs.readFileSync(file, 'utf8'))) {
    delete require.cache[file];
    return require(file);
  }
  const source = fs.readFileSync(file, 'utf8')
    .replace(/^export const config\s*=/m, 'const config =')
    .replace('export default async function handler(req, res) {', 'async function handler(req, res) {')
    .concat('\nmodule.exports = handler;\n');
  const holder = { exports: {} };
  const wrapped = vm.runInThisContext(Module.wrap(source), { filename: file + '.p031.cjs' });
  wrapped.call(holder.exports, holder.exports, createRequire(file), holder, file, path.dirname(file));
  return holder.exports;
}

function requestFor(route, assistantToken) {
  if (route.file === 'api/assistant/preferences.js') return { method: 'GET', headers: {}, query: {}, body: null };
  if (route.file === 'api/assistant/scheduled-followups.js') return { method: 'POST', headers: { 'x-assistant-token': assistantToken }, query: {}, body: {} };
  return { method: 'POST', headers: { 'x-assistant-token': assistantToken }, query: {}, body: {} };
}

test('P0.3.1: las siete rutas aceptan configuración explícita y aislada', () => {
  for (const route of routes) {
    const result = validateServerRouteConfig(configOptions(route, isolatedEnv()));
    assert.equal(result.ok, true, route.file);
    assert.equal(result.supabaseUrl, `https://${ISOLATED_REF}.supabase.co`, route.file);
    if (route.processor !== 'none') assert.equal(result.processorUrl, `https://${DEPLOYMENT_HOST}`, route.file);
  }
});

test('P0.3.1: las siete rutas fallan cerradas ante configuración ausente o inválida', () => {
  for (const route of routes) {
    const missing = validateServerRouteConfig(configOptions(route, developmentEnv({ SUPABASE_URL: '' })));
    assert.deepEqual(missing, { ok: false, code: 'yarbi_config_supabase_url_missing' }, route.file + ': missing');
    const invalid = validateServerRouteConfig(configOptions(route, developmentEnv({ SUPABASE_URL: 'http://invalid.example.test' })));
    assert.deepEqual(invalid, { ok: false, code: 'yarbi_config_supabase_url_invalid' }, route.file + ': invalid');
    const keyMissing = validateServerRouteConfig(configOptions(route, developmentEnv({ SUPABASE_SECRET_KEY: '' })));
    assert.deepEqual(keyMissing, { ok: false, code: 'yarbi_config_supabase_key_missing' }, route.file + ': key missing');
    if (route.processor === 'required') {
      const processorMissing = validateServerRouteConfig({ env: developmentEnv({ AI_PROCESSOR_URL: '' }), requireProcessor: true });
      assert.deepEqual(processorMissing, { ok: false, code: 'yarbi_config_processor_url_missing' }, route.file + ': processor missing');
    }
  }
});

test('P0.3.1: Preview exige una configuración funcional explícita e impide Production', () => {
  for (const route of routes) {
    const missingPreview = validateServerRouteConfig(configOptions(route, developmentEnv({ VERCEL_ENV: 'preview' })));
    assert.deepEqual(missingPreview, { ok: false, code: 'yarbi_config_preview_mode_required' }, route.file + ': preview mode');
    const productionDestination = validateServerRouteConfig(configOptions(route, developmentEnv({ SUPABASE_URL: 'https://haifktjvyhbsazmiyqps.supabase.co' })));
    assert.deepEqual(productionDestination, { ok: false, code: 'yarbi_config_nonproduction_supabase_destination_forbidden' }, route.file + ': production destination');
  }
});

test('P0.3.1: no hay fallback literal activo y la guardia se evalúa antes del primer efecto', () => {
  const forbidden = /process\.env\.SUPABASE_URL\s*\|\|\s*['"]https:\/\/haifktjvyhbsazmiyqps\.supabase\.co/;
  const forbiddenBackend = /process\.env\.(?:AI_PROCESSOR_URL|APP_ORIGIN)\s*\|\|[^\n]*misfinanzas-backend\.vercel\.app/;
  for (const route of routes) {
    const source = fs.readFileSync(path.join(ROOT, sourceFile(route)), 'utf8');
    assert.doesNotMatch(source, forbidden, route.file + ': production Supabase fallback');
    assert.doesNotMatch(source, forbiddenBackend, route.file + ': production backend fallback');
    assert.match(source, /validateServerRouteConfig/, route.file + ': central policy import');
    const handlerStart = source.search(/(?:export default async function handler|module\.exports = async function handler)/);
    const guard = source.indexOf('validateServerRouteConfig', handlerStart + 1);
    const firstEffect = source.indexOf('fetch(', handlerStart + 1);
    assert.ok(handlerStart >= 0 && guard > handlerStart, route.file + ': handler guard');
    assert.ok(firstEffect < 0 || guard < firstEffect, route.file + ': guard before first handler effect');
  }
});

test('P0.3.1: el validador es puro y no realiza efectos secundarios cuando rechaza', () => {
  const originalFetch = global.fetch;
  let fetches = 0;
  global.fetch = async () => { fetches += 1; throw new Error('network must not be reached'); };
  try {
    for (const route of routes) {
      const result = validateServerRouteConfig(configOptions(route, isolatedEnv({ SUPABASE_SECRET_KEY: '' })));
      assert.equal(result.ok, false, route.file);
    }
    assert.equal(fetches, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test('P0.3.1: cada handler corta por configuración inválida antes de cualquier fetch', { concurrency: false }, async () => {
  const saved = {};
  const keys = ['VERCEL_ENV', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'ASSISTANT_API_TOKEN', 'TOKEN_API_DE_ASISTENTE', 'GEMINI_API_KEY'];
  for (const key of keys) saved[key] = process.env[key];
  const originalFetch = global.fetch;
  let fetches = 0;
  try {
    Object.assign(process.env, developmentEnv({ SUPABASE_URL: '', ASSISTANT_API_TOKEN: 'a'.repeat(40), GEMINI_API_KEY: 'g'.repeat(40) }));
    global.fetch = async () => { fetches += 1; throw new Error('network must not be reached'); };
    for (const route of routes) {
      const handler = loadRoute(route);
      const res = responseCapture();
      await handler(requestFor(route, process.env.ASSISTANT_API_TOKEN), res);
      assert.equal(res.code, 503, route.file);
      assert.equal(res.body?.error, 'configuration_invalid', route.file);
      assert.equal(res.body?.code, 'yarbi_config_supabase_url_missing', route.file);
    }
    assert.equal(fetches, 0);
  } finally {
    global.fetch = originalFetch;
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});
