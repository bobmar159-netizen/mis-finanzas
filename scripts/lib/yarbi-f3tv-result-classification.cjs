'use strict';

// Clasificación de presentación para evidencia F3TV. No participa en el
// handler, el esquema V4 ni el pipeline semántico: sólo evita representar una
// indisponibilidad del proveedor como un fallo de comprensión.
const FIXTURE_IDS = Object.freeze(['F3TV-01', 'F3TV-02', 'F3TV-03']);
const STATES = Object.freeze({
  SEMANTIC_PASS: 'SEMANTIC_PASS',
  SEMANTIC_FAIL: 'SEMANTIC_FAIL',
  BLOCKED_PROVIDER: 'BLOCKED_PROVIDER',
  BLOCKED_SECURITY: 'BLOCKED_SECURITY',
  NOT_EXECUTED: 'NOT_EXECUTED'
});

function finite(value) { return Number.isFinite(Number(value)) ? Number(value) : null; }
function semanticPass(row) { return row?.pipeline?.semantic?.pass === true || row?.pipeline?.semantic_pass === true; }
function criticalSecurity(row) { return row?.pipeline?.semantic?.critical_security_failure === true || row?.pipeline?.critical_security_failure === true; }
function wasExecuted(row) { return Boolean(row && FIXTURE_IDS.includes(row.fixture_id) && row.transport_error == null && Number(row.request_count) === 1); }

function classify(row) {
  if (!wasExecuted(row)) return STATES.NOT_EXECUTED;
  const providerStatus = finite(row.provider_http_status);
  // La disponibilidad del proveedor se evalúa antes que el HTTP público: el
  // endpoint diagnóstico puede representar una respuesta semántica no usable
  // como 422 aunque Gemini haya respondido 5xx.
  if (providerStatus !== null && providerStatus >= 500 && providerStatus <= 599) return STATES.BLOCKED_PROVIDER;
  if (criticalSecurity(row) || [400, 401, 403, 429].includes(providerStatus)) return STATES.BLOCKED_SECURITY;
  if (semanticPass(row)) return STATES.SEMANTIC_PASS;
  return STATES.SEMANTIC_FAIL;
}

function rowsForExpectedFixtures(results) {
  const byId = new Map((Array.isArray(results) ? results : []).filter(row => FIXTURE_IDS.includes(row?.fixture_id)).map(row => [row.fixture_id, row]));
  return FIXTURE_IDS.map(fixtureId => {
    const row = byId.get(fixtureId) || null;
    return { fixture_id: fixtureId, state: classify(row), executed: wasExecuted(row), provider_http_status: finite(row?.provider_http_status), request_http_status: finite(row?.request_http_status) };
  });
}

function summarize(results) {
  const rows = rowsForExpectedFixtures(results);
  const counts = Object.fromEntries(Object.values(STATES).map(state => [state, 0]));
  for (const row of rows) counts[row.state] += 1;
  const evaluatedSemantic = counts[STATES.SEMANTIC_PASS] + counts[STATES.SEMANTIC_FAIL];
  return { fixture_results: rows, counts, semantic: { passed: counts[STATES.SEMANTIC_PASS], failed: counts[STATES.SEMANTIC_FAIL], evaluated: evaluatedSemantic, pass_ratio: `${counts[STATES.SEMANTIC_PASS]}/${evaluatedSemantic}` } };
}

function explainPublicStatus(row) {
  const providerStatus = finite(row?.provider_http_status);
  const publicStatus = finite(row?.request_http_status);
  if (publicStatus === 422 && providerStatus !== null && providerStatus >= 500 && providerStatus <= 599) return 'PUBLIC_422_NONCRITICAL_DIAGNOSTIC_FAILURE_WITH_PROVIDER_5XX';
  return 'PUBLIC_STATUS_NOT_CLASSIFIED_BY_F3TV_PRESENTATION';
}

module.exports = { FIXTURE_IDS, STATES, classify, summarize, explainPublicStatus };
