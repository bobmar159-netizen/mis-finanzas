'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const Module = require('node:module');
const { authenticateMetaWebhook, normalizeMetaReferral, summarizeMetaAttribution } = require('../lib/yarbi-meta-webhook');

const ROOT = path.resolve(__dirname, '..');
const HANDLER_PATH = path.join(ROOT, 'api', 'webhook.js');
const HOST = 'uevilhbstnmmdlgyshlv.supabase.co';
const SECRET = 'F3D-handler-test-secret-only-not-a-production-credential';
const token = () => crypto.randomBytes(32).toString('hex');

function signature(raw, timestamp = '1793372400') {
  return `t=${timestamp},s=${crypto.createHmac('sha256', SECRET).update(`${timestamp}.${raw}`, 'utf8').digest('hex')}`;
}

function loadHandler() {
  const marker = 'export default async function handler(req, res) {';
  const config = "export const config = { api: { bodyParser: false } };";
  const raw = fs.readFileSync(HANDLER_PATH, 'utf8');
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === '@vercel/functions') return { waitUntil: () => {} };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const isolated = new Module(HANDLER_PATH, module);
    isolated.filename = HANDLER_PATH;
    isolated.paths = Module._nodeModulePaths(path.dirname(HANDLER_PATH));
    isolated._compile(raw.replace(config, 'const config = { api: { bodyParser: false } };').replace(marker, 'async function handler(req, res) {') + '\nmodule.exports = handler;\n', HANDLER_PATH);
    return isolated.exports;
  } finally { Module._load = originalLoad; }
}

function response() {
  return { code: 0, body: null, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, send(body) { this.body = body; return this; }, end() {} };
}

function request(raw, headers = {}) {
  const req = Readable.from([Buffer.from(raw, 'utf8')]);
  req.method = 'POST';
  req.headers = headers;
  req.query = {};
  req.url = '/api/webhook';
  return req;
}

test('F3D handler rejects unsigned JSON before any network or commercial effect', async () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };
  try {
    Object.assign(process.env, { SUPABASE_URL: `https://${HOST}`, SUPABASE_SECRET_KEY: token(), AI_PROCESSOR_URL: 'https://f3d-local.vercel.app', YCLOUD_WEBHOOK_SECRET: SECRET, VERCEL_ENV: 'development' });
    global.fetch = async () => { throw new Error('network must not be reached'); };
    const handler = loadHandler();
    const res = response();
    await handler(request('{"id":"F3D-unsigned","type":"whatsapp.inbound_message.received"}'), res);
    assert.equal(res.code, 401);
    assert.equal(res.body.code, 'ycloud_signature_missing');
  } finally {
    global.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
  }
});

test('Meta webhook verifies raw-body HMAC and preserves only safe, provider-signed referral evidence', () => {
  const secret = 'local-meta-app-secret-for-tests';
  const rawBody = Buffer.from('{"object":"whatsapp_business_account"}', 'utf8');
  const signature = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  assert.equal(authenticateMetaWebhook({ rawBody, signatureHeader: signature, appSecret: secret }).authenticated, true);
  assert.equal(authenticateMetaWebhook({ rawBody, signatureHeader: signature, appSecret: 'wrong-secret' }).code, 'meta_webhook_signature_invalid');
  assert.equal(authenticateMetaWebhook({ rawBody, signatureHeader: signature, appSecret: '' }).code, 'meta_webhook_secret_missing');
  assert.equal(authenticateMetaWebhook({ rawBody, signatureHeader: 'sha256=bad', appSecret: secret }).authenticated, false);
  assert.equal(normalizeMetaReferral({ source_type: 'ad', source_id: 'ad-17', ctwa_clid: 'click-1', source_url: 'https://example.test/x' }, '1793372400').ad_id, 'ad-17');
  assert.equal(normalizeMetaReferral({ source_type: 'ad', source_id: 'ad-17', ctwa_clid: 'click-1', source_url: 'javascript:alert(1)' }, '1793372400').source_url, null);
  const summary = summarizeMetaAttribution([
    { id: 'm2', timestamp: 2000, metadata: { meta_attribution: { provider: 'meta', source_id: 'later' } } },
    { id: 'm1', timestamp: 1000, metadata: { meta_attribution: { provider: 'meta', source_id: 'first' } } }
  ]);
  assert.equal(summary.first_touch.message_id, 'm1');
  assert.equal(summary.last_touch.message_id, 'm2');
});

