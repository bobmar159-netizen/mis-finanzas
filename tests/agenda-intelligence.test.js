'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { activityState, normalizeAgendaStatus, summarizeAgenda, planAgendaRead, limaParts } = require('../lib/yarbi-agenda-intelligence');

const NOW = Date.parse('2026-11-05T15:00:00.000Z'); // 10:00 America/Lima

test('browser globals coexist with the Financial Coach without redeclaring Lima timezone', () => {
  const context = vm.createContext({});
  const financialCoach = fs.readFileSync(path.join(__dirname, '../lib/yarbi-financial-coach.js'), 'utf8');
  const agenda = fs.readFileSync(path.join(__dirname, '../lib/yarbi-agenda-intelligence.js'), 'utf8');

  vm.runInContext(financialCoach, context, { filename: 'yarbi-financial-coach.js' });
  vm.runInContext(agenda, context, { filename: 'yarbi-agenda-intelligence.js' });

  assert.equal(context.YarbiAgendaIntelligence.LIMA_TIME_ZONE, 'America/Lima');
});

test('F03 normalizes current Agenda states without treating a service as paid or closed', () => {
  assert.equal(normalizeAgendaStatus('agendado'), 'scheduled');
  assert.equal(normalizeAgendaStatus('reprogramado'), 'rescheduled');
  assert.equal(normalizeAgendaStatus('finalizado'), 'completed');
  assert.equal(normalizeAgendaStatus('cancelado'), 'cancelled');
  assert.equal(normalizeAgendaStatus('cobro pendiente'), 'unknown');
});

test('F03 classifies activities in Lima as upcoming, overdue, completed, cancelled or without date', () => {
  assert.deepEqual(limaParts(NOW), { date: '2026-11-05', time: '10:00', at: '2026-11-05T15:00:00.000Z' });
  assert.equal(activityState({ status: 'agendado', starts_at: '2026-11-05T18:00:00.000Z' }, NOW), 'today');
  assert.equal(activityState({ status: 'agendado', starts_at: '2026-11-04T18:00:00.000Z' }, NOW), 'overdue');
  assert.equal(activityState({ status: 'finalizado', starts_at: '2026-11-04T18:00:00.000Z' }, NOW), 'completed');
  assert.equal(activityState({ status: 'cancelado' }, NOW), 'cancelled');
  assert.equal(activityState({ status: 'pendiente' }, NOW), 'without_date');
});

test('F03 deduplicates Agenda records and keeps pending activities visible for the CRM dossier', () => {
  const summary = summarizeAgenda([
    { id: 1, contact_id: 101, event_type: 'visita', service: 'reparacion', status: 'agendado', starts_at: '2026-11-06T15:00:00.000Z' },
    { id: 1, contact_id: 101, event_type: 'visita', service: 'reparacion', status: 'agendado', starts_at: '2026-11-06T15:00:00.000Z' },
    { id: 2, contact_id: 101, event_type: 'seguimiento', service: '', status: 'pendiente' },
    { id: 3, contact_id: 202, event_type: 'visita', status: 'agendado', starts_at: '2026-11-06T15:00:00.000Z' }
  ], { now: NOW, contactId: 101 });
  assert.equal(summary.activities.length, 2);
  assert.equal(summary.upcoming.length, 1);
  assert.equal(summary.pending.length, 1);
  assert.equal(summary.previous.length, 0);
  assert.equal(summary.activities.every(item => item.contact_id === 101), true);
});

test('F03 recognizes common natural Agenda reads without selecting a client or creating an activity', () => {
  const tomorrow = planAgendaRead('¿Qué tengo mañana?', NOW);
  assert.deepEqual(tomorrow, { outcome: 'agenda_read_ready', execute: false, kind: 'day', date: '2026-11-06' });
  assert.equal(planAgendaRead('¿A qué clientes tengo que llamar?', NOW).kind, 'follow_up');
  assert.equal(planAgendaRead('¿Qué visitas siguen pendientes?', NOW).kind, 'pending_visits');
  assert.equal(planAgendaRead('¿Qué pasó con la instalación de Carlos?', NOW).kind, 'contact_history');
  assert.equal(planAgendaRead('Recuérdame hacer seguimiento a ese cliente el lunes', NOW).execute, false);
});
