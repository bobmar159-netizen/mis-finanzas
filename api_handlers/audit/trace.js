const { decidePreviewAuditRequest } = require('../../lib/preview-audit-policy');
const { executeSyntheticTrace } = require('../../lib/preview-audit-synthetic');
const { recordTrace } = require('../../lib/yarbi-trace');

// Único endpoint permitido por el proxy cuando YARBI_PREVIEW_AUDIT_ONLY=true.
// Genera solo referencias sintéticas y se autentica por un secreto exclusivo
// del preview. No admite teléfonos, textos, clientes ni instrucciones.
module.exports = async function handler(req, res) {
  const decision = decidePreviewAuditRequest(req, process.env);
  if (!decision.allow) return res.status(decision.status).json({ ok: false, error: decision.code });
  try {
    const result = await executeSyntheticTrace({
      secret: decision.config.config.traceHmacKey,
      runId: 'phase1d-preview',
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
