const test = require('node:test');
const assert = require('node:assert/strict');

// Fixture explícitamente sintético: representa el efecto del upsert por `id`
// si la tabla legacy posee una restricción única utilizable por PostgREST.
function withUniqueId(rows, payload) {
  const found = rows.find(row => row.id === payload.id);
  if (found) Object.assign(found, payload);
  else rows.push({ ...payload });
  return { rows, action: found ? 'updated' : 'inserted' };
}

// Fixture explícitamente sintético: sin índice único, el header Prefer no
// tiene conflicto que resolver y cada POST puede producir otra fila.
function withoutUniqueId(rows, payload) {
  rows.push({ ...payload, surrogate_id: rows.length + 1 });
  return { rows, action: 'inserted' };
}

test('Fase 2D.1: fixture legacy con unicidad conserva una sola fila por reentrega', () => {
  const rows = [];
  const first = withUniqueId(rows, { id: 'F2D1-LEGACY-1', content: 'primero' });
  const retry = withUniqueId(rows, { id: 'F2D1-LEGACY-1', content: 'reentrega' });
  assert.equal(first.action, 'inserted');
  assert.equal(retry.action, 'updated');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].content, 'reentrega');
});

test('Fase 2D.1: fixture legacy sin unicidad permite dos filas y no prueba idempotencia', () => {
  const rows = [];
  withoutUniqueId(rows, { id: 'F2D1-LEGACY-2', content: 'primero' });
  withoutUniqueId(rows, { id: 'F2D1-LEGACY-2', content: 'reentrega' });
  assert.equal(rows.length, 2);
  assert.equal(new Set(rows.map(row => row.id)).size, 1);
});