test('Meta WhatsApp webhook accepts valid HMAC, stores referral evidence, and rejects invalid HMAC before network', async () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };
  const metaSecret = 'local-meta-app-secret-for-route-test';
  const stored = [];
  try {
    Object.assign(process.env, { SUPABASE_URL: `https://${HOST}`, SUPABASE_SECRET_KEY: token(), AI_PROCESSOR_URL: 'https://f3d-local.vercel.app', META_APP_SECRET: metaSecret, VERCEL_ENV: 'development' });
    for (const key of ['ASSISTANT_API_TOKEN', 'GEMINI_API_KEY', 'GEMINI_KEY', 'META_ACCESS_TOKEN', 'WHATSAPP_TOKEN', 'YCLOUD_WEBHOOK_SECRET']) delete process.env[key];
    global.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      assert.equal(url.hostname, HOST, `unexpected external egress: ${url.hostname}`);
      const method = String(init.method || 'GET').toUpperCase();
      const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
      if (url.pathname === '/rest/v1/whatsapp_messages' && method === 'GET') return json(stored.some(row => row.id === new URLSearchParams(url.search).get('id')?.replace(/^eq\./, '')) ? [{ id: 'exists' }] : []);
      if (url.pathname === '/rest/v1/clients' && method === 'GET') return json([]);
      if (url.pathname === '/rest/v1/clients' && method === 'POST') return json([{ id: 412, name: 'Cliente WhatsApp' }], 201);
      if (url.pathname === '/rest/v1/whatsapp_messages' && method === 'POST') { stored.push(JSON.parse(init.body)[0]); return json([], 201); }
      if (url.pathname === '/rest/v1/messages' && method === 'POST') return json([], 201);
      throw new Error(`unexpected route: ${method} ${url.pathname}`);
    };
    const handler = loadHandler();
    const payload = { object: 'whatsapp_business_account', entry: [{ id: 'waba-1', changes: [{ field: 'messages', id: 'change-1', value: {
      contacts: [{ wa_id: '51955501010', profile: { name: 'Prueba local' } }],
      messages: [
        { id: 'wamid.meta-test-1', from: '51955501010', timestamp: '1793372400', type: 'text', text: { body: 'Consulta de prueba' }, referral: { source_type: 'ad', source_id: 'ad-synthetic-9', ctwa_clid: 'ctwa-synthetic-4', source_url: 'https://fb.me/test', headline: 'Anuncio sintético' } },
        { id: 'wamid.meta-test-2', from: '51955501010', timestamp: '1793372401', type: 'text', text: { body: 'Segundo mensaje de la misma entrega' } }
      ]
    } }] }] };
    const raw = JSON.stringify(payload);
    const metaSignature = 'sha256=' + crypto.createHmac('sha256', metaSecret).update(Buffer.from(raw)).digest('hex');
    const accepted = response();
    await handler(request(raw, { 'x-hub-signature-256': metaSignature }), accepted);
    assert.equal(accepted.code, 200);
    assert.equal(stored.length, 2);
    assert.equal(stored[0].metadata.provider, 'meta_cloud');
    assert.equal(stored[0].metadata.meta_attribution.ctwa_clid, 'ctwa-synthetic-4');
    assert.equal(stored[0].metadata.meta_attribution.ad_id, 'ad-synthetic-9');
    assert.equal(Object.hasOwn(stored[1].metadata, 'meta_attribution'), false);

    global.fetch = async () => { throw new Error('invalid signature must not reach network'); };
    const rejected = response();
    await handler(request(raw, { 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) }), rejected);
    assert.equal(rejected.code, 401);
    assert.equal(rejected.body.code, 'meta_webhook_signature_invalid');
  } finally {
    global.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
  }
});

