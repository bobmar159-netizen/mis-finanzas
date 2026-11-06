'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  INVALID_ARGUMENT_CATEGORIES,
  classifyGeminiInvalidArgument,
  schemaStatistics,
  sanitizedLogicalRequest
} = require('../lib/yarbi-gemini-request-forensics');
const {
  GEMINI_HOST,
  DEFAULT_MODEL,
  ownerUnderstandingJsonSchema,
  createGeminiOwnerUnderstandingProvider
} = require('../lib/yarbi-gemini-owner-understanding');

async function captureRealBuilder() {
  let captured;
  const provider = createGeminiOwnerUnderstandingProvider({
    apiKey: 'F3-FORENSIC-KEY-NOT-REAL',
    fetchImpl: async (url, options) => {
      captured = sanitizedLogicalRequest(url, options);
      return new Response(JSON.stringify({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'synthetic invalid schema' } }), { status: 400 });
    }
  });
  await assert.rejects(() => provider.understandOwnerUtterance({
    utterance: 'F3-FORENSIC frase sintética',
    context: { task: 'reference_lookup', intent: 'reference_lookup', active_constraints: {} }
  }), { code: 'owner_understanding_provider_rejected', status: 400 });
  return captured;
}

test('reconstruye la petición lógica real sin red ni secretos', async () => {
  const request = await captureRealBuilder();
  const parsed = new URL(request.url);
  assert.equal(parsed.hostname, GEMINI_HOST);
  assert.equal(parsed.pathname, `/v1beta/models/${DEFAULT_MODEL}:generateContent`);
  assert.equal(request.method, 'POST');
  assert.equal(request.authentication, 'x-goog-api-key:[REDACTED]');
  assert.equal(JSON.stringify(request).includes('F3-FORENSIC-KEY-NOT-REAL'), false);
  assert.deepEqual(Object.keys(request.body).sort(), ['contents', 'generationConfig']);
  assert.equal(request.body.generationConfig.temperature, 0);
  assert.equal(request.body.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(request.body.generationConfig.responseJsonSchema, ownerUnderstandingJsonSchema());
  assert.equal('tools' in request.body, false);
});

test('el esquema usa únicamente keywords documentadas y conserva su contrato completo', () => {
  const schema = ownerUnderstandingJsonSchema();
  const stats = schemaStatistics(schema);
  assert.deepEqual(stats.unsupported_keywords, []);
  assert.equal(schema.type, 'object');
  assert.equal(schema.additionalProperties, false);
  assert.ok(schema.required.includes('entity_mentions'));
  assert.ok(schema.required.includes('constraints'));
  assert.deepEqual(schema.properties.constraints.properties.recency.properties.days.type, ['number', 'null']);
  assert.equal(schema.properties.confidence.minimum, 0);
  assert.equal(schema.properties.confidence.maximum, 1);
  assert.equal(stats.serialized_bytes, Buffer.byteLength(JSON.stringify(schema)));
  assert.ok(stats.max_depth >= 5);
  assert.ok(stats.required_entry_count >= 70);
});

test('clasifica errores simulados sin conservar el mensaje del proveedor', () => {
  const cases = [
    [{ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'responseJsonSchema is too complex' } }, INVALID_ARGUMENT_CATEGORIES.SCHEMA_UNSUPPORTED],
    [{ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'invalid schema required property' } }, INVALID_ARGUMENT_CATEGORIES.SCHEMA_INVALID],
    [{ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'model does not support structured output' } }, INVALID_ARGUMENT_CATEGORIES.MODEL_CONFIGURATION_INVALID],
    [{ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'generationConfig temperature is unsupported' } }, INVALID_ARGUMENT_CATEGORIES.GENERATION_CONFIG_INVALID],
    [{ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Unknown field responseFoo' } }, INVALID_ARGUMENT_CATEGORIES.REQUEST_FIELD_UNSUPPORTED],
    [{ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'generic invalid argument' } }, INVALID_ARGUMENT_CATEGORIES.PROVIDER_INVALID_ARGUMENT_UNKNOWN],
    [{ status: 0, message: 'JSON.stringify cannot convert BigInt' }, INVALID_ARGUMENT_CATEGORIES.SDK_SERIALIZATION_ERROR]
  ];
  for (const [input, expected] of cases) {
    const result = classifyGeminiInvalidArgument(input);
    assert.equal(result.category, expected);
    assert.equal('message' in result, false);
    assert.equal(JSON.stringify(result).includes(input.error?.message || input.message), false);
  }
});

test('un 400 sin detalle estructurado permanece UNKNOWN', () => {
  const result = classifyGeminiInvalidArgument({ error: { code: 400, status: 'INVALID_ARGUMENT' } });
  assert.equal(result.category, INVALID_ARGUMENT_CATEGORIES.PROVIDER_INVALID_ARGUMENT_UNKNOWN);
  assert.equal(result.http_status, 400);
  assert.equal(result.provider_status, 'INVALID_ARGUMENT');
  assert.equal(result.signals.invalid_argument, true);
});
