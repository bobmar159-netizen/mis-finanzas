const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyCommercialStatus } = require('../lib/yarbi-commercial-status-policy');

function inbound(id, text, extra = {}) {
  return { id, text, metadata:{ direction:'incoming' }, ...extra };
}

test('commercial policy: only direct customer signals can classify a lead', () => {
  const result = classifyCommercialStatus([
    { id:'business-1', text:'Tenemos cupo mañana', metadata:{ direction:'outgoing' } },
    inbound('client-1', '¿Cuánto cuesta la instalación?')
  ]);
  assert.equal(result.commercial_status, 'tibio');
  assert.deepEqual(result.commercial_status_source_message_ids, ['client-1']);
  assert.match(result.status_reason, /servicio, precio o disponibilidad/i);
});

test('commercial policy: location or concrete coordination is hot but not a completed service', () => {
  const result = classifyCommercialStatus([inbound('client-map', 'Te comparto la ubicación', { maps_url:'https://maps.app.goo.gl/example' })]);
  assert.equal(result.commercial_status, 'caliente');
  assert.match(result.status_reason, /ubicación/i);
});

test('commercial policy: explicit decline is cold and silence does not reclassify a contact', () => {
  const declined = classifyCommercialStatus([inbound('client-no', 'No gracias, ya lo resolví.')]);
  assert.equal(declined.commercial_status, 'frio');
  assert.equal(classifyCommercialStatus([inbound('client-hi', 'Hola')]), null);
});
