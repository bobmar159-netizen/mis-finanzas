'use strict';

const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { STATES, classify, summarize, explainPublicStatus } = require('./lib/yarbi-f3tv-result-classification.cjs');

const cases = [];
async function test(name, fn) { try { await fn(); cases.push({ name, status: 'PASS' }); } catch (error) { cases.push({ name, status: 'FAIL', error: error.message }); } }

async function main() {
  const root = path.join(__dirname, '..');
  const evidence = JSON.parse(await readFile(path.join(root, 'scripts', 'gemini-v4-temporal-validation-evidence.json'), 'utf8'));
  const first = evidence.results.find(row => row.fixture_id === 'F3TV-01');
  await test('F3TV-01 clasifica el 503 de Gemini como BLOCKED_PROVIDER aunque el HTTP público sea 422', () => {
    assert.equal(first.provider_http_status, 503); assert.equal(first.request_http_status, 422); assert.equal(classify(first), STATES.BLOCKED_PROVIDER);
  });
  await test('F3TV-02 y F3TV-03 ausentes se representan explícitamente como NOT_EXECUTED', () => {
    const summary = summarize(evidence.results);
    assert.equal(summary.fixture_results.find(row => row.fixture_id === 'F3TV-02').state, STATES.NOT_EXECUTED);
    assert.equal(summary.fixture_results.find(row => row.fixture_id === 'F3TV-03').state, STATES.NOT_EXECUTED);
  });
  await test('un bloqueo del proveedor no entra al denominador semántico', () => {
    const summary = summarize(evidence.results);
    assert.equal(summary.counts.BLOCKED_PROVIDER, 1); assert.equal(summary.semantic.evaluated, 0); assert.equal(summary.semantic.pass_ratio, '0/0');
  });
  await test('un resultado semántico ejecutado continúa contando como evaluación', () => {
    const summary = summarize([{ fixture_id: 'F3TV-01', request_count: 1, provider_http_status: 200, request_http_status: 200, pipeline: { semantic: { pass: true } } }]);
    assert.equal(summary.counts.SEMANTIC_PASS, 1); assert.equal(summary.semantic.pass_ratio, '1/1');
  });
  await test('un fallo semántico real continúa siendo SEMANTIC_FAIL', () => {
    const row = { fixture_id: 'F3TV-01', request_count: 1, provider_http_status: 200, request_http_status: 422, pipeline: { semantic: { pass: false } } };
    assert.equal(classify(row), STATES.SEMANTIC_FAIL);
  });
  await test('la explicación sanitizada documenta el 422 sin alterar el contrato público', () => {
    assert.equal(explainPublicStatus(first), 'PUBLIC_422_NONCRITICAL_DIAGNOSTIC_FAILURE_WITH_PROVIDER_5XX');
  });
  const failed = cases.filter(item => item.status === 'FAIL');
  process.stdout.write(JSON.stringify({ phase: 'yarbi_f3tv_result_classification_local', result: failed.length ? 'FAIL' : 'PASS', passed: cases.length - failed.length, total: cases.length, failures: failed, network_calls: 0, gemini_calls: 0, commercial_actions: 0 }) + '\n');
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(error => { process.stderr.write(String(error?.message || error)); process.exitCode = 1; });
