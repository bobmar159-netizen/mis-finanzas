const { decidePreviewAuditRequest } = require('../../lib/preview-audit-policy');
const { executeSyntheticTrace } = require('../../lib/preview-audit-synthetic');
const { recordTrace } = require('../../lib/yarbi-trace');

// Único endpoint del paquete Preview. Nunca recibe datos comerciales ni PII.
module.exports = async function handler(req, res) {
  const decision = decidePreviewAuditRequest(req, process.env);
  if (!decision.allow) return res.status(decision.status).json({ ok: false, error: decision.code });
  try {
    const result = await executeSyntheticTrace({
      secret: decision.config.config.traceHmacKey,
      runId: 'phase1g-preview',
      record: event => recordTrace({
        supabaseUrl: decision.config.config.supabaseUrl,
        supabaseKey: decision.config.config.supabaseKey,
        traceSecret: decision.config.config.traceHmacKey,
        event
      })
    });
    return res.status(200).json({
      ok: true,
      audit: {
        operation_id: result.operation_id,
        requested_event_count: result.requested_event_count,
        completed_event_count: result.completed_event_count,
        duplicate: Boolean(result.duplicate?.duplicate),
        duration_ms: result.duration_ms,
        global_status: result.reconstruction.global_status
      }
    });
  } catch (error) {
    return res.status(502).json({ ok: false, error: 'audit_trace_failed', code: String(error?.code || error?.message || 'unknown').slice(0, 80) });
  }
};
