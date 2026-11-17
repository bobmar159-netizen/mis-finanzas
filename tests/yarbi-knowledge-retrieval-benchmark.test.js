const assert = require('node:assert/strict');
const test = require('node:test');
const api = require('../frontend/yarbi-multimodal-tutor.js');

function percentile(samples, fraction) {
  const sorted = [...samples].sort((a,b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] || 0;
}

test('BKE synthetic retrieval benchmark: CPU-only local corpus', () => {
  const assets = Array.from({ length:5 }, (_, assetIndex) => ({
    id:'synthetic-' + assetIndex,
    title:'Manual sintético ' + assetIndex,
    kind:'pdf',
    status:'approved',
    learningEnabled:true,
    sections:Array.from({ length:100 }, (_, sectionIndex) => ({
      id:'p' + (sectionIndex + 1),
      label:'Numeral ' + (sectionIndex + 1) + ' · Página ' + (sectionIndex + 1),
      text:sectionIndex % 17 === 0
        ? 'La prueba de hermeticidad verifica que no existan fugas antes de habilitar el sistema de gas.'
        : 'Texto técnico sintético de instalación, inspección y mantenimiento del sistema.'
    }))
  }));
  const samples = [];
  for (let index = 0; index < 32; index += 1) {
    const start = performance.now();
    const rows = api.searchApprovedQueries(assets, [
      '¿cómo compruebo que la tubería no pierda gas antes de usarla?',
      'prueba hermeticidad fugas sistema de gas'
    ], { limit:12 });
    samples.push(performance.now() - start);
    assert.ok(rows.some(row => /hermeticidad/i.test(row.excerpt)));
  }
  const p50 = percentile(samples, 0.50);
  const p95 = percentile(samples, 0.95);
  assert.ok(Number.isFinite(p50) && Number.isFinite(p95));
  console.log('[BKE SYNTHETIC CPU] 500 secciones; 32 consultas; p50=' + p50.toFixed(2) + 'ms; p95=' + p95.toFixed(2) + 'ms');
});
