'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const ENV = {
  VERCEL_ENV: 'preview', YARBI_PREVIEW_OWNER_REFERENCES_ONLY: 'true', YARBI_PREVIEW_OWNER_GEMINI_UNDERSTANDING: 'true',
  YARBI_PREVIEW_SUPABASE_PROJECT_REF: 'uevilhbstnmmdlgyshlv', SUPABASE_URL: 'https://uevilhbstnmmdlgyshlv.supabase.co',
  SUPABASE_SECRET_KEY: 'isolated-service-key-not-real-123456789012345678', GEMINI_API_KEY: 'isolated-gemini-key-not-real-123456789012345678',
  YARBI_TRACE_HMAC_KEY: 'trace-hmac-isolated-not-real-123456789012345678'
};
const OWNER = '00000000-0000-4000-8000-0000000000a1';

function responseBox() { let statusCode; let body; return { status(value) { statusCode = value; return this; }, json(value) { body = value; return this; }, get value() { return { statusCode, body }; } }; }
function answer() { const clue = (value = '') => ({ value, certainty: value ? 'confirmed' : 'inferred', days: null, day_part: null, present: null }); return {
  schema: 'yarbi.owner-understanding.v1', intent: 'open_client', conversational_act: 'request', target_type: 'contact', target_reference: { name: 'Carlos', relation: '' },
  constraints: { name: clue('Carlos'), district: clue(), service: clue(), location: clue(), visit: clue(), recency: clue() }, correction: { discard_active_entity: false, replace_previous: false, select_alternative: false }, continuation: { use_active_entity: false, use_last_proposed_entity: false }, cancel_scope: 'none', temporal_clues: [], location_clues: [], service_clues: [], confidence: 0.92, ambiguity: false, missing_information: []
}; }
function applyEnv() { const before = Object.fromEntries(Object.keys(ENV).map(key => [key, process.env[key]])); Object.assign(process.env, ENV); return () => Object.entries(before).forEach(([key, value]) => value === undefined ? delete process.env[key] : process.env[key] = value); }
function json(value, status = 200) { return new Response(JSON.stringify(value), { status }); }

test('frase natural recorre Gemini aislado, scope canónico, candidatos y resolvedor sin ejecutar acciones', async () => {
  const restore = applyEnv(); const original = global.fetch; const events = [];
  try {
    global.fetch = async (raw, options = {}) => {
      const url = new URL(String(raw)); const path = url.pathname;
      if (url.hostname === 'generativelanguage.googleapis.com') {
        events.push('gemini'); const sentBody = JSON.parse(options.body); const sent = JSON.stringify(sentBody); const prompt = sentBody.contents?.[0]?.parts?.[0]?.text || '';
        const minimization = {
          has_active_entity: prompt.includes('"has_active_entity":true'),
          has_compact_district: prompt.includes('Comas'),
          leaks_active_entity_id: prompt.includes('active_entity_id'),
          leaks_phone: prompt.includes('900000101')
        };
        assert.deepEqual(minimization, { has_active_entity: true, has_compact_district: true, leaks_active_entity_id: false, leaks_phone: false });
        return json({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer()) }] } }] });
      }
      assert.equal(url.hostname, 'uevilhbstnmmdlgyshlv.supabase.co');
      if (path === '/auth/v1/user') return json({ id: OWNER });
      if (path === '/rest/v1/yarbi_agent_actions') { events.push('trace'); return json([JSON.parse(options.body)[0]], 201); }
      if (path === '/rest/v1/yarbi_owner_contact_scope') { events.push('scope'); await new Promise(resolve => setTimeout(resolve, 4)); return json([{ contact_id: 101 }]); }
      if (path === '/rest/v1/crm_contacts') { events.push('contacts'); return json([{ id: 101, display_name: 'Carlos F3G', commercial_status: 'tibio', latest_service: 'punto_adicional', last_contact_at: '2026-11-01T12:00:00.000Z' }]); }
      if (path === '/rest/v1/contact_identifiers') { events.push('identifiers'); return json([{ contact_id: 101, identifier_type: 'phone', normalized_value: '900000101', is_primary: true }]); }
      if (path === '/rest/v1/yarbi_contact_operational_memory') { events.push('memory'); return json([{ contact_id: 101, memory_type: 'district', state: 'active', value: { district: 'Comas' }, occurred_at: '2026-11-01T12:00:00.000Z' }]); }
      events.push('unexpected:' + url.pathname); throw new Error('unexpected request ' + url);
    };
    delete require.cache[require.resolve('../api/assistant/reference-candidates')];
    const handler = require('../api/assistant/reference-candidates'); const res = responseBox();
    const conversation_state = { task: 'open_client', intent: 'reference_lookup', has_active_entity: true, active_constraints: { name: { value: 'Carlos', certainty: 'confirmed' }, district: { value: 'Comas', certainty: 'confirmed' } }, last_question: '¿Te refieres al Carlos de Comas?' };
    await handler({ method: 'POST', url: '/api/assistant/reference-candidates', headers: { authorization: 'Bearer synthetic-owner-token' }, body: { utterance: 'Ábreme a Carlos.', conversation_state } }, res);
    assert.equal(res.value.statusCode, 200, JSON.stringify({ body: res.value.body, events })); assert.equal(res.value.body.execute, false); assert.equal(res.value.body.route, 'NEEDS_LANGUAGE_MODEL');
    assert.equal(res.value.body.candidates.length, 1, JSON.stringify({ body: res.value.body, events })); assert.equal(res.value.body.candidates[0].contact_id, 101);
    assert.ok(res.value.body.metrics.gemini_ms >= 0); assert.ok(res.value.body.metrics.owner_scope_ms >= 0);
    assert.ok(events.indexOf('gemini') < events.indexOf('contacts')); assert.ok(events.indexOf('scope') < events.indexOf('contacts'));
    assert.equal(JSON.stringify(res.value.body).includes('isolated-gemini-key-not-real'), false);
    const samples = [res.value.body.metrics.total_ms];
    for (let index = 1; index < 20; index += 1) {
      const measured = responseBox();
      await handler({ method: 'POST', url: '/api/assistant/reference-candidates', headers: { authorization: 'Bearer synthetic-owner-token' }, body: { utterance: 'Ábreme a Carlos.', conversation_state } }, measured);
      assert.equal(measured.value.statusCode, 200);
      assert.equal(measured.value.body.route, 'NEEDS_LANGUAGE_MODEL');
      samples.push(measured.value.body.metrics.total_ms);
    }
    const ordered = samples.slice().sort((left, right) => left - right);
    const p50 = ordered[Math.ceil(ordered.length * 0.5) - 1]; const p95 = ordered[Math.ceil(ordered.length * 0.95) - 1];
    console.log('GEMINI_LOCAL_MOCK_METRICS=' + JSON.stringify({ samples: samples.length, p50_ms: p50, p95_ms: p95, max_ms: Math.max(...samples) }));
    assert.ok(p95 < 250, `p95 Gemini mock inesperado: ${p95}ms`);
  } finally { global.fetch = original; restore(); }
});

