'use strict';

const { buildHistoricalIntelligenceRequest, normalizeHistoricalIntelligenceResult } = require('./yarbi-historical-intelligence');
const { verifiedOwnerId } = require('./yarbi-owner-scope');

function safeCode(value) {
  return String(value?.code || value?.message || 'historical_model_failed').toLowerCase()
    .replace(/[^a-z0-9_:-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'historical_model_failed';
}

// Orquestador sin proveedor acoplado. `interpret` se inyectará desde la
// integración Gemini autorizada; mientras tanto las pruebas usan un modelo
// simulado. Así ningún flujo local puede invocar Gemini por accidente.
function createHistoricalIntelligenceProcessor({ queue, resolveOwnerScope, readTaskMessages, interpret } = {}) {
  return {
    async processOne({ ownerIdentity } = {}) {
      const ownerId = verifiedOwnerId(ownerIdentity);
      if (!queue || typeof queue.claim !== 'function' || typeof queue.complete !== 'function' || typeof queue.fail !== 'function'
        || typeof resolveOwnerScope !== 'function' || typeof readTaskMessages !== 'function' || typeof interpret !== 'function') {
        const error = new Error('historical_processor_dependencies_unavailable');
        error.code = error.message;
        throw error;
      }
      const task = await queue.claim({ ownerIdentity });
      if (!task) return { outcome: 'no_ready_historical_segment', owner_id: ownerId, gemini_invoked: false };
      let modelInvoked = false;
      try {
        const scope = await resolveOwnerScope(ownerIdentity);
        if (String(scope?.owner_id || '') !== ownerId || !new Set((scope?.contact_ids || []).map(String)).has(String(task.contact_id))) {
          const error = new Error('historical_task_owner_scope_invalid');
          error.code = error.message;
          throw error;
        }
        const messages = await readTaskMessages(task);
        const request = buildHistoricalIntelligenceRequest({ task, messages });
        modelInvoked = true;
        const modelResult = await interpret(request, { task: { ...task } });
        const normalized = normalizeHistoricalIntelligenceResult({ task, result: modelResult });
        await queue.complete({ ownerIdentity, task, result: normalized });
        return {
          outcome: 'historical_segment_awaiting_owner_review', owner_id: ownerId,
          batch_id: task.batch_id, contact_id: task.contact_id,
          segment_index: task.segment_index, segment_count: task.segment_count,
          observations: normalized.contact_context_observations.length,
          reply_style_patterns: normalized.reply_style_patterns.length,
          gemini_invoked: true, requires_owner_review: true, commercial_effects_allowed: false
        };
      } catch (error) {
        const code = safeCode(error);
        try { await queue.fail({ ownerIdentity, task, error_code: code }); } catch (_) {}
        return {
          outcome: 'historical_segment_failed', owner_id: ownerId,
          batch_id: task.batch_id, contact_id: task.contact_id,
          error_code: code, gemini_invoked: modelInvoked, requires_owner_review: true, commercial_effects_allowed: false
        };
      }
    }
  };
}

module.exports = { createHistoricalIntelligenceProcessor, safeCode };
