'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const assistantRoutes = Object.freeze({
  chat: 'chat.js', drafts: 'drafts.js', collections: 'collections.js', command: 'command.js', conversation: 'conversation.js', memory: 'memory.js', 'crm-dossier': 'crm-dossier.js', 'crm-search': 'crm-search.js', gemini: 'gemini.js', 'live-token': 'live-token.js',
  'owner-action': 'owner-action.js', 'owner-inbox': 'owner-inbox.js', preferences: 'preferences.js',
  'proactive-loop': 'proactive-loop.js', 'reference-candidates': 'reference-candidates.js', 'scheduled-followups': 'scheduled-followups.js'
});
const utilityRoutes = Object.freeze({ trace: 'audit/trace.js', resolve: 'location/resolve.js' });
const requiredPublicPaths = Object.freeze([
  '/api/webhook', '/api/whatsapp/messages', '/api/supabase-secure', '/api/notion-proxy', '/api/actions/approve', '/api/ai/process',
  '/api/assistant/send-whatsapp', ...Object.keys(assistantRoutes).map(name => `/api/assistant/${name}`),
  '/api/audit/trace', '/api/location/resolve'
]);

function mockRequest({ url, method = 'POST' }) {
  return { url, method, headers: {}, body: {} };
}

function mockResponse() {
  const state = { status: 200, headers: {}, body: undefined, ended: false };
  return {
    state,
    status(value) { state.status = value; return this; },
    setHeader(name, value) { state.headers[String(name).toLowerCase()] = value; },
    json(value) { state.body = value; state.ended = true; return this; },
    end(value) { state.body = value; state.ended = true; return this; },
    send(value) { state.body = value; state.ended = true; return this; }
  };
}

async function invoke(target, req) {
  const res = mockResponse();
  await target(req, res);
  return res.state;
}

test('P06 maps every public API URL explicitly and leaves no grouped handler as a direct Function entrypoint', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  const routeSources = new Set(config.routes.map(route => route.src));
  for (const publicPath of requiredPublicPaths) assert.equal(routeSources.has(publicPath), true, publicPath);
  const apiEntries = fs.readdirSync(path.join(__dirname, '..', 'api'), { recursive: true }).filter(file => file.endsWith('.js'));
  assert.equal(apiEntries.length, 9, '9 bundled Functions remain below the Hobby limit of 12');
  assert.equal(apiEntries.includes(path.join('assistant', 'chat.js')), false);
  assert.equal(apiEntries.includes(path.join('audit', 'trace.js')), false);
  assert.equal(apiEntries.includes(path.join('location', 'resolve.js')), false);
});

test('P06 assistant router is a closed map and preserves query semantics before dispatch', async () => {
  const router = require('../api/assistant-router');
  assert.deepEqual(router.routeNames, Object.keys(assistantRoutes));
  const unknown = await invoke(router, mockRequest({ url: '/api/assistant-router?__p06_route=../../webhook' }));
  assert.equal(unknown.status, 404);
  assert.deepEqual(unknown.body, { error: 'assistant_route_not_found' });
  for (const [route, file] of Object.entries(assistantRoutes)) {
    const direct = require(`../api_handlers/assistant/${file}`);
    const directResult = await invoke(direct, mockRequest({ url: `/api/assistant/${route}?preserve=one` }));
    const dispatchedRequest = mockRequest({ url: `/api/assistant-router?__p06_route=${encodeURIComponent(route)}&preserve=one` });
    const dispatchedResult = await invoke(router, dispatchedRequest);
    assert.equal(dispatchedRequest.url, `/api/assistant/${route}?preserve=one`);
    assert.equal(dispatchedResult.status, directResult.status, route);
    assert.deepEqual(dispatchedResult.body, directResult.body, route);
  }
});

test('P06 utility router is a closed map and preserves invalid-auth behavior without providers', async () => {
  const router = require('../api/utility-router');
  assert.deepEqual(router.routeNames, Object.keys(utilityRoutes));
  const unknown = await invoke(router, mockRequest({ url: '/api/utility-router?__p06_route=unknown' }));
  assert.equal(unknown.status, 404);
  assert.deepEqual(unknown.body, { error: 'utility_route_not_found' });
  for (const [route, file] of Object.entries(utilityRoutes)) {
    const direct = require(`../api_handlers/${file}`);
    const directResult = await invoke(direct, mockRequest({ url: route === 'trace' ? '/api/audit/trace?preserve=one' : '/api/location/resolve?preserve=one' }));
    const dispatchedRequest = mockRequest({ url: `/api/utility-router?__p06_route=${route}&preserve=one` });
    const dispatchedResult = await invoke(router, dispatchedRequest);
    const expectedUrl = route === 'trace' ? '/api/audit/trace?preserve=one' : '/api/location/resolve?preserve=one';
    assert.equal(dispatchedRequest.url, expectedUrl);
    assert.equal(dispatchedResult.status, directResult.status, route);
    assert.deepEqual(dispatchedResult.body, directResult.body, route);
  }
});
