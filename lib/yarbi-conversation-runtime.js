'use strict';

const { processOwnerTurn, createOwnerConversationState } = require('./yarbi-owner-conversation');
const { planAgendaRead, summarizeAgenda, LIMA_TIME_ZONE } = require('./yarbi-agenda-intelligence');
const { classifyIntelligenceRoute, transitionFor } = require('./yarbi-intelligence-router');
const { requestDeepAnalysis } = require('./yarbi-deep-analysis');

function text(value, limit = 800) { return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, limit); }
function rows(value) { return Array.isArray(value) ? value : []; }
function elapsed(started) { return Math.max(0, Math.round((performance.now() - started) * 100) / 100); }
function percentile(values, fraction) { const sorted = rows(values).filter(Number.isFinite).sort((a, b) => a - b); return sorted.length ? Number(sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))].toFixed(2)) : null; }
function replyAgenda(plan, activities) {
  const summary = summarizeAgenda(activities, { now: plan.now });
  const selected = plan.kind === 'pending_visits' ? summary.pending : plan.kind === 'follow_up' ? [...summary.pending, ...summary.upcoming].filter(item => /seguimiento|llamar|pending/i.test(`${item.status} ${item.type} ${item.service}`)) : summary.upcoming.filter(item => item.date === plan.date);
  if (!selected.length) return { reply: plan.kind === 'day' ? 'No tengo actividades verificables para mañana en la Agenda.' : 'No encuentro seguimientos verificables pendientes en la Agenda.', facts: { agenda_state: 'no_information', count: 0 } };
  const labels = selected.slice(0, 4).map(item => [item.service || item.type, item.date, item.time].filter(Boolean).join(' · '));
  return { reply: `Encontré ${selected.length} actividad(es) verificable(s): ${labels.join('; ')}.`, facts: { agenda_state: 'available', count: selected.length } };
}
function financeIntent(utterance) { return /cu[aá]nto\s+(?:hemos\s+)?cobrado|cobros?\s+por/i.test(String(utterance || '')); }
function replyFinance(rowsValue, utterance) {
  const service = /instalaci[oó]n/i.test(utterance) ? 'instalacion_nueva' : null;
  const accepted = rows(rowsValue).filter(item => (!service || item.service === service) && Number.isFinite(Number(item.collected_amount)) && item.verified === true);
  if (!accepted.length) return { reply: 'No tengo cobros verificables suficientes para responder esa consulta.', facts: { finance_state: 'no_information', count: 0 } };
  const total = accepted.reduce((sum, item) => sum + Number(item.collected_amount), 0);
  return { reply: `El total verificable cobrado${service ? ' por instalaciones' : ''} es S/ ${total.toFixed(2)}.`, facts: { finance_state: 'available', count: accepted.length, total } };
}
function localContinuation(utterance, candidateIds) {
  const match = /^\s*(?:el|la)\s+(primer|primero|segundo|segunda|tercer|tercero|tercera)\s+(?:cliente|contacto)\b/i.exec(String(utterance || ''));
  if (!match) return null;
  const index = /segund/i.test(match[1]) ? 1 : /tercer/i.test(match[1]) ? 2 : 0;
  const id = rows(candidateIds)[index];
  return Number.isSafeInteger(Number(id)) && Number(id) > 0 ? { contact_id: Number(id), index } : { contact_id: null, index };
}
function providerUnavailableReply() { return 'Conservo el contexto, pero no puedo interpretar esa consulta ahora. Puedo mostrarte información verificable de Agenda, CRM o Finanzas sin ejecutar ninguna acción.'; }
function deepKind(utterance) {
  const value = String(utterance || '').toLowerCase();
  if (/meta ads|campañ|roas|roi|publicidad/.test(value)) return /presupuesto/.test(value) ? 'budget_recommendation' : 'campaign_analysis';
  if (/rentabilidad|margen/.test(value)) return 'profitability';
  if (/whatsapp|conversaciones?/.test(value)) return 'conversation_analysis';
  if (/compar/.test(value)) return 'client_comparison';
  return 'sales_analysis';
}

