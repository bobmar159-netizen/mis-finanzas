const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const library = require(path.join(__dirname, '..', 'frontend', 'yarbi-knowledge-library.js'));
const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'yarbi-knowledge-library.js'), 'utf8');
const center = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'yarbi-memory-center.js'), 'utf8');

test('BKE local: fragmenta texto de manera determinista y conserva el texto literal', () => {
  const sections = library.extractSections('Primera regla del negocio.\n\nSegunda regla para una visita segura.');
  assert.deepEqual(sections.map(section => section.label), ['Fragmento 1', 'Fragmento 2']);
  assert.equal(sections[0].text, 'Primera regla del negocio.');
  assert.equal(sections[1].text, 'Segunda regla para una visita segura.');
});

test('BKE local: devuelve solo citas de fuentes aprobadas y no inventa coincidencias', () => {
  const sources = [
    { id:'approved', title:'Procedimiento de visitas', status:'approved', sha256:'a'.repeat(64), sections:[{ id:'s1', label:'Fragmento 1', text:'Confirmar la visita antes de salir.' }] },
    { id:'draft', title:'Borrador privado', status:'draft', sha256:'b'.repeat(64), sections:[{ id:'s1', label:'Fragmento 1', text:'Confirmar la visita secreta.' }] }
  ];
  const found = library.searchSources(sources, 'confirmar visita');
  assert.equal(found.length, 1);
  assert.equal(found[0].sourceId, 'approved');
  assert.equal(found[0].sectionLabel, 'Fragmento 1');
  assert.deepEqual(library.searchSources(sources, 'norma inexistente'), []);
});

test('BKE local: la interfaz exige revisión y no anuncia procesamiento de formatos no soportados', () => {
  assert.match(library.html(), /Revisa el contenido antes de aprobarlo/i);
  assert.match(source, /Borrador: requiere aprobación explícita/);
  assert.match(library.html(), /PDF, imagen, audio y video requieren un extractor autorizado/i);
  assert.match(source, /MAX_SOURCE_CHARS = 200000/);
  assert.match(source, /crypto\.subtle\.digest\('SHA-256'/);
  assert.doesNotMatch(source, /https?:\/\//);
  assert.doesNotMatch(source, /fetch\(/);
});

test('BKE local: el centro de Yarbi abre la biblioteca sin convertirla en una ruta comercial', () => {
  assert.match(center, /gfcOpenCopilotModal\([^\n]{0,12}knowledge/);
  assert.match(center, /gfcYarbiKnowledgeHtml/);
  assert.match(center, /gfcYarbiKnowledgeAttach/);
});
