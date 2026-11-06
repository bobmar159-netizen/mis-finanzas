const audit = require('./preview-audit-policy');
const functional = require('./preview-functional-policy');
const proactive = require('./preview-proactive-loop-policy');
const ownerAction = require('./preview-owner-action-policy');
const ownerUi = require('./preview-owner-ui-policy');
const ownerReference = require('./preview-owner-reference-policy');

// Selecciona una única política explícita. Cualquier preview sin uno de los
// dos modos queda rechazado por la política audit-only existente.
function decidePreviewRouteRequest(request, env = process.env) {
  if (ownerReference.active(env)) return ownerReference.decidePreviewOwnerReferenceRequest(request, env);
  if (ownerUi.active(env)) return ownerUi.decidePreviewOwnerUiRequest(request, env);
  if (ownerAction.active(env)) return ownerAction.decidePreviewOwnerActionRequest(request, env);
  if (proactive.proactiveLoopMode(env)) return proactive.decidePreviewProactiveLoopRequest(request, env);
  if (functional.syntheticFunctionalMode(env)) return functional.decidePreviewFunctionalRequest(request, env);
  return audit.decidePreviewAuditRequest(request, env);
}

// El wrapper se usa por las pruebas locales para demostrar que el handler no
// llega a cargarse cuando la guardia rechaza la solicitud. En Vercel, proxy.js
// aplica la misma decisión antes de que el runtime resuelva la Function.
async function invokeAfterPreviewGuard(request, env, loadAndInvoke) {
  const decision = decidePreviewRouteRequest(request, env);
  if (!decision.allow) return { decision, invoked: false, value: null };
  const value = await loadAndInvoke();
  return { decision, invoked: true, value };
}

module.exports = { decidePreviewRouteRequest, invokeAfterPreviewGuard };