async function runOwnerConversation({ utterance, state, provider, candidates = [], agendaEvents = [], financeRows = [], now = Date.now(), ownerId = null, deepStore = null, deepIdempotencyKey = null } = {}) {
  const started = performance.now();
  const current = state || createOwnerConversationState();
  const metrics = { interface_ms: 0, cache_ms: 0, auth_ms: 0, owner_scope_ms: 0, supabase_ms: 0, gemini_ms: 0, response_ms: 0, presentation_ms: 0 };
  const route = classifyIntelligenceRoute({ utterance, now });
  metrics.intelligence_tier = route.tier;
  if (route.tier === 'DEEP') {
    const deep = await requestDeepAnalysis({ ownerId, kind: deepKind(utterance), idempotencyKey: deepIdempotencyKey || 'conversation', durableStore: deepStore });
    return {
      schema: 'yarbi.conversation-response.v1', outcome: deep.outcome,
      reply: deep.accepted ? 'Preparé el análisis profundo. Te avisaré cuando exista un resultado verificable.' : 'El análisis profundo aún no está disponible porque no existe una cola durable verificada. No iniciaré trabajo en memoria ni ejecutaré una acción comercial.',
      state: current, proposal: { kind: 'none', execute: false }, commercial_effects_allowed: false,
      intelligence: { route, transfer: null, deep }, metrics: { ...metrics, total_ms: elapsed(started) }
    };
  }
  const continuation = localContinuation(utterance, candidates);
  if (continuation) {
    const reply = continuation.contact_id ? 'Mantengo el segundo resultado como referencia. Abriré su expediente solo cuando lo confirmes.' : 'No tengo suficientes resultados previos para saber a qué cliente te refieres.';
    return { schema: 'yarbi.conversation-response.v1', outcome: continuation.contact_id ? 'continuation_selected' : 'needs_clarification', reply, state: current, selected_contact_id: continuation.contact_id, proposal: { kind: 'open_contact_card', contact_id: continuation.contact_id, execute: false }, commercial_effects_allowed: false, intelligence: { route: { ...route, tier: 'FAST', reason: 'signed_continuation' }, transfer: null }, metrics: { ...metrics, intelligence_tier: 'FAST', total_ms: elapsed(started) } };
  }
  const agendaPlan = planAgendaRead(utterance, now);
  if (agendaPlan.outcome === 'agenda_read_ready') {
    const response = replyAgenda({ ...agendaPlan, now }, agendaEvents);
    return { schema: 'yarbi.conversation-response.v1', outcome: 'fast_local_agenda', reply: response.reply, state: current, facts: response.facts, proposal: { kind: 'none', execute: false }, commercial_effects_allowed: false, intelligence: { route: { ...route, tier: 'FAST' }, transfer: null }, metrics: { ...metrics, intelligence_tier: 'FAST', total_ms: elapsed(started) } };
  }
  if (financeIntent(utterance)) {
    const response = replyFinance(financeRows, utterance);
    return { schema: 'yarbi.conversation-response.v1', outcome: 'fast_local_finance', reply: response.reply, state: current, facts: response.facts, proposal: { kind: 'none', execute: false }, commercial_effects_allowed: false, intelligence: { route: { ...route, tier: 'FAST' }, transfer: null }, metrics: { ...metrics, intelligence_tier: 'FAST', total_ms: elapsed(started) } };
  }
  const providerStarted = performance.now();
  try {
    const turn = await processOwnerTurn({ state: current, utterance, provider, candidates: [], now: new Date(now) });
    metrics.gemini_ms = elapsed(providerStarted);
    if (turn.outcome === 'fast_local') return { ...turn, reply: turn.reply, intelligence: { route: { ...route, tier: 'FAST', reason: 'deterministic_faq' }, transfer: transitionFor({ from: 'STANDARD', to: 'FAST', reason: 'faq_recognized' }) }, metrics: { ...metrics, intelligence_tier: 'FAST', total_ms: elapsed(started) }, commercial_effects_allowed: false };
    if (turn.outcome === 'cancelled' || turn.outcome === 'requires_confirmation') return { ...turn, reply: turn.question || 'Entendido. No enviaré ni modificaré nada sin tu confirmación.', intelligence: { route, transfer: null }, metrics: { ...metrics, total_ms: elapsed(started) }, commercial_effects_allowed: false };
    if (turn.outcome === 'understanding_invalid') return { ...turn, outcome: 'needs_clarification', reply: providerUnavailableReply(), intelligence: { route, transfer: null }, metrics: { ...metrics, total_ms: elapsed(started) }, commercial_effects_allowed: false };
    const query = turn.crm_search?.query;
    const reply = turn.outcome === 'resolved' ? 'Encontré una referencia verificable. Puedes abrir el expediente para revisar su contexto.' : query ? `Entendí una búsqueda de CRM para “${query}”. Buscaré solo dentro de tu alcance autorizado.` : (turn.question || 'Necesito una pista verificable para continuar sin confundir clientes.');
    return { ...turn, reply, intelligence: { route, transfer: null }, metrics: { ...metrics, total_ms: elapsed(started) }, commercial_effects_allowed: false };
  } catch (error) {
    metrics.gemini_ms = elapsed(providerStarted);
    return { schema: 'yarbi.conversation-response.v1', outcome: 'provider_unavailable', code: String(error?.code || 'owner_understanding_unavailable').slice(0, 96), reply: providerUnavailableReply(), state: current, proposal: { kind: 'none', execute: false }, commercial_effects_allowed: false, intelligence: { route, transfer: null }, metrics: { ...metrics, total_ms: elapsed(started) } };
  }
}

function summarizePerformance(samples = []) {
  const rowsValue = rows(samples);
  const total = rowsValue.map(row => Number(row?.metrics?.total_ms)).filter(Number.isFinite);
  const gemini = rowsValue.map(row => Number(row?.metrics?.gemini_ms)).filter(Number.isFinite);
  const byTier = tier => rowsValue.filter(row => row?.metrics?.intelligence_tier === tier);
  const summary = tier => { const selected = byTier(tier); const values = selected.map(row => Number(row?.metrics?.total_ms)).filter(Number.isFinite); return { samples: selected.length, p50_ms: percentile(values, 0.5), p95_ms: percentile(values, 0.95) }; };
  return { sample_count: rowsValue.length, local_cpu: { p50_ms: percentile(total, 0.5), p95_ms: percentile(total, 0.95) }, gemini: { calls: gemini.filter(value => value > 0).length, p50_ms: percentile(gemini, 0.5), p95_ms: percentile(gemini, 0.95), ttft_ms: 'not_measured', ttfa_ms: 'not_measured' }, tiers: { fast: summary('FAST'), standard: summary('STANDARD'), deep: summary('DEEP') }, cache_hit_rate: 'measured_by_crm_search_only', preview_http: 'not_measured', android_device: 'not_measured' };
}

module.exports = { runOwnerConversation, summarizePerformance, providerUnavailableReply };
