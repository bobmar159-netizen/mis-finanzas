'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBusinessTimeline } = require('../lib/yarbi-business-timeline');

test('business timeline combines only one contact and keeps each source immutable', () => {
  const timeline = buildBusinessTimeline({
    contactId: 7,
    sources: {
      messages: [{ id: 'm-1', contact_id: 7, title: 'Consulta', text: 'Necesito una visita', timestamp: '2026-11-05T14:00:00Z' }, { id: 'other', contact_id: 8, text: 'No debe entrar' }],
      analyses: [{ id: 2, contact_id: 7, intent: 'consulta', service: 'reparacion', completed_at: '2026-11-05T14:01:00Z' }],
      agenda: [{ id: 3, contact_id: 7, service: 'reparacion', status: 'agendado', starts_at: '2026-11-06T15:00:00Z' }],
      receivables: [{ id: 4, contact_id: 7, status: 'partial', next_action: 'Confirmar abono', updated_at: '2026-11-05T16:00:00Z' }],
      observations: [{ id: 5, contact_id: 7, category: 'distrito', value: 'Surco', status: 'active', observed_at: '2026-11-05T16:02:00Z' }]
    }
  });
  assert.equal(timeline.schema, 'yarbi.business-timeline.v1');
  assert.equal(timeline.events.length, 5);
  assert.deepEqual(timeline.events.map(item => item.id), ['agenda:3', 'observation:5', 'receivable:4', 'analysis:2', 'message:m-1']);
  assert.ok(timeline.events.every(item => item.contact_id === 7));
  assert.ok(timeline.events.every(item => !Object.hasOwn(item, 'owner_id')));
});

test('business timeline deduplicates a repeated source ID but never merges unidentified events', () => {
  const timeline = buildBusinessTimeline({
    contactId: 7,
    sources: {
      messages: [
        { id: 'm-1', contact_id: 7, text: 'duplicado', timestamp: '2026-11-05T14:00:00Z' },
        { id: 'm-1', contact_id: 7, text: 'duplicado', timestamp: '2026-11-05T14:00:00Z' },
        { contact_id: 7, text: 'sin id A', timestamp: '2026-11-05T14:00:00Z' },
        { contact_id: 7, text: 'sin id B', timestamp: '2026-11-05T14:00:00Z' }
      ]
    }
  });
  assert.equal(timeline.events.length, 3);
  assert.deepEqual(timeline.events.map(item => item.id).sort(), ['message:m-1', 'message:unidentified:2', 'message:unidentified:3']);
});

test('business timeline reports invalid contact IDs without reading source rows', () => {
  const timeline = buildBusinessTimeline({ contactId: 'not-a-contact', sources: { messages: [{ contact_id: 7 }] } });
  assert.equal(timeline.outcome, 'contact_id_invalid');
  assert.deepEqual(timeline.events, []);
});
