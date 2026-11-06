const test = require('node:test');
const assert = require('node:assert/strict');
const { buildClientDossier } = require('../lib/yarbi-client-dossier');

test('client dossier consolidates verified chat facts for form prefill', () => {
  const dossier = buildClientDossier({
    phone: '999888777',
    contact: { id: 4, display_name: 'Carlos Ruiz', commercial_status: 'caliente', operational_status: 'visita_por_confirmar' },
    memory: { latest_service: 'Instalación GNV' },
    observations: [
      { id: 1, observation_type: 'fact', category: 'precio_confirmado', value: 'S/ 850', status: 'active', source_message_ids: ['m1'], observed_at: '2026-10-05T15:00:00Z' },
      { id: 2, observation_type: 'fact', category: 'ubicacion', value: 'San Miguel', status: 'active', source_message_ids: ['m2'], observed_at: '2026-10-05T15:01:00Z' }
    ],
    analyses: [{ id: 9, status: 'completed', completed_at: '2026-10-05T15:02:00Z', extracted_data: { service: 'Construcción de punto', appointment: { date: '2026-10-07', time: '16:30', service: 'Construcción de punto' } } }],
    messages: [{ id: 'm2', maps_url: 'https://maps.google.com/?q=-12,-77', timestamp: 2 }]
  });
  assert.equal(dossier.client_name, 'Carlos Ruiz');
  assert.equal(dossier.phone, '999888777');
  assert.equal(dossier.service, 'Construcción de punto');
  assert.equal(dossier.appointment_date, '2026-10-07');
  assert.equal(dossier.appointment_time, '16:30');
  assert.equal(dossier.price, 850);
  assert.equal(dossier.location, 'San Miguel');
  assert.equal(dossier.maps_url, 'https://maps.google.com/?q=-12,-77');
  assert.deepEqual(dossier.evidence.price.source_message_ids, ['m1']);
});

test('client dossier never invents absent price or location', () => {
  const dossier = buildClientDossier({ contact: { display_name: 'Norma' }, phone: '999111222', memory: { latest_service: 'Visita' } });
  assert.equal(dossier.price, 0);
  assert.equal(dossier.location, '');
  assert.ok(dossier.missing.includes('appointment_date'));
});

test('client dossier includes a compact verified CRM brief and district metadata', () => {
  const dossier = buildClientDossier({
    phone: '988777666',
    contact: { display_name: 'Andrea', commercial_status: 'caliente', operational_status: 'visita_por_confirmar' },
    memory: { follow_up_status: 'Esperar confirmación de visita.', summary: 'Pidió modificación y envió ubicación.' },
    messages: [{ id: 'm3', timestamp: 3, maps_url: 'https://maps.google.com/?q=-12,-77', metadata: { location_district: 'Villa El Salvador' } }]
  });
  assert.equal(dossier.district, 'Villa El Salvador');
  assert.match(dossier.conversation_brief, /Interés caliente/);
  assert.match(dossier.conversation_brief, /Esperar confirmación/);
});
