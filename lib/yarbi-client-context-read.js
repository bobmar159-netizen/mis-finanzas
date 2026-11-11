'use strict';

// Deterministic presentation of a client dossier already resolved by the
// application. It deliberately does not search for contacts or infer facts:
// identity resolution remains with the canonical local/owner-scoped adapters.
(function attachClientContextRead(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YarbiClientContextRead = api;
})(typeof globalThis === 'undefined' ? null : globalThis, function createClientContextRead() {
  const SCHEMA = 'yarbi.client-context-read.v1';

  function text(value, limit = 520) {
    return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
  }

  function normalized(value) {
    return text(value, 1200).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-PE');
  }

  function currency(value) {
    const amount = Number(value);
    return Number.isFinite(amount) && amount >= 0 ? `S/ ${amount.toFixed(2)}` : null;
  }

  function requestedReadKind(utterance) {
    const value = normalized(utterance);
    if (!value || /\b(?:agenda|programa|reprogram|cancela|envia|manda|guarda|crea|registra)\b/.test(value)) return null;
    if (/\b(?:cuanto\s+debe|deuda|saldo(?:\s+pendiente)?|debe\s+todavia)\b/.test(value)) return 'balance';
    if (/\b(?:que\s+(?:paso|fue)|historial|ultimo\s+(?:mensaje|movimiento|registro|actividad)|como\s+(?:va|esta))\b/.test(value)) return 'history';
    if (/\b(?:visita|cita|instalacion|seguimiento|pendiente|proxima\s+accion|siguiente\s+paso)\b/.test(value)) return 'activity';
    if (/\b(?:servicio|distrito|ubicacion|direccion|maps)\b/.test(value)) return 'profile';
    return null;
  }

  function clientName(context = {}) {
    return text(context?.dossier?.client_name || context?.contact?.display_name || context?.contact?.full_name || context?.focus?.client_name || 'este cliente', 160);
  }

  function displayDate(value) {
    const date = text(value, 32);
    return /^20\d{2}-\d{2}-\d{2}$/.test(date) ? date.split('-').reverse().join('/') : date;
  }

  function replyForContext({ utterance, context } = {}) {
    const kind = requestedReadKind(utterance);
    if (!kind) return null;
    if (!context || context.requires_disambiguation) {
      return { schema: SCHEMA, outcome: 'needs_clarification', kind, reply: 'Encontré más de un cliente que podría coincidir. Dime distrito, servicio o una referencia reciente para no mezclar sus expedientes.', execute: false };
    }
    const dossier = context.dossier || {};
    const finance = context.finance?.summary || null;
    const name = clientName(context);
    if (kind === 'balance') {
      const pending = currency(finance?.pending_amount);
      if (!pending) return { schema: SCHEMA, outcome: 'no_verified_balance', kind, reply: `No tengo un saldo verificable para ${name} en la copia local. No asumiré una deuda por mensajes o cotizaciones.`, execute: false };
      return { schema: SCHEMA, outcome: 'client_balance_found', kind, reply: `El saldo verificable pendiente de ${name} es ${pending}.`, execute: false, facts: { pending_amount: Number(finance.pending_amount) } };
    }

    const details = [];
    if (dossier.service) details.push(`servicio: ${text(dossier.service, 120)}`);
    if (dossier.commercial_status) details.push(`estado comercial: ${text(dossier.commercial_status, 80).replace(/_/g, ' ')}`);
    if (dossier.operational_status) details.push(`estado operativo: ${text(dossier.operational_status, 100).replace(/_/g, ' ')}`);
    if (dossier.appointment_date) details.push(`${kind === 'activity' ? 'actividad' : 'fecha'}: ${displayDate(dossier.appointment_date)}${dossier.appointment_time ? ` ${text(dossier.appointment_time, 12)}` : ''}`);
    if (kind === 'profile' && dossier.district) details.push(`distrito: ${text(dossier.district, 100)}`);
    if (kind === 'profile' && dossier.location) details.push(`ubicación: ${text(dossier.location, 160)}`);
    if ((kind === 'history' || kind === 'activity') && dossier.conversation_brief) details.push(text(dossier.conversation_brief, 300));

    if (!details.length) {
      return { schema: SCHEMA, outcome: 'client_context_no_information', kind, reply: `Encontré el expediente local de ${name}, pero aún no hay datos verificables suficientes para responder esa consulta.`, execute: false };
    }
    const prefix = kind === 'history' ? `Esto es lo verificable en el expediente local de ${name}:` : `${name}:`;
    return { schema: SCHEMA, outcome: 'client_context_found', kind, reply: `${prefix} ${details.join(' · ')}.`, execute: false, facts: { service: dossier.service || null, appointment_date: dossier.appointment_date || null, commercial_status: dossier.commercial_status || null, operational_status: dossier.operational_status || null } };
  }

  return { SCHEMA, requestedReadKind, replyForContext };
});
