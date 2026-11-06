'use strict';

// Puente único entre el contrato compacto V4 ya validado y el contrato V1/V3
// que consumen los resolvedores existentes. V4 sigue siendo el intérprete;
// este archivo no consulta CRM, no selecciona contactos y no ejecuta acciones.
const { strictNormalizeProposed, hardenProposed, proposedJsonSchema } = require('../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-understanding-polarity-proposal');
const { adaptV4ToV1 } = require('../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-v4-v1-adapter-proposal');
const { runGeminiV4Probe, buildGeminiV4ProbeRequest, DEFAULT_MODEL } = require('../PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-gemini-v4-probe');

function failure(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function adaptV4Understanding({ raw, utterance, state } = {}) {
  const normalized = strictNormalizeProposed(raw);
  if (!normalized.ok) throw failure('owner_understanding_v4_contract_invalid', { v4_code: normalized.code });
  const hardened = hardenProposed({ understanding: normalized.value, utterance, state });
  if (!hardened.ok) throw failure('owner_understanding_v4_hardening_rejected', { v4_code: hardened.code });
  const adapted = adaptV4ToV1(hardened.value);
  if (!adapted.ok) throw failure('owner_understanding_v4_adapter_rejected', { v4_code: adapted.code });
  return { understanding: adapted.value, diagnostics: { v4_schema: hardened.value.schema, adapter_policy: adapted.preservation?.adapter_policy || null, may_auto_select: adapted.preservation?.may_auto_select === true } };
}

// Se puede inyectar runProbe en pruebas. La ruta activa no conoce el prompt ni
// las claves: recibe este proveedor ya configurado por su adaptador server-side.
function createGeminiV4OwnerUnderstandingProvider({ apiKey, model = DEFAULT_MODEL, timeoutMs = 10000, fetchImpl, runProbe = runGeminiV4Probe } = {}) {
  if (!String(apiKey || '').trim()) throw failure('owner_understanding_provider_unavailable');
  return {
    provider: 'gemini_v4',
    model: String(model || DEFAULT_MODEL),
    schema: 'yarbi.owner-understanding.v4',
    async understandOwnerUtterance(request = {}) {
      const result = await runProbe({
        apiKey,
        model,
        timeoutMs,
        utterance: request.utterance,
        state: request.context || {},
        context: request.context?.temporal_reference || null,
        ...(typeof fetchImpl === 'function' ? { fetchImpl } : {})
      });
      if (!result?.accepted) {
        const code = String(result?.error_code || 'gemini_v4_provider_unavailable');
        throw failure(code, { provider_diagnostic: result?.provider_diagnostic || null, provider_ms: Number(result?.provider_ms || 0), schema_sha256: result?.schema_sha256 || null, model: result?.model || String(model || DEFAULT_MODEL) });
      }
      const adapted = adaptV4Understanding({ raw: result.raw, utterance: request.utterance, state: request.context || {} });
      return adapted.understanding;
    }
  };
}

module.exports = { proposedJsonSchema, buildGeminiV4ProbeRequest, adaptV4Understanding, createGeminiV4OwnerUnderstandingProvider };
