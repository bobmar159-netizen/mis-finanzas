'use strict';

// Preparador local. No contiene cliente HTTP ni puede invocar Gemini. La
// ejecución futura requiere una fase separada que implemente y autorice la
// ruta aislada correspondiente.
const { writeFile } = require('node:fs/promises');
const path = require('node:path');
const { CASES, validateFixtures, REFERENCE_TIME, TIME_ZONE } = require('../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-v4-post-corrections-fixtures');

const OUTPUT = path.join(__dirname, 'gemini-v4-post-corrections-preparation-evidence.json');
const FUTURE_ENDPOINT = '/api/diagnostics/gemini-v4-post-corrections-validation';
const ISOLATED_PROJECT_REF = 'uevilhbstnmmdlgyshlv';

function safeFixture(item) {
  return {
    fixture_id: item.id,
    family: item.family,
    has_structured_antecedent: Object.keys(item.state?.active_constraints || {}).length > 0,
    has_reference_time: item.diagnostic_context?.reference_time === REFERENCE_TIME,
    has_time_zone: item.diagnostic_context?.time_zone === TIME_ZONE,
    expected: {
      positive_count: Array.isArray(item.expect?.positive) ? item.expect.positive.length : 0,
      negated_count: Array.isArray(item.expect?.negated) ? item.expect.negated.length : 0,
      correction: item.expect?.correction || 'none',
      continuation: item.expect?.continuation || 'none',
      clarification: item.expect?.clarification === true
    }
  };
}

async function main() {
  const executeRequested = process.argv.includes('--execute');
  const validation = validateFixtures();
  if (!validation.valid) throw new Error('post_corrections_fixture_contract_invalid');
  const evidence = {
    phase: 'gemini_v4_post_corrections_preparation',
    result: executeRequested ? 'EXECUTION_DISABLED_PENDING_EXPLICIT_AUTHORIZATION' : 'PREPARED_NO_EXECUTION',
    exact_request_count_prepared: CASES.length,
    automatic_retries: 0,
    execute_false: true,
    future_endpoint: FUTURE_ENDPOINT,
    isolated_project_ref: ISOLATED_PROJECT_REF,
    owner_scope: 'synthetic_owner_required',
    no_commercial_handlers: true,
    no_candidate_queries: true,
    reference_time: REFERENCE_TIME,
    time_zone: TIME_ZONE,
    fixtures: CASES.map(safeFixture),
    execution_requirements: [
      'explicit_user_authorization',
      'isolated_preview_deployment_with_a_dedicated_route',
      'authenticated_synthetic_owner',
      'one_request_per_fixture',
      'zero_automatic_retries',
      'execute_false',
      'no_commercial_handlers'
    ],
    secrets_persisted: false,
    prompts_persisted: false,
    provider_responses_persisted: false
  };
  await writeFile(OUTPUT, JSON.stringify(evidence, null, 2), { encoding: 'utf8', mode: 0o600 });
  process.stdout.write(JSON.stringify({ phase: evidence.phase, result: evidence.result, evidence: path.basename(OUTPUT), prepared_requests: evidence.exact_request_count_prepared, execution_network_calls: 0 }) + '\n');
  if (executeRequested) process.exitCode = 2;
}

main().catch(error => { process.stderr.write(JSON.stringify({ phase: 'gemini_v4_post_corrections_preparation', result: 'FAIL', error: String(error?.message || 'preparation_failed').replace(/[^a-z0-9_:-]/gi, '') }) + '\n'); process.exitCode = 1; });
