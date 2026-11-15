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

test('BKE local: solo intercepta una petición explícita a la biblioteca', () => {
  assert.equal(library.requestedLibraryQuery('¿Qué tengo mañana?'), '');
  assert.equal(library.requestedLibraryQuery('Busca en mi biblioteca confirmar visita'), 'confirmar visita');
  assert.equal(library.requestedLibraryQuery('Según mis fuentes guardadas, ¿qué dice sobre pagos?'), 'pagos?');
});

test('BKE local: responde con citas literales y procedencia, no con una conclusión inventada', () => {
  const reply = library.answerFromResults('confirmar visita', [{
    sourceTitle:'Procedimiento de visitas', sectionLabel:'Fragmento 1', sourceHash:'a'.repeat(64),
    excerpt:'Confirmar la visita antes de salir.', hits:['confirmar', 'visita']
  }]);
  assert.match(reply, /coincidencias literales/i);
  assert.match(reply, /Procedimiento de visitas/);
  assert.match(reply, /Fragmento 1/);
  assert.match(reply, /No son una interpretación automática/i);
});

test('BKE local: conserva una referencia técnica visible y separa cita de explicación sencilla', () => {
  const sections = library.extractSections('CAPÍTULO 4\n\nLa instalación debe verificarse antes de operar.');
  const reply = library.answerFromResults('verificar instalación', [{
    sourceTitle:'NTP técnica', sectionLabel:'CAPÍTULO 4', sourceHash:'b'.repeat(64),
    excerpt:'La instalación debe verificarse antes de operar.', hits:['verificar', 'instalación']
  }]);
  assert.equal(sections[0].label, 'CAPÍTULO 4');
  assert.match(reply, /Referencia:\*\* CAPÍTULO 4/);
  assert.match(reply, /En palabras sencillas/i);
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

test('BKE local: el chat solo conecta la biblioteca de forma explícita y sin Gemini', () => {
  const frontend = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'index.html'), 'utf8');
  assert.match(frontend, /gfcYarbiKnowledgeAnswer/);
  assert.match(frontend, /No requieren Gemini ni activan ninguna acción comercial/);
});
