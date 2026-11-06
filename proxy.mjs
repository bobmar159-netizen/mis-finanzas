import { next } from '@vercel/functions';
import previewRoutePolicy from './lib/preview-route-policy.js';

export const config = { runtime: 'nodejs' };

// Vercel Routing Middleware: se ejecuta antes de cualquier Function que
// coincida con /api/:path*. En preview de auditoría, cualquier ruta no
// incluida explícitamente se bloquea antes de que cargue su lógica comercial.
export default function proxy(request) {
  const decision = previewRoutePolicy.decidePreviewRouteRequest(request, process.env);
  if (decision.allow) return next();
  return new Response(JSON.stringify({ ok: false, error: decision.code }), {
    status: decision.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
