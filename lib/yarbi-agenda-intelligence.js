'use strict';

// Proyección de solo lectura de Agenda. No crea ni cambia eventos: ofrece una
// clasificación común para CRM, expediente, chat y avisos futuros usando la
// hora real de Lima y los estados ya existentes.
const LIMA_TIME_ZONE = 'America/Lima';
const CLOSED = new Set(['completed', 'completado', 'finalizado', 'visitado', 'cancelled', 'cancelado', 'desistio', 'desistió', 'no_show']);
const CANCELLED = new Set(['cancelled', 'cancelado', 'desistio', 'desistió', 'no_show']);
const RESCHEDULED = new Set(['rescheduled', 'reprogramado']);
const PENDING_DETAILS = new Set(['pending', 'pendiente', 'esperando_detalles', 'esperando_cliente', 'seguimiento']);

function text(value, limit = 320) { return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit); }
function normalized(value) { return text(value, 100).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }
function array(value) { return Array.isArray(value) ? value : []; }
function integer(value) { const id = Number(value); return Number.isSafeInteger(id) && id > 0 ? id : null; }
function instant(value) { const parsed = Date.parse(value || ''); return Number.isFinite(parsed) ? parsed : null; }

function limaParts(value) {
  const millis = typeof value === 'number' ? value : instant(value);
  if (millis == null) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: LIMA_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(millis));
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { date: `${map.year}-${map.month}-${map.day}`, time: `${map.hour}:${map.minute}`, at: new Date(millis).toISOString() };
}

function normalizeAgendaStatus(value) {
  const status = normalized(value);
  if (CANCELLED.has(status)) return 'cancelled';
  if (['completed', 'completado', 'finalizado', 'visitado'].includes(status)) return 'completed';
  if (RESCHEDULED.has(status)) return 'rescheduled';
  if (PENDING_DETAILS.has(status)) return 'pending_details';
  if (['agendado', 'scheduled', 'confirmed', 'confirmado', 'visita_por_confirmar', 'trabajo_agendado'].includes(status)) return 'scheduled';
  return status ? 'unknown' : 'pending_details';
}

function activityState(event, now = Date.now()) {
  const status = normalizeAgendaStatus(event?.status);
  const at = instant(event?.starts_at || event?.start_at || event?.scheduled_at);
  if (status === 'cancelled') return 'cancelled';
  if (status === 'completed') return 'completed';
  if (at == null) return 'without_date';
  if (at < now) return 'overdue';
  const today = limaParts(now)?.date;
  if (limaParts(at)?.date === today) return 'today';
  return status === 'rescheduled' ? 'rescheduled' : 'upcoming';
}

function activityFrom(event, now) {
  const state = activityState(event, now);
  const contactId = integer(event?.contact_id);
  const date = limaParts(event?.starts_at || event?.start_at || event?.scheduled_at);
  return {
    id: event?.id == null ? null : String(event.id), contact_id: contactId, state,
    status: normalizeAgendaStatus(event?.status), type: text(event?.event_type || event?.type || 'visita', 80) || 'visita',
    service: text(event?.service, 160) || null, date: date?.date || null, time: date?.time || null, at: date?.at || null,
    location: text(event?.location, 240) || null, source: text(event?.source, 80) || 'agenda_events',
    dedupe_key: text(event?.dedupe_key, 160) || null, action_required: ['overdue', 'without_date', 'pending_details'].includes(state)
  };
}

function activityKey(activity) { return activity.id ? `id:${activity.id}` : activity.dedupe_key ? `dedupe:${activity.dedupe_key}` : [activity.contact_id || '', activity.type, activity.service || '', activity.at || '', activity.status].join('|'); }

function summarizeAgenda(events, { now = Date.now(), contactId = null, limit = 24 } = {}) {
  const requiredContact = integer(contactId);
  const unique = new Map();
  for (const event of array(events)) {
    const activity = activityFrom(event, now);
    if (requiredContact && activity.contact_id !== requiredContact) continue;
    const key = activityKey(activity);
    if (!unique.has(key)) unique.set(key, activity);
  }
  const rows = [...unique.values()].sort((left, right) => (instant(right.at) || 0) - (instant(left.at) || 0)).slice(0, Math.max(1, Math.min(Number(limit) || 24, 100)));
  const grouped = { previous: [], upcoming: [], pending: [] };
  for (const row of rows) {
    if (['completed', 'cancelled'].includes(row.state)) grouped.previous.push(row);
    else if (['overdue', 'without_date', 'pending_details'].includes(row.state)) grouped.pending.push(row);
    else grouped.upcoming.push(row);
  }
  return { schema: 'yarbi.agenda-summary.v1', time_zone: LIMA_TIME_ZONE, generated_at: new Date(now).toISOString(), activities: rows, previous: grouped.previous, upcoming: grouped.upcoming, pending: grouped.pending };
}

// Clasifica consultas comunes sin ejecutar una acción; el cerebro existente
// conserva la interpretación abierta para lenguaje que no encaje aquí.
function planAgendaRead(textValue, now = Date.now()) {
  const value = normalized(textValue);
  if (!value) return { outcome: 'not_agenda_query', execute: false };
  const target = /manana|mañana/.test(String(textValue).toLowerCase()) ? (limaParts(now + 86400000)?.date || null) : null;
  if (/que_tengo|que_hay|agenda/.test(value) && target) return { outcome: 'agenda_read_ready', execute: false, kind: 'day', date: target };
  if (/a_que_clientes.*llamar|clientes.*llamar|seguimiento/.test(value)) return { outcome: 'agenda_read_ready', execute: false, kind: 'follow_up' };
  if (/visitas.*pendientes|pendientes.*visitas/.test(value)) return { outcome: 'agenda_read_ready', execute: false, kind: 'pending_visits' };
  if (/que_paso.*instalacion/.test(value)) return { outcome: 'agenda_read_ready', execute: false, kind: 'contact_history' };
  return { outcome: 'not_agenda_query', execute: false };
}

module.exports = { LIMA_TIME_ZONE, normalizeAgendaStatus, activityState, activityFrom, summarizeAgenda, planAgendaRead, limaParts };
