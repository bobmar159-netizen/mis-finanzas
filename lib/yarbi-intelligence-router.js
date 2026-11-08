'use strict';

// Único selector de estrategia del cerebro. Es deliberadamente conservador:
// FAST sólo acepta lecturas deterministas; lenguaje abierto pasa a STANDARD;
// análisis costoso se deriva a DEEP sin bloquear la conversación.
const { planAgendaRead } = require('./yarbi-agenda-intelligence');
const { tryFastLocalOwnerTurn, normalize } = require('./yarbi-fast-local');

const DEEP_TERMS = /\b(?:analiza|analisis|analizar|compar[ae]|rentabilidad|margen|roi|roas|campañ(?:a|as)|meta ads|publicidad|presupuesto|distribuci[oó]n de presupuesto|conversaciones completas|whatsapp completo)\b/i;
const FINANCE_TERMS = /\b(?:cu[aá]nto\s+(?:hemos\s+)?cobrado|cobros?\s+por|saldos?|debe|deuda|cotizaci[oó]n|cotizaciones)\b/i;
const CRM_TERMS = /\b(?:busca|buscar|encuentra|telefono|tel[eé]fono|distrito|servicio|estado comercial|cliente)\b/i;

function text(value, limit = 1200) { return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, limit); }

function classifyIntelligenceRoute({ utterance, now = Date.now() } = {}) {
  const value = text(utterance);
  if (!value) return { tier: 'STANDARD', reason: 'empty_or_ambiguous', expected_cost: 'normal', requires_provider: true };
  if (DEEP_TERMS.test(value)) return { tier: 'DEEP', reason: 'analytical_request', expected_cost: 'asynchronous', requires_provider: false };
  if (planAgendaRead(value, now).outcome === 'agenda_read_ready') return { tier: 'FAST', reason: 'deterministic_agenda_read', expected_cost: 'low', requires_provider: false };
  if (FINANCE_TERMS.test(value)) return { tier: 'FAST', reason: 'deterministic_finance_read', expected_cost: 'low', requires_provider: false };
  if (tryFastLocalOwnerTurn({ utterance: value }).handled) return { tier: 'FAST', reason: 'deterministic_faq', expected_cost: 'low', requires_provider: false };
  // CRM por texto libre puede necesitar desambiguación semántica. Sólo se
  // mantiene FAST cuando un caller entrega una consulta estructurada.
  if (CRM_TERMS.test(value) && normalize(value).split(' ').length <= 2) return { tier: 'STANDARD', reason: 'crm_needs_disambiguation', expected_cost: 'normal', requires_provider: true };
  return { tier: 'STANDARD', reason: 'natural_language_or_contextual', expected_cost: 'normal', requires_provider: true };
}

function transitionFor({ from, to, reason } = {}) {
  const source = ['FAST', 'STANDARD', 'DEEP'].includes(from) ? from : null;
  const target = ['FAST', 'STANDARD', 'DEEP'].includes(to) ? to : null;
  if (!source || !target || source === target) return null;
  return { from: source, to: target, reason: text(reason, 96) || 'route_transfer', execute: false };
}

module.exports = { classifyIntelligenceRoute, transitionFor };