test('el cliente no puede introducir IDs dentro del estado conversacional', async () => {
  const restore = applyEnv();
  try {
    delete require.cache[require.resolve('../api/assistant/reference-candidates')];
    const handler = require('../api/assistant/reference-candidates'); const res = responseBox();
    await handler({ method: 'POST', url: '/api/assistant/reference-candidates', headers: { authorization: 'Bearer synthetic-owner-token' }, body: { utterance: 'Sí, ese.', conversation_state: { active_entity_id: 101 } } }, res);
    assert.equal(res.value.statusCode, 400);
    assert.equal(res.value.body.error, 'owner_scope_client_input_forbidden');
  } finally { restore(); }
});

test('el HTTP 400 no cambia el contrato público y deja diagnóstico sanitizado en la traza', async () => {
  const restore = applyEnv(); const original = global.fetch; const traceRows = [];
  try {
    global.fetch = async (raw, options = {}) => {
      const url = new URL(String(raw)); const path = url.pathname;
      if (url.hostname === 'generativelanguage.googleapis.com') {
        return json({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'responseJsonSchema is too complex secret=AIza-SENSITIVE' } }, 400);
      }
      assert.equal(url.hostname, 'uevilhbstnmmdlgyshlv.supabase.co');
      if (path === '/auth/v1/user') return json({ id: OWNER });
      if (path === '/rest/v1/yarbi_owner_contact_scope') return json([{ contact_id: 101 }]);
      if (path === '/rest/v1/yarbi_agent_actions' && (options.method || 'GET') === 'POST') {
        const row = JSON.parse(options.body)[0]; traceRows.push(row); return json([row], 201);
      }
      throw new Error('unexpected request ' + url);
    };
    delete require.cache[require.resolve('../api/assistant/reference-candidates')];
    const handler = require('../api/assistant/reference-candidates'); const res = responseBox();
    await handler({ method: 'POST', url: '/api/assistant/reference-candidates', headers: { authorization: 'Bearer synthetic-owner-token' }, body: { utterance: 'Frase sintética.' } }, res);
    assert.equal(res.value.statusCode, 503);
    assert.deepEqual(Object.keys(res.value.body).sort(), ['error', 'execute', 'ok', 'operation_id', 'understanding_error']);
    assert.equal(res.value.body.ok, false);
    assert.equal(res.value.body.error, 'understanding_unavailable');
    assert.equal(res.value.body.understanding_error, 'owner_understanding_provider_rejected_400');
    assert.equal(res.value.body.execute, false);
    const publicBody = JSON.stringify(res.value.body);
    assert.doesNotMatch(publicBody, /SCHEMA_UNSUPPORTED|AIza-SENSITIVE|responseJsonSchema|gemini-3\.5-flash-lite|schema_sha256/);
    const diagnosed = traceRows.find(row => row.result_payload?.provider_diagnostic)?.result_payload?.provider_diagnostic;
    assert.equal(diagnosed.category, 'SCHEMA_UNSUPPORTED');
    assert.equal(diagnosed.http_status, 400);
    assert.equal(diagnosed.provider_status, 'INVALID_ARGUMENT');
    assert.equal(diagnosed.model, 'gemini-3.5-flash-lite');
    assert.match(diagnosed.schema_sha256, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(traceRows).includes('AIza-SENSITIVE'), false);
  } finally { global.fetch = original; restore(); }
});
