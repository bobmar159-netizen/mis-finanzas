'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const expected = Object.freeze({
  'lib/yarbi-gemini-owner-understanding.js': '9ac6ef621d4edc5586c0bb5522f4c55be073869550636c85b35564dd1e9bff8d',
  'lib/yarbi-gemini-request-forensics.js': '8e256ae383a351ec1f0ad77daf2662a9ae5b8c148610d758baf27edb20a3b2c9',
  'lib/yarbi-trace.js': 'e6e42bdc9d829c8c2cea90843e05cc15f643aae6719514b3f14113381bbbf0db',
  'api/assistant/reference-candidates.js': 'f6bc98d128892573d8527abc825a14f4641248a2c5a23143510f8b4dd36c0e3c'
});

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function replaceExact(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`baseline_reverse_pattern_missing:${label}`);
  return source.replace(before, after);
}

function baselineOwner(source) {
  let value = source;
  value = replaceExact(value, "const { classifyGeminiInvalidArgument, schemaSha256 } = require('./yarbi-gemini-request-forensics');\n", '', 'owner_import');
  value = replaceExact(value, `function classifyFailure(response, providerBody, { model, schemaHash } = {}) {
  const error = new Error('owner_understanding_unavailable');
  error.code = response?.status === 429 ? 'owner_understanding_rate_limited'
    : response?.status >= 500 ? 'owner_understanding_unavailable'
      : response?.status ? 'owner_understanding_provider_rejected' : 'owner_understanding_unavailable';
  error.status = response?.status || 0;
  const classified = classifyGeminiInvalidArgument(providerBody);
  error.provider_diagnostic = Object.freeze({
    provider: 'gemini',
    http_status: error.status || classified.http_status,
    provider_status: classified.provider_status,
    category: classified.category,
    signals: classified.signals,
    schema_sha256: text(schemaHash, 64).toLowerCase() || null,
    model: text(model, 120) || null
  });
  return error;
}`, `function classifyFailure(response, detail) {
  const error = new Error('owner_understanding_unavailable');
  error.code = response?.status === 429 ? 'owner_understanding_rate_limited'
    : response?.status >= 500 ? 'owner_understanding_unavailable'
      : response?.status ? 'owner_understanding_provider_rejected' : 'owner_understanding_unavailable';
  error.status = response?.status || 0;
  error.detail = text(detail, 160) || null;
  return error;
}`, 'owner_failure');
  value = replaceExact(value, `      const responseSchema = ownerUnderstandingJsonSchema();
      const responseSchemaHash = schemaSha256(responseSchema);
`, '', 'owner_schema_locals');
  value = replaceExact(value, 'responseJsonSchema: responseSchema', 'responseJsonSchema: ownerUnderstandingJsonSchema()', 'owner_schema_body');
  value = replaceExact(value, 'throw classifyFailure(response, body, { model: selectedModel, schemaHash: responseSchemaHash });', 'throw classifyFailure(response, body?.error?.message);', 'owner_throw');
  return value;
}

function baselineForensics(source) {
  let value = source;
  value = replaceExact(value, "const crypto = require('node:crypto');\n\n", '', 'forensics_crypto');
  const detailsStart = value.indexOf('function structuredDetailSignal(details) {');
  const detailsEnd = value.indexOf('\nfunction providerErrorView(errorLike)', detailsStart);
  if (detailsStart < 0 || detailsEnd < 0) throw new Error('baseline_reverse_pattern_missing:forensics_details');
  value = value.slice(0, detailsStart) + value.slice(detailsEnd);
  value = replaceExact(value, ",\n    structured_detail_signal: structuredDetailSignal(source.details || nested.details) || null", '', 'forensics_view');
  value = replaceExact(value, "${view.message || ''} ${view.structured_detail_signal || ''}", "${view.message || ''}", 'forensics_signal');
  value = replaceExact(value, "  } else if (/(too many states for serving|schema complexity)/.test(signal) || (/(response.?json.?schema|json schema|schema)/.test(signal) && /(too complex|complexity|unsupported keyword|not supported|unsupported feature)/.test(signal))) {\n", "  } else if (/(response.?json.?schema|json schema|schema)/.test(signal) && /(too complex|complexity|unsupported keyword|not supported|unsupported feature)/.test(signal)) {\n", 'forensics_complexity_rule');
  value = replaceExact(value, 'mentions_complexity: /(too complex|complexity|too many states for serving)/.test(signal)', 'mentions_complexity: /(too complex|complexity)/.test(signal)', 'forensics_complexity_signal');
  value = replaceExact(value, `function schemaSha256(schema) {
  return crypto.createHash('sha256').update(JSON.stringify(schema || {})).digest('hex');
}

`, '', 'forensics_hash_function');
  value = replaceExact(value, '  schemaSha256,\n', '', 'forensics_hash_export');
  return value;
}

function baselineTrace(source) {
  let value = source;
  const constantsStart = value.indexOf('const PROVIDER_DIAGNOSTIC_CATEGORIES = new Set([');
  const constantsEnd = value.indexOf('\n\nfunction cleanText', constantsStart);
  if (constantsStart < 0 || constantsEnd < 0) throw new Error('baseline_reverse_pattern_missing:trace_constants');
  value = value.slice(0, constantsStart) + value.slice(constantsEnd + 1);
  const functionStart = value.indexOf('function safeProviderDiagnostic(value) {');
  const functionEnd = value.indexOf('\n\nfunction safeTraceEvent', functionStart);
  if (functionStart < 0 || functionEnd < 0) throw new Error('baseline_reverse_pattern_missing:trace_function');
  value = value.slice(0, functionStart) + value.slice(functionEnd + 1);
  value = replaceExact(value, ',\n    provider_diagnostic: safeProviderDiagnostic(event.provider_diagnostic)', '', 'trace_safe_event');
  value = replaceExact(value, ',\n    provider_diagnostic: event.provider_diagnostic', '', 'trace_fingerprint');
  value = replaceExact(value, ",\n      ...(event.provider_diagnostic ? { provider_diagnostic: event.provider_diagnostic } : {})", '', 'trace_record');
  value = replaceExact(value, '    provider_diagnostic: safeProviderDiagnostic(result.provider_diagnostic),\n', '', 'trace_view');
  value = replaceExact(value, '  safeProviderDiagnostic,\n', '', 'trace_export');
  return value;
}

function baselineReference(source) {
  return replaceExact(source, ",\n    provider_diagnostic: error?.provider_diagnostic || null", '', 'reference_trace');
}

const transformers = Object.freeze({
  'lib/yarbi-gemini-owner-understanding.js': baselineOwner,
  'lib/yarbi-gemini-request-forensics.js': baselineForensics,
  'lib/yarbi-trace.js': baselineTrace,
  'api/assistant/reference-candidates.js': baselineReference
});

function reconstruct(relativePath) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  return transformers[relativePath](source);
}

function verify() {
  const files = Object.keys(expected).map(relativePath => {
    const reconstructed = reconstruct(relativePath);
    const actual = sha256(reconstructed);
    return { relative_path: relativePath, expected_sha256: expected[relativePath], reconstructed_sha256: actual, matches: actual === expected[relativePath] };
  });
  return { result: files.every(item => item.matches) ? 'PASS' : 'FAIL', files };
}

if (require.main === module) {
  const result = verify();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.result !== 'PASS') process.exitCode = 1;
}

module.exports = { expected, reconstruct, verify };
