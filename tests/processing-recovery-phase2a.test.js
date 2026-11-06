const test = require('node:test');
const assert = require('node:assert/strict');
const { MAX_ANALYSIS_ATTEMPTS, canonicalMessagePartition, cleanPhone, classifyGeminiFailure, failureTransition, identityPendingTransition } = require('../lib/yarbi-processing-recovery');

test('phase2a: canonical message remains processable without a legacy record', () => {
  const partition = canonicalMessagePartition([{ analysis_id: 1, message_id: 'canonical-1' }], [{ id: 'canonical-1', text: 'texto sintético', phone: '999111222' }]);
  assert.equal(partition.found.length, 1); assert.equal(partition.unresolved.length, 0);
});
test('phase2a: canonical partition quarantines repeated jobs without executing the message twice', () => {
  const partition = canonicalMessagePartition([{ analysis_id: 1, message_id: 'same' }, { analysis_id: 2, message_id: 'same' }], [{ id: 'same', text: 'x' }]);
  assert.equal(partition.found.length, 1);
  assert.equal(partition.duplicateJobs.length, 1);
  assert.equal(partition.duplicateJobs[0].analysis_id, 2);
});
test('phase2a: invalid identity stays pending review and is never invented', () => {
  assert.equal(cleanPhone('sin teléfono'), '');
  assert.deepEqual(identityPendingTransition(), { status: 'identity_pending', requires_review: true, error_code: 'identity_pending', next_retry_at: null, completed_at: null });
});
test('phase2a: retries stop at three claimed attempts', () => {
  assert.equal(MAX_ANALYSIS_ATTEMPTS, 3);
  assert.equal(failureTransition({ attempt_count: 2 }, new Error('Gemini HTTP 503')).status, 'failed');
  assert.equal(failureTransition({ attempt_count: 3 }, new Error('Gemini HTTP 503')).status, 'skipped');
});
test('phase2a: Gemini failures are classified without increasing model calls', () => {
  assert.equal(classifyGeminiFailure(new Error('Gemini HTTP 429 quota')).code, 'gemini_quota');
  assert.equal(classifyGeminiFailure(new Error('AbortError timeout')).code, 'gemini_timeout');
  assert.equal(classifyGeminiFailure(new Error('Gemini HTTP 503 unavailable')).code, 'gemini_transient');
  assert.equal(classifyGeminiFailure(new Error('Gemini devolvió JSON inválido')).code, 'gemini_invalid_json');
});
