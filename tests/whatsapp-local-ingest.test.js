'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createWhatsAppMessagesHandler, localMessageId } = require('../api/whatsapp/messages');

const OWNER = '00000000-0000-4000-8000-0000000000a1';
const NOW = Date.now();

function json(value, status = 200) { return new Response(JSON.stringify(value), { status }); }
function responseBox() {
  const state = { status: 200, body: null };
  return { state, setHeader() {}, status(value) { state.status = value; return this; }, json(value) { state.body = value; return this; }, end() {} };
}
function handler(calls, scope = { owner_id: OWNER, contact_ids: [71] }) {
  return createWhatsAppMessagesHandler({
    configResolver: () => ({ ok: true, supabaseUrl: 'https://supabase.test', supabaseKey: 'service-key' }),
    authenticate: async () => ({ ok: true, scope }),
    fetchImpl: async (raw, options = {}) => {
      const url = new URL(String(raw));
      calls.push({ path: url.pathname, query: url.searchParams, method: options.method || 'GET', body: options.body || '' });
      if (url.pathname === '/rest/v1/contact_identifiers') return json([{ contact_id: 71 }]);
      if (url.pathname === '/rest/v1/whatsapp_messages' && options.method === 'POST') return json([], 201);
      throw new Error('unexpected_request:' + url.pathname);
    }
  });
}
function event(overrides = {}) {
  return { event_id: 'native-event-0001', phone: '51955411248', title: 'Cliente sintético', text: 'Necesito una visita.', timestamp: NOW, ...overrides };
}

test('local ingest persiste solo un evento vinculado al scope autenticado, sin aceptar owner del cliente', async () => {
  const calls = []; const target = handler(calls); const res = responseBox();
  await target({ method: 'POST', query: { action: 'local-ingest' }, headers: {}, body: { acknowledge_local_capture: true, events: [event()] } }, res);
  assert.equal(res.state.status, 200);
  assert.deepEqual(res.state.body.outcomes, [{ event_id: 'native-event-0001', outcome: 'persisted' }]);
  const write = calls.find(call => call.path === '/rest/v1/whatsapp_messages');
  assert.ok(write);
  const row = JSON.parse(write.body)[0];
  assert.equal(row.id, localMessageId(OWNER, 'native-event-0001'));
  assert.equal(row.contact_id, 71);
  assert.equal(row.metadata.historical, false);
  assert.equal(row.metadata.direction, 'incoming');
  assert.equal(row.metadata.identity_status, 'contact_confirmed_by_owner_scope');
  assert.equal(calls.filter(call => call.path === '/rest/v1/contact_identifiers').length, 1);
});

test('local ingest deja un evento sin teléfono/contacto en local y no escribe WhatsApp', async () => {
  const calls = []; const target = handler(calls, { owner_id: OWNER, contact_ids: [] }); const res = responseBox();
  await target({ method: 'POST', query: { action: 'local-ingest' }, headers: {}, body: { acknowledge_local_capture: true, events: [event()] } }, res);
  assert.equal(res.state.status, 200);
  assert.equal(res.state.body.unresolved, 1);
  assert.deepEqual(res.state.body.outcomes, [{ event_id: 'native-event-0001', outcome: 'unresolved_contact' }]);
  assert.equal(calls.some(call => call.path === '/rest/v1/whatsapp_messages'), false);
});

test('local ingest rechaza un owner aportado por el navegador antes de tocar Supabase', async () => {
  const calls = []; const target = handler(calls); const res = responseBox();
  await target({ method: 'POST', query: { action: 'local-ingest' }, headers: {}, body: { acknowledge_local_capture: true, owner_account_id: OWNER, events: [event()] } }, res);
  assert.equal(res.state.status, 400);
  assert.equal(res.state.body.error, 'owner_scope_client_input_forbidden');
  assert.equal(calls.length, 0);
});

test('local ingest exige una declaración explícita de captura local y no ejecuta escrituras sin ella', async () => {
  const calls = []; const target = handler(calls); const res = responseBox();
  await target({ method: 'POST', query: { action: 'local-ingest' }, headers: {}, body: { events: [event()] } }, res);
  assert.equal(res.state.status, 400);
  assert.equal(res.state.body.error, 'local_notification_capture_acknowledgement_required');
  assert.equal(calls.length, 0);
});
