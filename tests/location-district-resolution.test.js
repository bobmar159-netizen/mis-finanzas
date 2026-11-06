const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractLimaDistrict,
  resolveWhatsAppNativeLocation,
  resolveGoogleMapsUrl
} = require('../lib/location-resolver');

test('district resolver uses only district text exposed by the verified location', () => {
  assert.equal(extractLimaDistrict('Av. Los Heroes, San Juan de Miraflores, Lima'), 'San Juan de Miraflores');
  assert.equal(extractLimaDistrict('https://www.google.com/maps/place/Villa+El+Salvador'), 'Villa El Salvador');
  assert.equal(extractLimaDistrict('-12.0500,-77.0300'), '');
});

test('native WhatsApp pin preserves a district from its address without guessing', () => {
  const resolved = resolveWhatsAppNativeLocation({
    latitude: -12.1345,
    longitude: -77.0201,
    name: 'Cliente',
    address: 'Villa El Salvador, Lima'
  });
  assert.equal(resolved.district, 'Villa El Salvador');
  assert.equal(resolved.hasExactCoordinates, true);
});

test('expanded Maps URLs return an optional district and retain exact coordinates', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ url: 'https://www.google.com/maps/place/Comas/@-12.05,-77.03,15z' });
  try {
    const resolved = await resolveGoogleMapsUrl('https://maps.app.goo.gl/example');
    assert.equal(resolved.district, 'Comas');
    assert.equal(resolved.hasExactCoordinates, true);
  } finally {
    global.fetch = originalFetch;
  }
});
