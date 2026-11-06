import { next } from '@vercel/functions';
import auditPolicy from './lib/preview-audit-policy.js';

export const config = { runtime: 'nodejs' };

export default function proxy(request) {
  const decision = auditPolicy.decidePreviewAuditRequest(request, process.env);
  if (!decision.allow) {
    return new Response(JSON.stringify({ ok: false, error: decision.code }), {
      status: decision.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  }
  return next();
}
