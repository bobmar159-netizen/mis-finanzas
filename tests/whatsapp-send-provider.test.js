const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '..', 'api', 'assistant', 'send-whatsapp.js');
const managedEnv = [
  'ASSISTANT_API_TOKEN',
  'TOKEN_API_DE_ASISTENTE',
  'YCLOUD_API_KEY',
  'YCLOUD_KEY',
  'YCLOUD_WHATSAPP_NUMBER',
  'YCLOUD_PHONE_NUMBER',
  'WHATSAPP_BUSINESS_PHONE',
  'META_ACCESS_TOKEN',
  'WHATSAPP_TOKEN',
  'META_PHONE_NUMBER_ID',
  'WHATSAPP_PHONE_NUMBER_ID',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_URL',
  'AI_PROCESSOR_URL',
  'VERCEL_ENV',
  'YARBI_WHATSAPP_SEND_AUTHORIZATIONS_ENABLED',
  'YARBI_WHATSAPP_SEND_AUTHORIZATION_SECRET'
];

const OWNER = '11111111-1111-4111-8111-111111111111';

const serverConfig = {
  VERCEL_ENV: 'development',
  SUPABASE_URL: 'https://whatsapp-provider-test.example.test',
  SUPABASE_SECRET_KEY: 's'.repeat(40),
  YARBI_WHATSAPP_SEND_AUTHORIZATIONS_ENABLED: 'true',
  YARBI_WHATSAPP_SEND_AUTHORIZATION_SECRET: 'F08-send-authorization-test-secret-only-not-for-deployment'
};

function loadHandler(env) {
  for (const key of managedEnv) delete process.env[key];
  Object.assign(process.env, env);
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; }
  };
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function ownerResponse(url, options = {}) {
  const value = String(url);
  if (value.endsWith('/auth/v1/user')) return jsonResponse(200, { id: OWNER });
  if (value.includes('/yarbi_whatsapp_send_operations') && options.method === 'POST') return jsonResponse(201, [JSON.parse(options.body)[0]]);
  if (value.endsWith('/rpc/claim_yarbi_whatsapp_send_operation')) return jsonResponse(200, [{ operation_id: 'synthetic-operation' }]);
  if (value.includes('/yarbi_whatsapp_send_operations') && options.method === 'PATCH') return jsonResponse(200, [{ status: 'provider_accepted' }]);
  return null;
}

async function requestAuthorization(handler, body) {
  const res = responseRecorder();
  await handler({ method: 'POST', headers: { authorization: 'Bearer synthetic-owner-token' }, body: { ...body, action: 'request_authorization' } }, res);
  assert.equal(res.statusCode, 200);
  return res.body.send_authorization;
}

test('WhatsApp sender uses YCloud, discovers its single business number and preserves exact text', { concurrency: false }, async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const owner = ownerResponse(url, options);
    if (owner) return owner;
    if (String(url).includes('/phoneNumbers?')) {
      return jsonResponse(200, { items: [{ phoneNumber: '+51987654321' }] });
    }
    if (String(url).endsWith('/messages/sendDirectly')) {
      return jsonResponse(200, { id: 'ycloud-message-1' });
    }
    if (String(url).includes('/rest/v1/whatsapp_messages')) return jsonResponse(201, []);
    throw new Error('Unexpected fetch ' + url);
  };

  try {
    const handler = loadHandler({ ...serverConfig, YCLOUD_API_KEY: 'ycloud-test' });
    const send_authorization = await requestAuthorization(handler, { provider: 'ycloud', to: '987654320', message: 'Hola Monica 👋' });
    const res = responseRecorder();
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer synthetic-owner-token' },
      body: { provider: 'ycloud', to: '987654320', message: 'Hola Monica 👋', send_authorization }
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.accepted, true);
    assert.equal(res.body.deliveryConfirmed, false);
    assert.equal(res.body.provider, 'ycloud');
    assert.equal(res.body.messageId, 'ycloud-message-1');
    const sendCall = calls.find(call => call.url.endsWith('/messages/sendDirectly'));
    const payload = JSON.parse(sendCall.options.body);
    assert.equal(payload.from, '+51987654321');
    assert.equal(payload.to, '+51987654320');
    assert.equal(payload.text.body, 'Hola Monica 👋');
    assert.equal(sendCall.options.headers['X-API-Key'], 'ycloud-test');
  } finally {
    global.fetch = originalFetch;
  }
});

test('WhatsApp sender never claims success when YCloud omits the provider message id', { concurrency: false }, async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const owner = ownerResponse(url, options);
    if (owner) return owner;
    if (String(url).includes('/phoneNumbers?')) return jsonResponse(200, { items: [{ phoneNumber: '+51987654321' }] });
    if (String(url).endsWith('/messages/sendDirectly')) return jsonResponse(200, { accepted: true });
    if (String(url).includes('/rest/v1/whatsapp_messages')) return jsonResponse(201, []);
    throw new Error('Unexpected fetch ' + url);
  };
  try {
    const handler = loadHandler({ ...serverConfig, YCLOUD_API_KEY: 'ycloud-test' });
    const send_authorization = await requestAuthorization(handler, { provider: 'ycloud', to: '987654320', message: 'Hola' });
    const res = responseRecorder();
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer synthetic-owner-token' },
      body: { provider: 'ycloud', to: '987654320', message: 'Hola', send_authorization }
    }, res);
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.error, 'ycloud_send_unverified');
  } finally {
    global.fetch = originalFetch;
  }
});

test('WhatsApp sender never sends without a server-issued authorization', { concurrency: false }, async () => {
  const originalFetch = global.fetch;
  let called = false;
  global.fetch = async (url, options = {}) => {
    const owner = ownerResponse(url, options);
    if (owner) return owner;
    called = true;
    throw new Error('must not send');
  };
  try {
    const handler = loadHandler({ ...serverConfig, YCLOUD_API_KEY: 'ycloud-test' });
    const res = responseRecorder();
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer synthetic-owner-token' },
      body: { provider: 'ycloud', to: '987654320', message: 'No enviar', confirmed: true }
    }, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error, 'whatsapp_send_authorization_invalid');
    assert.equal(called, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('WhatsApp sender refuses to guess when YCloud has multiple business numbers', { concurrency: false }, async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const owner = ownerResponse(url, options);
    if (owner) return owner;
    if (String(url).includes('/phoneNumbers?')) {
      return jsonResponse(200, { items: [{ phoneNumber: '+51911111111' }, { phoneNumber: '+51922222222' }] });
    }
    throw new Error('message must not be sent');
  };
  try {
    const handler = loadHandler({ ...serverConfig, YCLOUD_API_KEY: 'ycloud-test' });
    const send_authorization = await requestAuthorization(handler, { provider: 'ycloud', to: '987654320', message: 'Hola' });
    const res = responseRecorder();
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer synthetic-owner-token' },
      body: { provider: 'ycloud', to: '987654320', message: 'Hola', send_authorization }
    }, res);
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.error, 'ycloud_sender_ambiguous');
  } finally {
    global.fetch = originalFetch;
  }
});
