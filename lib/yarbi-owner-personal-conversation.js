'use strict';

const { processOwnerTurn, createOwnerConversationState } = require('./yarbi-owner-conversation');
const { personalEventKey } = require('./yarbi-owner-personal-identity');
const { planCrmSearchFromUnderstanding } = require('./yarbi-crm-search-conversation');

function text(value, limit = 8000) {
  return String(value ?? '').trim().slice(0, limit);
}

function safeProposal(proposal) {
  const current = proposal && typeof proposal === 'object' ? proposal : { kind: 'none' };
  return { ...current, execute: false, requires_confirmation: current.kind !== 'none' };
}

async function processOwnerPersonalTurn({ classification, provider, utterance, state, candidates, providerEventId, messageId, source = 'whatsapp', hmacSecret, now } = {}) {
  if (!classification || classification.scope !== 'owner_personal' || !classification.owner_key) {
    return { outcome: 'owner_personal_not_authorized', scope: 'rejected', proposal: safeProposal({ kind: 'none' }) };
  }
  const body = text(utterance);
  if (!body) return { outcome: 'owner_personal_message_invalid', scope: 'owner_personal', proposal: safeProposal({ kind: 'none' }) };
  const idempotency_key = personalEventKey({ provider: source, providerEventId, messageId, hmacSecret });
  const result = await processOwnerTurn({
    state: state || createOwnerConversationState({ moduleOrigin: 'whatsapp_personal', visualOrigin: 'owner_personal' }),
    utterance: body,
    provider,
    candidates: Array.isArray(candidates) ? candidates : [],
    moduleOrigin: 'whatsapp_personal',
    visualOrigin: 'owner_personal',
    now
  });
  return {
    ...result,
    scope: 'owner_personal',
    owner_key: classification.owner_key,
    idempotency_key,
    proposal: safeProposal(result.proposal),
    commercial_effects_allowed: false
  };
}

// Preparación acotada para WhatsApp personal. Reutiliza el cerebro y exige
// una función de búsqueda inyectada por el adaptador autenticado; nunca toca
// YCloud, Meta ni ejecuta acciones comerciales por sí misma.
async function processOwnerPersonalCrmQuery({ classification, provider, utterance, state, candidates, providerEventId, messageId, source = 'whatsapp', hmacSecret, now, searchCrm } = {}) {
  const turn = await processOwnerPersonalTurn({ classification, provider, utterance, state, candidates, providerEventId, messageId, source, hmacSecret, now });
  if (turn.scope !== 'owner_personal' || !turn.understanding) return { ...turn, crm_search: { outcome: 'not_ready', execute: false } };
  const plan = planCrmSearchFromUnderstanding({ understanding: turn.understanding, state: turn.state });
  if (plan.outcome !== 'crm_search_ready' || typeof searchCrm !== 'function') return { ...turn, crm_search: plan };
  const results = await searchCrm({ owner_key: turn.owner_key, query: plan.query, filters: plan.filters, execute: false });
  return { ...turn, crm_search: { ...plan, results, execute: false }, commercial_effects_allowed: false };
}

function buildOwnerInstructionRequest({ ownerKey, instruction, eventId, hmacSecret } = {}) {
  const normalized = text(instruction, 1000);
  if (!text(ownerKey, 80) || !normalized) return { outcome: 'instruction_invalid', confirmed: false };
  return {
    outcome: 'instruction_requires_confirmation',
    owner_key: text(ownerKey, 80),
    instruction: normalized,
    event_ref: personalEventKey({ provider: 'owner_instruction', providerEventId: eventId, messageId: ownerKey, hmacSecret }),
    confirmed: false
  };
}

module.exports = { processOwnerPersonalTurn, processOwnerPersonalCrmQuery, buildOwnerInstructionRequest };
