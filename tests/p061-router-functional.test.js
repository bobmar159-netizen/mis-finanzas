'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.join(__dirname, '..');
const assistantNames = Object.freeze(['chat', 'collections', 'command', 'conversation', 'memory', 'crm-dossier', 'crm-search', 'live-token', 'owner-action', 'owner-inbox', 'preferences', 'proactive-loop', 'reference-candidates', 'scheduled-followups']);
const utilityNames = Object.freeze(['trace', 'resolve']);

function response() {
  const state = { status: 200, headers: {}, body: undefined, ended: false };
  return {
    state,
    status(value) { state.status = value; return this; },
    setHeader(name, value) { state.headers[String(name).toLowerCase()] = value; return this; },
    json(value) { state.body = value; state.ended = true; return this; },
    send(value) { state.body = value; state.ended = true; return this; },
    end(value) { state.body = value; state.ended = true; return this; }
  };
}

async function invoke(fn, req) {
  const res = response();
  await fn(req, res);
  return res.state;
}

function makeRequest(url, method = 'POST') {
  return {
    url,
    method,
    headers: { authorization: 'Bearer synthetic-router-token', 'x-p06-test': 'router-functional' },
    body: { synthetic: true, action: 'no_external_effects' }
  };
}

// Loads a router only after each relocated module is substituted with an
// in-memory deterministic target. This tests transport/dispatch without
// loading providers, calling external services or altering the candidate.
async function withMockedRouter(routerRelativePath, mockByRelativePath, run) {
  const routerPath = require.resolve(path.join(root, routerRelativePath));
  const previousRouter = require.cache[routerPath];
  const previousModules = new Map();
  try {
    for (const [relativePath, mock] of Object.entries(mockByRelativePath)) {
      const modulePath = require.resolve(path.join(root, relativePath));
      previousModules.set(modulePath, require.cache[modulePath]);
      require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports: mock };
    }
    delete require.cache[routerPath];
    const router = require(routerPath);
    return await run(router);
  } finally {
    delete require.cache[routerPath];
    if (previousRouter) require.cache[routerPath] = previousRouter;
    for (const [modulePath, previous] of previousModules) {
      if (previous) require.cache[modulePath] = previous;
      else delete require.cache[modulePath];
    }
  }
}

function makeMock(name, calls, mode = 'ok') {
  return async (req, res) => {
    calls.push({ name, method: req.method, url: req.url, headers: req.headers, body: req.body });
    if (mode === 'throw') throw Object.assign(new Error(`synthetic_${name}_failure`), { code: 'P061_SYNTHETIC' });
    if (mode === 'validation') return res.status(422).json({ error: 'synthetic_validation_error', handler: name });
    return res.status(201).setHeader('content-type', 'application/json').json({ ok: true, handler: name, method: req.method, url: req.url });
  };
}

test('P0.6.1 assistant router forwards authorized synthetic method, headers, body and query exactly once to every target', async () => {
  const calls = [];
  const mocks = Object.fromEntries(assistantNames.map(name => [`api_handlers/assistant/${name}.js`, makeMock(name, calls, name === 'collections' ? 'validation' : 'ok')]));
  await withMockedRouter('api/assistant-router.js', mocks, async router => {
    for (const [index, name] of assistantNames.entries()) {
      const method = index % 3 === 0 ? 'GET' : index % 3 === 1 ? 'POST' : 'OPTIONS';
      const req = makeRequest(`/api/assistant-router.js?__p06_route=${encodeURIComponent(name)}&keep=one&keep=two`, method);
      const result = await invoke(router, req);
      const expectedUrl = `/api/assistant/${name}?keep=one&keep=two`;
      const call = calls.at(-1);
      assert.equal(call.name, name);
      assert.equal(call.method, method);
      assert.equal(call.url, expectedUrl);
      assert.equal(call.headers, req.headers, 'headers are forwarded by reference');
      assert.equal(call.body, req.body, 'body is forwarded by reference');
      assert.equal(req.url, expectedUrl, 'private query key removed from public URL');
      assert.equal(calls.filter(entry => entry.name === name).length, 1, `single execution for ${name}`);
      if (name === 'collections') {
        assert.equal(result.status, 422);
        assert.deepEqual(result.body, { error: 'synthetic_validation_error', handler: name });
      } else {
        assert.equal(result.status, 201);
        assert.deepEqual(result.body, { ok: true, handler: name, method, url: expectedUrl });
      }
    }
  });
});

test('P0.6.1 utility router forwards authorized synthetic requests and preserves query strings exactly once', async () => {
  const calls = [];
  const mocks = {
    'api_handlers/audit/trace.js': makeMock('trace', calls),
    'api_handlers/location/resolve.js': makeMock('resolve', calls)
  };
  await withMockedRouter('api/utility-router.js', mocks, async router => {
    for (const [index, name] of utilityNames.entries()) {
      const req = makeRequest(`/api/utility-router.js?__p06_route=${name}&query=kept`, index ? 'POST' : 'GET');
      const result = await invoke(router, req);
      const expectedUrl = name === 'trace' ? '/api/audit/trace?query=kept' : '/api/location/resolve?query=kept';
      assert.equal(calls.at(-1).url, expectedUrl);
      assert.equal(req.url, expectedUrl);
      assert.equal(result.status, 201);
      assert.equal(calls.filter(entry => entry.name === name).length, 1, `single execution for ${name}`);
    }
  });
});

test('P0.6.1 routers return JSON 404 for an invalid identifier and propagate a target failure without double execution', async () => {
  const assistantCalls = [];
  const assistantMocks = Object.fromEntries(assistantNames.map(name => [`api_handlers/assistant/${name}.js`, makeMock(name, assistantCalls, name === 'chat' ? 'throw' : 'ok')]));
  await withMockedRouter('api/assistant-router.js', assistantMocks, async router => {
    const unknown = await invoke(router, makeRequest('/api/assistant-router.js?__p06_route=not-allowed'));
    assert.equal(unknown.status, 404);
    assert.deepEqual(unknown.body, { error: 'assistant_route_not_found' });
    await assert.rejects(() => invoke(router, makeRequest('/api/assistant-router.js?__p06_route=chat')), /synthetic_chat_failure/);
    assert.equal(assistantCalls.filter(entry => entry.name === 'chat').length, 1);
  });

  const utilityCalls = [];
  await withMockedRouter('api/utility-router.js', {
    'api_handlers/audit/trace.js': makeMock('trace', utilityCalls),
    'api_handlers/location/resolve.js': makeMock('resolve', utilityCalls)
  }, async router => {
    const unknown = await invoke(router, makeRequest('/api/utility-router.js?__p06_route=not-allowed'));
    assert.equal(unknown.status, 404);
    assert.deepEqual(unknown.body, { error: 'utility_route_not_found' });
  });
});

test('P0.6.1 current relocated handlers retain invalid-auth parity with their routers without provider calls', async () => {
  const assistantRouter = require('../api/assistant-router.js');
  for (const name of assistantNames) {
    const direct = require(`../api_handlers/assistant/${name}.js`);
    const directResult = await invoke(direct, makeRequest(`/api/assistant/${name}?safe=one`));
    const routedRequest = makeRequest(`/api/assistant-router.js?__p06_route=${name}&safe=one`);
    const routedResult = await invoke(assistantRouter, routedRequest);
    assert.equal(routedRequest.url, `/api/assistant/${name}?safe=one`);
    assert.equal(routedResult.status, directResult.status, name);
    assert.deepEqual(routedResult.body, directResult.body, name);
  }
});
