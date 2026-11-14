'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createWhatsAppMessagesHandler } = require('../api/whatsapp/messages');
const { createDraftsHandler } = require('../api_handlers/assistant/drafts');
const { createNotionProxyHandler } = require('../api/notion-proxy');

const CONFIG = { ok: true, supabaseUrl: 'https://isolated.example.test', supabaseKey: 'synthetic-service-key', supabasePublishableKey: 'synthetic-public-key' };
const OWNER_A = { ok: true, scope: { owner_id: '11111111-1111-4111-8111-111111111111', contact_ids: [101] } };
const OWNER_B = { ok: true, scope: { owner_id: '22222222-2222-4222-8222-222222222222', contact_ids: [202] } };

function response() {
  return {
    statusCode: 0, body: null, headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; }
  };
}
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } }); }
function req({ method = 'GET', query = {}, body = {}, headers = {} } = {}) { return { method, query, body, headers, url: '/api/whatsapp/messages' }; }
function auth(result) { return async () => result; }

test('F02.1 rejects missing Bearer and a legacy header before WhatsApp reads', async () => {
  let reads = 0;
  const handler = createWhatsAppMessagesHandler({ configResolver: () => CONFIG, authenticate: auth({ ok: false, status: 401, code: 'owner_reference_unauthorized' }), fetchImpl: async () => { reads += 1; return json([]); } });
  const res = response();
  await handler(req({ headers: { 'x-assistant-token': 'legacy-only' } }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'owner_reference_unauthorized');
  assert.equal(reads, 0);
});

test('F02.1 scopes WhatsApp reads to canonical owner contacts and preserves pagination filters', async () => {
  let requested = '';
  const handler = createWhatsAppMessagesHandler({
    configResolver: () => CONFIG,
    authenticate: auth(OWNER_A),
    fetchImpl: async input => { requested = String(input); return json([{ id: 'F02A', contact_id: 101 }, { id: 'F02B', contact_id: 202 }]); }
  });
  const res = response();
  await handler(req({ query: { phone: '+51 999 111 222', from_timestamp: '1000', limit: '20', offset: '10', order: 'asc' }, headers: { authorization: 'Bearer synthetic-session' } }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.messages, [{ id: 'F02A', contact_id: 101 }]);
  const query = new URL(requested).searchParams;
  assert.equal(query.get('contact_id'), 'in.(101)');
  assert.equal(query.get('phone'), 'eq.51999111222');
  assert.equal(query.get('timestamp'), 'gte.1000');
  assert.equal(query.get('limit'), '20');
  assert.equal(query.get('offset'), '10');
  assert.equal(query.get('order'), 'timestamp.asc');
});

test('F02.1 rejects client supplied owner or contact scopes and owner B receives an independent filter', async () => {
  let requested = '';
  const handler = createWhatsAppMessagesHandler({ configResolver: () => CONFIG, authenticate: auth(OWNER_B), fetchImpl: async input => { requested = String(input); return json([{ id: 'F02B', contact_id: 202 }]); } });
  const manipulated = response();
  await handler(req({ query: { owner_id: OWNER_A.scope.owner_id, contact_ids: '101' } }), manipulated);
  assert.equal(manipulated.statusCode, 400);
  const scoped = response();
  await handler(req({ headers: { authorization: 'Bearer synthetic-session' } }), scoped);
  assert.equal(scoped.statusCode, 200);
  assert.equal(new URL(requested).searchParams.get('contact_id'), 'in.(202)');
  assert.deepEqual(scoped.body.messages.map(row => row.contact_id), [202]);
});

test('F02.1 drafts fail closed until contact_id exists in the legacy draft schema', async () => {
  let requested = '';
  const handler = createDraftsHandler({ configResolver: () => CONFIG, authenticate: auth(OWNER_A), fetchImpl: async input => { requested = String(input); return json({ code: '42703' }, 400); } });
  const res = response();
  await handler(req({ headers: { authorization: 'Bearer synthetic-session' } }), res);
  assert.equal(res.statusCode, 424);
  assert.equal(res.body.error, 'draft_scope_schema_unavailable');
  assert.equal(new URL(requested).searchParams.get('contact_id'), 'in.(101)');
});

test('F02.1 draft rows are filtered by canonical scope when the schema supplies contact_id', async () => {
  const handler = createDraftsHandler({ configResolver: () => CONFIG, authenticate: auth(OWNER_A), fetchImpl: async () => json([{ id: 1, contact_id: 101 }, { id: 2, contact_id: 202 }]) });
  const res = response();
  await handler(req({ headers: { authorization: 'Bearer synthetic-session' } }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.drafts, [{ id: 1, contact_id: 101 }]);
});

test('F02.1 Notion proxy rejects legacy credentials and client Notion secrets without external egress', async () => {
  let egress = 0;
  const handler = createNotionProxyHandler({ configResolver: () => CONFIG, authenticate: auth({ ok: false, status: 401, code: 'owner_reference_unauthorized' }), fetchImpl: async () => { egress += 1; return json([]); }, env: { NOTION_TOKEN: 'server-only-synthetic' } });
  const legacy = response();
  await handler(req({ method: 'POST', headers: { 'x-assistant-token': 'legacy-only' }, body: { url: 'https://api.notion.com/v1/pages/test', method: 'GET', contact_id: 101 } }), legacy);
  assert.equal(legacy.statusCode, 401);
  const supplied = response();
  await handler(req({ method: 'POST', body: { url: 'https://api.notion.com/v1/pages/test', method: 'GET', headers: { Authorization: 'Bearer client-secret' } } }), supplied);
  assert.equal(supplied.statusCode, 400);
  assert.equal(supplied.body.error, 'notion_client_credential_forbidden');
  assert.equal(egress, 0);
});

test('F02.1 preserves signed-provider and Meta verification branches while retiring interactive webhook reads', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'webhook.js'), 'utf8');
  assert.match(source, /authenticateYCloudWebhook/);
  assert.match(source, /ycloud_signature_missing/);
  assert.match(source, /hub\.mode/);
  assert.match(source, /mode === 'subscribe' && token === VERIFY_TOKEN/);
  assert.match(source, /interactive_drafts_route_moved|route: '\/api\/assistant\/drafts'/);
  assert.doesNotMatch(source, /function hasAssistantAccess/);
});

