'use strict';

function text(value, limit = 240) { return String(value ?? '').trim().replace(/[\u0000-\u001f]/g, ' ').slice(0, limit); }
function numberOrNull(value) { if (value === null || value === undefined || value === '') return null; const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : null; }
function dateOrNull(value) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString() : null; }
function allowed(value, values, fallback = null) { const result = text(value, 64).toLowerCase(); return values.includes(result) ? result : fallback; }
const ACTION_LABEL = Object.freeze({ ask_for_location: 'Pedir ubicación', ask_for_service: 'Pedir detalle del servicio', ask_for_district: 'Pedir distrito', ask_for_schedule: 'Coordinar horario', follow_up_customer: 'Hacer seguimiento', confirm_visit: 'Confirmar visita', prepare_quote: 'Preparar cotización' });
const TYPE_LABEL = Object.freeze({ customer_action: 'Acción con cliente', internal_action: 'Acción interna', owner_review: 'Necesita revisión', business_goal: 'Meta del negocio' });

function itemFrom(raw, inbox) {
  const type = allowed(raw?.type, Object.keys(TYPE_LABEL), 'owner_review');
  const action = text(raw?.action, 80);
  const contact = raw?.contact && typeof raw.contact === 'object' ? raw.contact : {};
  const status = allowed(inbox.owner_decision_status, ['pending','authorized','postponed','dismissed'], 'pending');
  return {
    inbox_id: Number.isSafeInteger(Number(inbox.id)) ? Number(inbox.id) : null,
    item_index: Number.isInteger(Number(raw?.item_index)) ? Number(raw.item_index) : 0,
    type, type_label: TYPE_LABEL[type], action, action_label: ACTION_LABEL[action] || (type === 'business_goal' ? 'Revisar meta diaria' : 'Revisar con Yarbi'),
    priority: allowed(raw?.priority || inbox.urgency, ['low','medium','high','urgent'], 'medium'),
    reason: text(raw?.reason, 280) || 'Yarbi preparó esta recomendación para tu revisión.',
    requires_authorization: raw?.requires_authorization === true,
    status, postpone_until: dateOrNull(inbox.postpone_until), created_at: dateOrNull(inbox.created_at),
    contact: { name: text(contact.name || raw?.contact_name, 160) || null, service: text(contact.service || raw?.service, 100) || null, commercial_status: allowed(contact.commercial_status || raw?.commercial_status, ['frio','tibio','caliente']) },
    actionable: (type === 'customer_action' || type === 'internal_action') && Boolean(action)
  };
}

function sanitizeInboxRows(rows) {
  const source = Array.isArray(rows) ? rows : [];
  const entries = []; let snapshot = null;
  for (const inbox of source) {
    if (!inbox || inbox.status === 'failed' || !inbox.payload || typeof inbox.payload !== 'object') continue;
    if (!snapshot && inbox.payload.business_snapshot && typeof inbox.payload.business_snapshot === 'object') snapshot = inbox.payload.business_snapshot;
    const items = Array.isArray(inbox.payload.items) ? inbox.payload.items : [];
    items.forEach((item, item_index) => entries.push(itemFrom({ ...item, item_index }, inbox)));
  }
  entries.sort((left, right) => ({ urgent: 4, high: 3, medium: 2, low: 1 }[right.priority] - { urgent: 4, high: 3, medium: 2, low: 1 }[left.priority]) || String(right.created_at || '').localeCompare(String(left.created_at || '')));
  const summary = {
    daily_goal: numberOrNull(snapshot?.daily_goal), confirmed_today: numberOrNull(snapshot?.confirmed_today), remaining_to_goal: numberOrNull(snapshot?.remaining_to_goal),
    currency: text(snapshot?.currency, 12) || 'PEN',
    opportunities: { hot: null, warm: null, cold: null }
  };
  return { items: entries, summary };
}

module.exports = { ACTION_LABEL, TYPE_LABEL, sanitizeInboxRows };
