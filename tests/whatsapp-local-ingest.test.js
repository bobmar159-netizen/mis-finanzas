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
function handler(calls, scope = { owner_id: OWNER, contact_ids: [71] }, rows = new Map(), hooks = {}) {
  const target = createWhatsAppMessagesHandler({
    configResolver: () => ({ ok: true, supabaseUrl: 'https://supabase.test', supabaseKey: 'service-key' }),
    authenticate: async () => ({ ok: true, scope }),
    fetchImpl: async (raw, options = {}) => {
      const url = new URL(String(raw));
      const method = options.method || 'GET';
      calls.push({ path: url.pathname, query: url.searchParams, method, body: options.body || '', headers: options.headers || {} });
      if (url.pathname === '/rest/v1/contact_identifiers') {
        const requested = url.searchParams.get('contact_id') || '';
        const contactId = requested.includes('71') ? 71 : 72;
        return json([{ contact_id: contactId }]);
      }
      if (url.pathname === '/rest/v1/whatsapp_messages' && method === 'GET') {
        const id = url.searchParams.get('id')?.replace(/^eq\./, '');
        return json(rows.has(id) ? [rows.get(id)] : []);
      }
      if (url.pathname === '/rest/v1/whatsapp_messages' && method === 'POST') {
        await hooks.beforeInsert?.();
        const row = JSON.parse(options.body)[0];
        // Mimic PostgreSQL/PostgREST's ignore-duplicates conflict behavior:
        // a conflicting replay cannot overwrite the first immutable row.
        if (!hooks.skipInsert && !rows.has(row.id)) rows.set(row.id, row);
        return json([], 201);
      }
      throw new Error('unexpected_request:' + url.pathname);
    }
  });
  return { target, rows };
}
function event(overrides = {}) {
  return { event_id: 'native-event-0001', phone: '51955411248', title: 'Cliente sintético', text: 'Necesito una visita.', timestamp: NOW, ...overrides };
}

test('local ingest persiste solo un evento vinculado al scope autenticado, sin aceptar owner del cliente', async () => {
  const calls = []; const { target, rows } = handler(calls); const res = responseBox();
  await target({ method: 'POST', query: { action: 'local-ingest' }, headers: {}, body: { acknowledge_local_capture: true, events: [event()] } }, res);
  assert.equal(res.state.status, 200);
  assert.deepEqual(res.state.body.outcomes, [{ event_id: 'native-event-0001', outcome: 'persisted' }]);
  const write = calls.find(call => call.path === '/rest/v1/whatsapp_messages' && call.method === 'POST');
  assert.ok(write);
  const row = JSON.parse(write.body)[0];
  assert.equal(row.id, localMessageId(OWNER, 'native-event-0001'));
  assert.equal(row.contact_id, 71);
  assert.equal(row.metadata.historical, false);
  assert.equal(row.metadata.direction, 'incoming');
  assert.equal(row.metadata.identity_status, 'contact_confirmed_by_owner_scope');
  assert.equal(calls.filter(call => call.path === '/rest/v1/contact_identifiers').length, 1);
  assert.equal(calls.filter(call => call.path === '/rest/v1/whatsapp_messages' && call.method === 'GET').length, 2);
  assert.match(calls.find(call => call.method === 'POST').headers?.Prefer || '', /ignore-duplicates/);
  assert.equal(rows.size, 1);
});

test('local ingest trata el mismo ID y contenido como idempotente sin volver a escribir', async () => {
  const calls = []; const { target } = handler(calls); const payload = { acknowledge_local_capture: true, events: [event()] };
  const first = responseBox();
  await target({ method: 'POST', query: { action: 'local-ingest' }, headers: {}, body: payload }, first);
  const postCount = calls.filter(call => call.method === 'POST').length;
  const replay = responseBox();
  await target({ method: 'POST', query: { action: 'local-ingest' }, headers: {}, body: payload }, replay);
  assert.equal(replay.state.status, 200);
  assert.deepEqual(replay.state.body.outcomes, [{ event_id: 'native-event-0001', outcome: 'duplicate_ignored' }]);
  assert.equal(calls.filter(call => call.method === 'POST').length, postCount);
});

test('local ingest rechaza contenido distinto para el mismo ID y conserva el original', async () => {
  const calls = []; const { target, rows } = handler(calls); const first = responseBox();
  await target({ method: 'POST', query: { action: 'local-ingest' }, headers: {}, body: { acknowledge_local_capture: true, events: [event()] } }, first);
  const id = localMessageId(OWNER, 'native-event-0001');
  const original = structuredClone(rows.get(id));
  const conflict = responseBox();
  await target({ method: 'POST', query: { action: 'local-ingest' }, headers: {}, body: { acknowledge_local_capture: true, events: [event({ text: 'Contenido distinto para el mismo ID.' })] } }, conflict);
  assert.equal(conflict.state.status, 200);
  assert.equal(conflict.state.body.status, 'partial_conflict');
  assert.deepEqual(conflict.state.body.outcomes, [{ event_id: 'native-event-0001', outcome: 'identity_conflict' }]);
  assert.deepEqual(rows.get(id), original);
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
});