test('F02.1 removes the frontend fallback that sent interactive preferences to the provider webhook route', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'index.html'), 'utf8');
  assert.doesNotMatch(source, /\/api\/whatsapp\/messages\?action=preferences/);
});

test('WhatsApp sync reuses the authenticated owner session and never the legacy assistant token', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'index.html'), 'utf8');
  const start = source.indexOf('async function gfcSyncYarbiLocalMirror');
  const end = source.indexOf('async function gfcYarbiLocalBackfill', start);
  const block = source.slice(start, end);
  assert.match(block, /gfcAccountFreshAccessToken\(\)/);
  assert.match(block, /Authorization:\s*'Bearer '\s*\+\s*token/);
  assert.doesNotMatch(block, /X-Assistant-Token|fnz_assistant_token/);
});

test('owner-scoped local sync accepts POST and excludes another owner data', async () => {
  const requested = [];
  const handler = createWhatsAppMessagesHandler({
    configResolver: () => CONFIG,
    authenticate: auth(OWNER_A),
    fetchImpl: async input => {
      const url = new URL(String(input)); requested.push(url);
      if (url.pathname.endsWith('/whatsapp_messages')) return json([{ id:'message-a', contact_id:101, text:'hola', timestamp:1000 }, { id:'message-b', contact_id:202, text:'privado', timestamp:1001 }]);
      if (url.pathname.endsWith('/crm_contacts')) return json([{ id:101, display_name:'A', updated_at:'2026-11-14T10:00:00Z' }, { id:202, display_name:'B', updated_at:'2026-11-14T10:00:00Z' }]);
      return json([]);
    }
  });
  const res = response();
  await handler(req({ method:'POST', query:{ action:'local-sync' }, headers:{ authorization:'Bearer synthetic-session' }, body:{ message_limit:200, entity_limit:400 } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.contract, 'yarbi-local-mirror-v4-owner-scoped');
  assert.deepEqual(res.body.messages.map(row => row.contact_id), [101]);
  assert.deepEqual(res.body.entities.contacts.map(row => row.id), [101]);
  assert.ok(requested.every(url => !String(url.searchParams.get('contact_id') || url.searchParams.get('id') || '').includes('202')));
});

test('WhatsApp reads batch 2000 scoped contacts without truncation or cross-owner rows', async () => {
  const calls = [];
  const contactIds = Array.from({ length:2000 }, (_, index) => index + 1);
  const handler = createWhatsAppMessagesHandler({
    configResolver: () => CONFIG,
    authenticate: auth({ ok:true, scope:{ owner_id:OWNER_A.scope.owner_id, contact_ids:contactIds } }),
    fetchImpl: async input => {
      const url = new URL(String(input)); calls.push(url);
      const ids = String(url.searchParams.get('contact_id') || '').match(/in\.\(([^)]+)\)/)?.[1].split(',').map(Number) || [];
      return json(ids.length ? [{ id:'m-' + ids[0], contact_id:ids[0], timestamp:ids[0] }, { id:'foreign-' + ids[0], contact_id:9001, timestamp:9001 }] : []);
    }
  });
  const res = response();
  await handler(req({ query:{ limit:'5000', order:'asc' }, headers:{ authorization:'Bearer synthetic-session' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 20);
  assert.equal(res.body.messages.length, 20);
  assert.ok(res.body.messages.every(row => row.contact_id <= 2000));
  assert.ok(calls.every(url => String(url.searchParams.get('contact_id')).split(',').length <= 100));
});
