'use strict';

const { authenticatedOwnerIdentity } = require('../../lib/yarbi-owner-ui-auth');
const { runGeminiMinimalSchemaProbe } = require('../../lib/yarbi-gemini-owner-understanding');
const { decideGeminiMinimalSchemaExperimentRequest } = require('../../lib/preview-gemini-schema-experiment-policy');

const FIXTURE_ID = 'F3G-SERVICE';
const FIXTURE_REQUEST = Object.freeze({ utterance: 'El del punto adicional.' });
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function safeCode(value) { return String(value || '').replace(/[^a-z0-9_:-]/gi, '').slice(0, 96) || null; }

function createGeminiMinimalSchemaHandler({ authenticate = authenticatedOwnerIdentity, runProbe = runGeminiMinimalSchemaProbe } = {}) {
  return async function geminiMinimalSchemaHandler(req, res) {
    const decision = decideGeminiMinimalSchemaExperimentRequest(req, process.env);
    if (!decision.allow) return res.status(decision.status).json({ ok: false, error: decision.code, execute: false });
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : object(req.body);
    if (Object.keys(body).length !== 1 || body.fixture_id !== FIXTURE_ID) return res.status(400).json({ ok: false, error: 'gemini_minimal_schema_fixture_forbidden', execute: false });
    const authenticated = await authenticate(req, decision.state.config);
    if (!authenticated.ok) return res.status(authenticated.status).json({ ok: false, error: authenticated.code, execute: false });
    if (authenticated.user?.id !== decision.state.config.experimentOwnerAccountId) return res.status(403).json({ ok: false, error: 'gemini_minimal_schema_owner_forbidden', execute: false });
    const result = await runProbe({ apiKey: decision.state.config.gemini.apiKey, model: decision.state.config.gemini.model, timeoutMs: decision.state.config.gemini.timeoutMs, request: FIXTURE_REQUEST });
    return res.status(result.accepted ? 200 : 503).json({
      ok: result.accepted, schema: 'yarbi.gemini-minimal-schema.v1', fixture_id: FIXTURE_ID, execute: false, route: 'GEMINI_MINIMAL_SCHEMA_EXPERIMENT',
      response_json_schema_sent: result.response_json_schema_sent === true, minimal_schema_sha256: result.minimal_schema_sha256 || null, model: result.model || null,
      provider_http_status: result.provider_http_status || null, provider_diagnostic: result.provider_diagnostic || null,
      provider_ms: Number.isFinite(Number(result.provider_ms)) ? Number(result.provider_ms) : null,
      response_json_valid: result.response_json_valid === true, response_schema_valid: result.response_schema_valid === true,
      error: result.accepted ? null : safeCode(result.error_code), commercial_actions_executed: false
    });
  };
}
module.exports = createGeminiMinimalSchemaHandler();
module.exports.createGeminiMinimalSchemaHandler = createGeminiMinimalSchemaHandler;
