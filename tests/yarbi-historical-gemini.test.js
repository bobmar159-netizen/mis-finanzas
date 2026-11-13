'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildHistoricalIntelligenceRequest, planHistoricalIntelligence } = require('../lib/yarbi-historical-intelligence');
const { GEMINI_HOST, DEFAULT_MODEL, createHistoricalGeminiInterpreter } = require('../lib/yarbi-historical-gemini');
const { schemaSha256 } = require('../lib/yarbi-gemini-request-forensics');

function fixture() {
  const messages = [
    { id:'h1', contact_id:71, text:'Necesito una instalación.', timestamp:1, metadata:{ historical:true, direction:'incoming' } },
    { id:'h2', contact_id:71, text:'Hola, envíame una foto por favor.', timestamp:2, metadata:{ historical:true, direction:'outgoing' } }
  ];
  return buildHistoricalIntelligenceRequest({ task: planHistoricalIntelligence({ messages }).tasks[0], messages });
}

function safeResult() {
  return {
    contact_context_observations:[{ category:'service_interest', summary:'Consulta de servicio.', source_message_ids:['h1'], confidence:0.8 }],
    reply_style_patterns:[{ pattern_key:'saludo_breve', category:'greeting', guidance:'Saluda y pide una foto.', source_message_ids:['h2'], confidence:0.9 }],
    requires_owner_review:true
  };
}

test('el adaptador histórico usa Structured Output compacto sin exponer la clave en URL ni body', async () => {
  const seen = [];
  const interpreter = createHistoricalGeminiInterpreter({
    apiKey:'synthetic-historical-key-not-real',
    fetchImpl: async (url, options) => {
      seen.push({ url:String(url), headers:options.headers, body:JSON.parse(options.body) });
      return new Response(JSON.stringify({ candidates:[{ content:{ parts:[{ text:JSON.stringify(safeResult()) }] } }] }), { status:200 });
    }
  });
  const result = await interpreter.interpretHistoricalSegment(fixture());
  assert.deepEqual(result, safeResult());
  assert.equal(new URL(seen[0].url).hostname, GEMINI_HOST);
  assert.equal(new URL(seen[0].url).search, '');
  assert.equal(seen[0].headers['x-goog-api-key'], 'synthetic-historical-key-not-real');
  assert.equal(JSON.stringify(seen[0].body).includes('synthetic-historical-key-not-real'), false);
  assert.equal(seen[0].body.generationConfig.responseMimeType, 'application/json');
  assert.equal(seen[0].body.generationConfig.responseJsonSchema.type, 'object');
  assert.equal(seen[0].body.generationConfig.responseJsonSchema.additionalProperties, false);
  assert.equal(interpreter.model, DEFAULT_MODEL);
  assert.equal(interpreter.response_schema_sha256, schemaSha256(seen[0].body.generationConfig.responseJsonSchema));
});

test('el adaptador falla cerrado ante JSON incompleto, rate limit y rechazo 400 sanitizado', async () => {
  const invalid = createHistoricalGeminiInterpreter({ apiKey:'test-key', fetchImpl: async () => new Response(JSON.stringify({ candidates:[{ content:{ parts:[{ text:'{}' }] } }] }), { status:200 }) });
  await assert.rejects(() => invalid.interpretHistoricalSegment(fixture()), { code:'historical_intelligence_response_invalid' });
  const rateLimited = createHistoricalGeminiInterpreter({ apiKey:'test-key', fetchImpl: async () => new Response(JSON.stringify({ error:{ message:'quota exhausted' } }), { status:429 }) });
  await assert.rejects(() => rateLimited.interpretHistoricalSegment(fixture()), { code:'historical_intelligence_rate_limited' });
  const rejected = createHistoricalGeminiInterpreter({ apiKey:'test-key', fetchImpl: async () => new Response(JSON.stringify({ error:{ code:400, status:'INVALID_ARGUMENT', message:'responseJsonSchema too complex key=AIza-NO-LOG' } }), { status:400 }) });
  const error = await rejected.interpretHistoricalSegment(fixture()).then(() => null, value => value);
  assert.equal(error.code, 'historical_intelligence_provider_rejected');
  assert.equal(error.provider_diagnostic.category, 'SCHEMA_UNSUPPORTED');
  assert.equal(JSON.stringify(error.provider_diagnostic).includes('AIza-NO-LOG'), false);
  assert.equal('message' in error.provider_diagnostic, false);
});

test('el adaptador no acepta una solicitud que no provenga del contrato histórico exacto', async () => {
  const interpreter = createHistoricalGeminiInterpreter({ apiKey:'test-key', fetchImpl: async () => { throw new Error('must_not_fetch'); } });
  await assert.rejects(() => interpreter.interpretHistoricalSegment({ response_mime_type:'application/json', response_json_schema:{}, prompt:'sintético' }), { code:'historical_intelligence_request_invalid' });
});
