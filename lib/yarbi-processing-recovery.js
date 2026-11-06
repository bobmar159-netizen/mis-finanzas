const MAX_ANALYSIS_ATTEMPTS = 3;

function cleanPhone(value) {
  let valueDigits = String(value || '').replace(/\D/g, '');
  if (valueDigits.startsWith('51') && valueDigits.length === 11) valueDigits = valueDigits.slice(2);
  return valueDigits.length >= 8 && valueDigits.length <= 15 ? valueDigits : '';
}

function canonicalMessagePartition(jobs, messages) {
  const byId = new Map((messages || []).map(message => [String(message?.id || ''), message]).filter(([id]) => id));
  const found = [];
  const unresolved = [];
  const duplicateJobs = [];
  const seenMessageIds = new Set();
  for (const job of jobs || []) {
    const messageId = String(job?.message_id || '');
    if (seenMessageIds.has(messageId)) {
      // La cola debe tener una restricción única por mensaje y versión. Si un
      // dato histórico la contradice, se conserva para revisión pero nunca se
      // procesa dos veces el mismo mensaje durante una ejecución.
      duplicateJobs.push(job);
      continue;
    }
    seenMessageIds.add(messageId);
    const message = byId.get(messageId);
    if (message && String(message.text || '').trim()) found.push({ job, message });
    else unresolved.push(job);
  }
  return { found, unresolved, duplicateJobs };
}

function classifyGeminiFailure(error) {
  const detail = String(error?.message || error || '').toLowerCase();
  if (/http 429|quota|resource_exhausted|rate.?limit/.test(detail)) return { code: 'gemini_quota', retryable: true, minimumDelayMs: 30 * 60 * 1000 };
  if (/timeout|timed out|abort/.test(detail)) return { code: 'gemini_timeout', retryable: true, minimumDelayMs: 5 * 60 * 1000 };
  if (/http 5\d\d|internal|unavailable|overloaded/.test(detail)) return { code: 'gemini_transient', retryable: true, minimumDelayMs: 5 * 60 * 1000 };
  if (/json|unexpected|unterminated|incompleto|válido/.test(detail)) return { code: 'gemini_invalid_json', retryable: true, minimumDelayMs: 10 * 60 * 1000 };
  return { code: 'processing_failure', retryable: true, minimumDelayMs: 60 * 1000 };
}

function retryDelayMs(attemptCount, failure) {
  const exponent = Math.max(0, Math.min(2, Number(attemptCount || 1) - 1));
  return Math.max(Number(failure?.minimumDelayMs || 0), Math.min(30 * 60 * 1000, 60 * 1000 * (2 ** exponent)));
}

function failureTransition(job, error, now = Date.now()) {
  const failure = classifyGeminiFailure(error);
  const attempts = Math.max(0, Number(job?.attempt_count || 0));
  if (attempts >= MAX_ANALYSIS_ATTEMPTS || !failure.retryable) {
    return { status: 'skipped', error_code: failure.code, next_retry_at: null, completed_at: new Date(now).toISOString() };
  }
  return { status: 'failed', error_code: failure.code, next_retry_at: new Date(now + retryDelayMs(attempts, failure)).toISOString(), completed_at: null };
}

function identityPendingTransition() {
  return { status: 'identity_pending', requires_review: true, error_code: 'identity_pending', next_retry_at: null, completed_at: null };
}

module.exports = { MAX_ANALYSIS_ATTEMPTS, canonicalMessagePartition, cleanPhone, classifyGeminiFailure, failureTransition, identityPendingTransition, retryDelayMs };