test('local ingest mantiene primera escritura ante dos eventos concurrentes con ID igual y contenido distinto', async () => {
  const calls = []; let arrivals = 0; let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const hooks = { beforeInsert: async () => { arrivals += 1; if (arrivals === 2) release(); await barrier; } };
  const { target, rows } = handler(calls, { owner_id: OWNER, contact_ids: [71] }, new Map(), hooks);
  const makeRequest = text => ({ method: 'POST', query: { action: 'local-ingest' }, headers: {}, body: { acknowledge_local_capture: true, events: [event({ text })] } });
  const responses = [responseBox(), responseBox()];
  await Promise.all([
    target(makeRequest('Primera representación concurrente.'), responses[0]),
    target(makeRequest('Segunda representación concurrente.'), responses[1])
  ]);
  assert.equal(rows.size, 1);
  assert.equal(calls.filter(call => call.method === 'POST').length, 2);
  assert.equal(responses.filter(res => res.state.body?.outcomes?.[0]?.outcome === 'identity_conflict').length, 1);
  assert.equal(responses.filter(res => res.state.body?.outcomes?.[0]?.outcome === 'persisted').length, 1);
  const row = [...rows.values()][0];
  assert.ok(['Primera representación concurrente.', 'Segunda representación concurrente.'].includes(row.text));
});

test('local ingest aísla el mismo ID de evento entre propietarios', async () => {
  const rows = new Map();
  const ownerA = handler([], { owner_id: OWNER, contact_ids: [71] }, rows);
  const ownerBId = '00000000-0000-4000-8000-0000000000b2';
  const ownerB = handler([], { owner_id: ownerBId, contact_ids: [72] }, rows);
  const payload = { acknowledge_local_capture: true, events: [event()] };
  const a = responseBox(); const b = responseBox();
  await ownerA.target({ method: 'POST', query: { action: 'local-ingest' }, headers: {}, body: payload }, a);
  await ownerB.target({ method: 'POST', query: { action: 'local-ingest' }, headers: {}, body: payload }, b);
  const idA = localMessageId(OWNER, 'native-event-0001');
  const idB = localMessageId(ownerBId, 'native-event-0001');
  assert.notEqual(idA, idB);
  assert.equal(rows.get(idA).contact_id, 71);
  assert.equal(rows.get(idB).contact_id, 72);
  assert.equal(a.state.body.outcomes[0].outcome, 'persisted');
  assert.equal(b.state.body.outcomes[0].outcome, 'persisted');
});

test('local ingest no afirma éxito si la lectura posterior no demuestra persistencia', async () => {
  const calls = []; const { target } = handler(calls, { owner_id: OWNER, contact_ids: [71] }, new Map(), { skipInsert: true });
  const res = responseBox();
  await target({ method: 'POST', query: { action: 'local-ingest' }, headers: {}, body: { acknowledge_local_capture: true, events: [event()] } }, res);
  assert.equal(res.state.status, 502);
  assert.equal(res.state.body.error, 'local_notification_readback_missing');
});

test('local ingest deja un evento sin teléfono/contacto en local y no escribe WhatsApp', async () => {
  const calls = []; const { target } = handler(calls, { owner_id: OWNER, contact_ids: [] }); const res = responseBox();
  await target({ method: 'POST', query: { action: 'local-ingest' }, headers: {}, body: { acknowledge_local_capture: true, events: [event()] } }, res);
  assert.equal(res.state.status, 200);
  assert.equal(res.state.body.unresolved, 1);
  assert.deepEqual(res.state.body.outcomes, [{ event_id: 'native-event-0001', outcome: 'unresolved_contact' }]);
  assert.equal(calls.some(call => call.path === '/rest/v1/whatsapp_messages'), false);
});

test('local ingest rechaza un owner aportado por el navegador antes de tocar Supabase', async () => {
  const calls = []; const { target } = handler(calls); const res = responseBox();
  await target({ method: 'POST', query: { action: 'local-ingest' }, headers: {}, body: { acknowledge_local_capture: true, owner_account_id: OWNER, events: [event()] } }, res);
  assert.equal(res.state.status, 400);
  assert.equal(res.state.body.error, 'owner_scope_client_input_forbidden');
  assert.equal(calls.length, 0);
});

test('local ingest exige una declaración explícita de captura local y no ejecuta escrituras sin ella', async () => {
  const calls = []; const { target } = handler(calls); const res = responseBox();
  await target({ method: 'POST', query: { action: 'local-ingest' }, headers: {}, body: { events: [event()] } }, res);
  assert.equal(res.state.status, 400);
  assert.equal(res.state.body.error, 'local_notification_capture_acknowledgement_required');
  assert.equal(calls.length, 0);
});
