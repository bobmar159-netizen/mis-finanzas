(function attachYarbiBusinessTimeline(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YarbiBusinessTimeline = api;
})(typeof globalThis === 'undefined' ? null : globalThis, function createYarbiBusinessTimeline() {
  'use strict';

  // Proyección local, determinista y de solo lectura de la historia comercial.
  // Reúne las fuentes ya existentes para que el expediente y el cerebro lean el
  // mismo registro; no crea contactos, tareas, mensajes ni movimientos.
  const BUSINESS_TIMELINE_SCHEMA = 'yarbi.business-timeline.v1';

function text(value, limit = 600) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function array(value) { return Array.isArray(value) ? value : []; }
function integer(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function dateValue(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : null;
}

function eventAt(value) {
  const parsed = dateValue(value);
  return parsed == null ? null : new Date(parsed).toISOString();
}

function sourceKey(kind, row, ordinal) {
  const id = text(row?.id, 160);
  if (id) return `${kind}:${id}`;
  // Las fuentes sin identificador no se fusionan por texto: dos eventos con
  // igual contenido podrían ser legítimamente distintos.
  return `${kind}:unidentified:${ordinal}`;
}

function event(kind, row, ordinal, fields) {
  const sourceId = row?.id == null ? null : text(row.id, 160) || null;
  const title = text(fields.title, 160) || null;
  return {
    id: sourceKey(kind, row, ordinal),
    kind,
    contact_id: integer(row?.contact_id),
    at: eventAt(fields.at),
    // `label` y `source_id` permanecen mientras las pantallas históricas
    // consumen el contrato del expediente anterior. `title`/`source` son el
    // contrato canónico nuevo para el cerebro y los próximos renderers.
    title,
    label: title,
    detail: text(fields.detail, 600) || null,
    status: text(fields.status, 80) || null,
    source_id: sourceId,
    source: { name: fields.source || kind, id: sourceId }
  };
}

function eventsFrom(sources, contactId) {
  const id = integer(contactId);
  if (!id) return [];
  const events = [];
  for (const [ordinal, row] of array(sources?.messages).entries()) {
    if (integer(row?.contact_id) !== id) continue;
    events.push(event('message', row, ordinal, {
      at: row.timestamp || row.created_at,
      title: text(row.title, 120) || 'Mensaje',
      detail: row.text,
      status: row.status,
      source: 'whatsapp_messages'
    }));
  }
  for (const [ordinal, row] of array(sources?.analyses).entries()) {
    if (integer(row?.contact_id) !== id) continue;
    events.push(event('analysis', row, ordinal, {
      at: row.completed_at || row.updated_at || row.created_at,
      title: text(row.service, 120) || text(row.intent, 120) || 'Análisis',
      detail: row.intent,
      status: row.status,
      source: 'ai_message_analysis'
    }));
  }
  for (const [ordinal, row] of array(sources?.agenda).entries()) {
    if (integer(row?.contact_id) !== id) continue;
    events.push(event('agenda', row, ordinal, {
      at: row.starts_at || row.updated_at || row.created_at,
      title: text(row.service, 120) || text(row.event_type, 120) || 'Actividad',
      detail: row.description || row.location,
      status: row.status,
      source: 'agenda_events'
    }));
  }
  for (const [ordinal, row] of array(sources?.receivables).entries()) {
    if (integer(row?.contact_id) !== id) continue;
    events.push(event('receivable', row, ordinal, {
      at: row.updated_at || row.next_action_due || row.created_at,
      title: 'Cobranza',
      detail: [text(row.status, 80), text(row.next_action, 240)].filter(Boolean).join(' · '),
      status: row.status,
      source: 'yarbi_receivables'
    }));
  }
  for (const [ordinal, row] of array(sources?.observations).entries()) {
    if (integer(row?.contact_id) !== id) continue;
    events.push(event('observation', row, ordinal, {
      at: row.observed_at || row.updated_at || row.created_at,
      title: text(row.category, 120) || 'Dato verificado',
      detail: row.value,
      status: row.status,
      source: 'yarbi_contact_observations'
    }));
  }
  return events;
}

function buildBusinessTimeline({ sources = {}, contactId, limit = 24 } = {}) {
  const normalizedContactId = integer(contactId);
  if (!normalizedContactId) {
    return { schema: BUSINESS_TIMELINE_SCHEMA, outcome: 'contact_id_invalid', contact_id: null, events: [] };
  }
  const unique = new Map();
  for (const item of eventsFrom(sources, normalizedContactId)) {
    if (!unique.has(item.id)) unique.set(item.id, item);
  }
  const safeLimit = Math.max(1, Math.min(Number(limit) || 24, 100));
  const events = [...unique.values()]
    .sort((left, right) => (dateValue(right.at) || -Infinity) - (dateValue(left.at) || -Infinity) || left.id.localeCompare(right.id))
    .slice(0, safeLimit);
  return {
    schema: BUSINESS_TIMELINE_SCHEMA,
    outcome: 'timeline_found',
    contact_id: normalizedContactId,
    events,
    source_status: Object.fromEntries(['messages', 'analyses', 'agenda', 'receivables', 'observations']
      .map(name => [name, Array.isArray(sources?.[name]) ? 'available' : 'unavailable']))
  };
}

  return { BUSINESS_TIMELINE_SCHEMA, buildBusinessTimeline, eventsFrom };
});