test('F3D handler preserves raw bytes, accepts signed interactive YCloud once, and keeps signed free text unclassified', async () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };
  const attemptedHosts = [];
  const stored = [];
  const storedIds = new Set();
  try {
    Object.assign(process.env, { SUPABASE_URL: `https://${HOST}`, SUPABASE_SECRET_KEY: token(), AI_PROCESSOR_URL: 'https://f3d-local.vercel.app', YCLOUD_WEBHOOK_SECRET: SECRET, VERCEL_ENV: 'development' });
    for (const key of ['ASSISTANT_API_TOKEN', 'GEMINI_API_KEY', 'GEMINI_KEY', 'META_ACCESS_TOKEN', 'WHATSAPP_TOKEN', 'YCLOUD_API_KEY', 'YCLOUD_KEY', 'NOTION_TOKEN', 'FNZ_NOTION_TOKEN', 'GOOGLE_CALENDAR_CLIENT_EMAIL', 'GOOGLE_CALENDAR_PRIVATE_KEY']) delete process.env[key];
    global.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      attemptedHosts.push(url.hostname);
      assert.equal(url.hostname, HOST, `unexpected external egress: ${url.hostname}`);
      const method = String(init.method || 'GET').toUpperCase();
      const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
      if (url.pathname === '/rest/v1/whatsapp_messages' && method === 'GET') {
        const query = new URLSearchParams(url.search);
        const id = query.get('id')?.replace(/^eq\./, '') || '';
        const eventId = query.get('metadata->>ycloud_event_id')?.replace(/^eq\./, '') || '';
        return json(storedIds.has(id) || stored.some(row => row.metadata?.ycloud_event_id === eventId) ? [{ id: id || 'event-match' }] : []);
      }
      if (url.pathname === '/rest/v1/clients' && method === 'GET') return json([]);
      if (url.pathname === '/rest/v1/clients' && method === 'POST') return json([{ id: 301 }], 201);
      if (url.pathname === '/rest/v1/whatsapp_messages' && method === 'POST') {
        const row = JSON.parse(init.body)[0];
        stored.push(row);
        storedIds.add(row.id);
        return json([], 201);
      }
      if (url.pathname === '/rest/v1/messages' && method === 'POST') return json([], 201);
      throw new Error(`unexpected route: ${method} ${url.pathname}`);
    };
    const handler = loadHandler();
    const interactive = {
      id: 'F3D-event-interactive', type: 'whatsapp.inbound_message.received', createTime: '2026-10-30T15:00:00.000Z',
      whatsappInboundMessage: { id: 'F3D-message-interactive', from: '+51955300401', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'yarbi.commercial.v1.service.reparacion' } } }
    };
    const rawInteractive = JSON.stringify(interactive);
    const first = response();
    await handler(request(rawInteractive, { 'ycloud-signature': signature(rawInteractive) }), first);
    assert.equal(first.code, 200);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].metadata.commercial_context.service, 'reparacion');
    assert.equal(stored[0].metadata.commercial_context.event_id, 'F3D-event-interactive');

    const replay = response();
    await handler(request(rawInteractive, { 'ycloud-signature': signature(rawInteractive) }), replay);
    assert.equal(replay.body.status, 'duplicate_ignored');
    assert.equal(stored.length, 1);

    const sameProviderEvent = {
      ...interactive,
      whatsappInboundMessage: { ...interactive.whatsappInboundMessage, id: 'F3D-message-different-representation' }
    };
    const rawSameProviderEvent = JSON.stringify(sameProviderEvent);
    const sameProviderEventRes = response();
    await handler(request(rawSameProviderEvent, { 'ycloud-signature': signature(rawSameProviderEvent) }), sameProviderEventRes);
    assert.equal(sameProviderEventRes.body.status, 'duplicate_ignored');
    assert.equal(stored.length, 1);

    const freeText = {
      id: 'F3D-event-free-text', type: 'whatsapp.inbound_message.received', createTime: '2026-10-30T16:00:00.000Z',
      whatsappInboundMessage: { id: 'F3D-message-free-text', from: '+51955300402', type: 'text', text: { body: 'quiero instalación y visita' } }
    };
    const rawText = JSON.stringify(freeText);
    const textRes = response();
    await handler(request(rawText, { 'ycloud-signature': signature(rawText) }), textRes);
    assert.equal(textRes.code, 200);
    assert.equal(stored.length, 2);
    assert.equal(Object.hasOwn(stored[1].metadata, 'commercial_context'), false);
    assert.deepEqual([...new Set(attemptedHosts)], [HOST]);
  } finally {
    global.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
  }
});
