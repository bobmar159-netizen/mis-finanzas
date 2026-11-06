'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootUnderstanding = require('../lib/yarbi-gemini-owner-understanding');
const previewUnderstanding = require('../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-gemini-owner-understanding');
const rootForensics = require('../lib/yarbi-gemini-request-forensics');
const previewForensics = require('../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-gemini-request-forensics');
const rootTrace = require('../lib/yarbi-trace');
const previewTrace = require('../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-trace');

test('el candidato Preview conserva exactamente modelo, esquema y hash del backend local', () => {
  assert.equal(previewUnderstanding.DEFAULT_MODEL, rootUnderstanding.DEFAULT_MODEL);
  assert.deepEqual(previewUnderstanding.ownerUnderstandingJsonSchema(), rootUnderstanding.ownerUnderstandingJsonSchema());
  assert.equal(
    previewForensics.schemaSha256(previewUnderstanding.ownerUnderstandingJsonSchema()),
    rootForensics.schemaSha256(rootUnderstanding.ownerUnderstandingJsonSchema())
  );
});

test('el candidato Preview clasifica y sanitiza igual que el backend local', () => {
  const simulated = {
    error: {
      code: 400,
      status: 'INVALID_ARGUMENT',
      details: [{ fieldViolations: [{ field: 'generationConfig.responseJsonSchema', description: 'Schema complexity token=AIza-SYNTHETIC' }] }]
    }
  };
  assert.deepEqual(previewForensics.classifyGeminiInvalidArgument(simulated), rootForensics.classifyGeminiInvalidArgument(simulated));
  const diagnostic = {
    provider: 'gemini', http_status: 400, provider_status: 'INVALID_ARGUMENT', category: 'SCHEMA_UNSUPPORTED',
    schema_sha256: 'a'.repeat(64), model: 'gemini-3.5-flash-lite',
    signals: { invalid_argument: true, mentions_schema: true, mentions_complexity: true },
    message: 'secret=AIza-SYNTHETIC'
  };
  assert.deepEqual(previewTrace.safeProviderDiagnostic(diagnostic), rootTrace.safeProviderDiagnostic(diagnostic));
  assert.equal(JSON.stringify(previewTrace.safeProviderDiagnostic(diagnostic)).includes('AIza-SYNTHETIC'), false);
});

test('la ruta Preview propaga únicamente provider_diagnostic hacia la traza', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'PREVIEW_REFERENCIAS_AISLADO', 'api', 'assistant', 'reference-candidates.js'), 'utf8');
  assert.match(source, /provider_diagnostic:\s*error\?\.provider_diagnostic\s*\|\|\s*null/);
  assert.doesNotMatch(source, /provider_diagnostic:\s*error\?\.(detail|message)/);
});
