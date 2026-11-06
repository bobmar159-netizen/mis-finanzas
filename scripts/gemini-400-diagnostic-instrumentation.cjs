'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULT_MODEL,
  createGeminiOwnerUnderstandingProvider,
  ownerUnderstandingJsonSchema
} = require('../lib/yarbi-gemini-owner-understanding');
const {
  INVALID_ARGUMENT_CATEGORIES,
  schemaSha256,
  schemaStatistics
} = require('../lib/yarbi-gemini-request-forensics');
const trace = require('../lib/yarbi-trace');

const cases = [
  ['schema_complexity', { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'The specified schema produces a constraint that has too many states for serving token=AIza-SYNTHETIC' } }, INVALID_ARGUMENT_CATEGORIES.SCHEMA_UNSUPPORTED],
  ['schema_invalid', { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Invalid responseJsonSchema required property' } }, INVALID_ARGUMENT_CATEGORIES.SCHEMA_INVALID],
  ['unsupported_parameter', { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Unknown field responseFoo' } }, INVALID_ARGUMENT_CATEGORIES.REQUEST_FIELD_UNSUPPORTED],
  ['model_incompatible', { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Model does not support structured output' } }, INVALID_ARGUMENT_CATEGORIES.MODEL_CONFIGURATION_INVALID],
  ['generic', { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Generic invalid argument' } }, INVALID_ARGUMENT_CATEGORIES.PROVIDER_INVALID_ARGUMENT_UNKNOWN],
  ['no_details', { error: { code: 400, status: 'INVALID_ARGUMENT' } }, INVALID_ARGUMENT_CATEGORIES.PROVIDER_INVALID_ARGUMENT_UNKNOWN],
  ['structured_field_violation', { error: { code: 400, status: 'INVALID_ARGUMENT', details: [{ fieldViolations: [{ field: 'generationConfig.responseJsonSchema', description: 'Schema complexity is too high token=Bearer-SYNTHETIC' }] }] } }, INVALID_ARGUMENT_CATEGORIES.SCHEMA_UNSUPPORTED]
];

async function main() {
  let mockedFetchCalls = 0;
  const results = [];
  for (const [id, body, expected] of cases) {
    const provider = createGeminiOwnerUnderstandingProvider({
      apiKey: 'synthetic-key-never-sent',
      fetchImpl: async () => {
        mockedFetchCalls += 1;
        return new Response(JSON.stringify(body), { status: 400 });
      }
    });
    const error = await provider.understandOwnerUtterance({ utterance: 'Frase sintética sin datos personales.' }).then(() => null, value => value);
    const serialized = JSON.stringify(error.provider_diagnostic);
    results.push({
      id,
      expected,
      actual: error.provider_diagnostic.category,
      pass: error.provider_diagnostic.category === expected,
      raw_provider_content_absent: !/AIza-SYNTHETIC|Bearer-SYNTHETIC|too many states|fieldViolations/i.test(serialized)
    });
  }

  const schema = ownerUnderstandingJsonSchema();
  const representative = results[0];
  const syntheticDiagnostic = {
    provider: 'gemini', http_status: 400, provider_status: 'INVALID_ARGUMENT',
    category: representative.actual,
    signals: { invalid_argument: true, mentions_schema: true, mentions_complexity: true },
    schema_sha256: schemaSha256(schema), model: DEFAULT_MODEL,
    message: 'secret=AIza-SYNTHETIC', prompt: 'texto privado sintético'
  };
  const secret = 'synthetic-trace-secret-with-at-least-32-characters';
  const operationId = trace.newOperationId('gemini_diagnostic', secret);
  const record = trace.eventRecord({
    operation_id: operationId,
    event_id: trace.eventIdFor(operationId, 'provider_rejected', 'synthetic-400', secret),
    operation_type: 'gemini_diagnostic', stage: 'provider_rejected', outcome: 'failed',
    started_at: '2026-11-02T12:00:00.000Z', ended_at: '2026-11-02T12:00:00.100Z',
    component: 'local_mock', component_version: trace.traceVersion(),
    error_code: 'owner_understanding_provider_rejected_400', provider_diagnostic: syntheticDiagnostic
  }, secret);
  const recordText = JSON.stringify(record);

  const evidence = {
    schema: 'yarbi.gemini-400-diagnostic-instrumentation.v1',
    generated_at: new Date().toISOString(),
    execution: 'local_mocks_only',
    real_network_calls: 0,
    mocked_fetch_calls: mockedFetchCalls,
    model: DEFAULT_MODEL,
    response_schema_sha256: schemaSha256(schema),
    response_schema_statistics: schemaStatistics(schema),
    cases: results,
    privacy: {
      all_raw_provider_content_absent: results.every(item => item.raw_provider_content_absent),
      trace_raw_provider_content_absent: !/AIza-SYNTHETIC|texto privado sintético|too many states|fieldViolations/i.test(recordText),
      trace_fields: Object.keys(record.result_payload.provider_diagnostic || {}).sort()
    },
    contract: {
      semantic_prompt_changed: false,
      response_json_schema_changed: false,
      model_changed: false,
      generation_config_changed: false
    },
    conclusion: results.every(item => item.pass && item.raw_provider_content_absent) && !/AIza-SYNTHETIC|texto privado sintético/i.test(recordText)
      ? 'LOCAL_DIAGNOSTIC_INSTRUMENTATION_PASS'
      : 'LOCAL_DIAGNOSTIC_INSTRUMENTATION_FAIL'
  };

  const output = path.join(__dirname, 'gemini-400-diagnostic-instrumentation-evidence.json');
  fs.writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ phase: 'gemini_400_diagnostic_instrumentation', result: evidence.conclusion, evidence: path.basename(output) })}\n`);
  if (evidence.conclusion.endsWith('FAIL')) process.exitCode = 1;
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({ phase: 'gemini_400_diagnostic_instrumentation', result: 'FAIL', error: error?.code || error?.name || 'local_test_failed' })}\n`);
  process.exitCode = 1;
});
