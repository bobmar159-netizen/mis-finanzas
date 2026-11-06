import { next } from '@vercel/functions';
import previewRoutePolicy from './lib/preview-route-policy.js';

export const config = { runtime: 'nodejs' };

// Vercel acepta los entrypoints de proxy con extensión .js. El contenido
// conserva el mismo cortafuegos de auditoría y se ejecuta antes de /api/*.
export default function proxy(request) {
  const decision = previewRoutePolicy.decidePreviewRouteRequest(request, process.env);
  if (decision.allow) return next();
  return new Response(JSON.stringify({ ok: false, error: decision.code }), {
    status: decision.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
