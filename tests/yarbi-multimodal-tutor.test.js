const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const modulePath = path.join(__dirname, '..', 'frontend', 'yarbi-multimodal-tutor.js');
const api = require(modulePath);
const gemini = require(path.join(__dirname, '..', 'api_handlers', 'assistant', 'gemini.js'));
const source = fs.readFileSync(modulePath, 'utf8');
const memoryCenter = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'yarbi-memory-center.js'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'index.html'), 'utf8');

test('BKE multimodal: reconoce documentos, imágenes, audio y video sin mezclar categorías', () => {
  assert.equal(api.classifyFile({ name:'manual.pdf', type:'application/pdf' }), 'pdf');
  assert.equal(api.classifyFile({ name:'foto.jpg', type:'image/jpeg' }), 'image');
  assert.equal(api.classifyFile({ name:'nota.m4a', type:'audio/mp4' }), 'audio');
  assert.equal(api.classifyFile({ name:'obra.mp4', type:'video/mp4' }), 'video');
  assert.equal(api.classifyFile({ name:'reglas.md', type:'text/markdown' }), 'text');
  assert.equal(api.classifyFile({ name:'secreto.exe', type:'application/octet-stream' }), 'unsupported');
});

test('BKE multimodal: fragmenta texto de manera determinista para tutoría', () => {
  const sections = api.sectionsFromText('Primera regla.\n\nSegunda regla con más detalle.');
  assert.deepEqual(sections.map(section => section.text), ['Primera regla.', 'Segunda regla con más detalle.']);
});

test('BKE multimodal: conserva la referencia visible y adjunta evidencia verificable al tutor', () => {
  const sections = api.sectionsFromText('Numeral 5.2\n\nVerifique la instalación antes de operar.');
  const evidence = api.searchApproved([{ id:'ntp', title:'NTP de prueba', sha256:'c'.repeat(64), kind:'pdf', status:'approved', sections }], 'verifique instalación');
  const markdown = api.citationMarkdown(evidence);
  assert.equal(sections[0].label, 'Numeral 5.2');
  assert.equal(evidence[0].sectionLabel, 'Numeral 5.2');
  assert.match(markdown, /Referencia:\*\* Numeral 5\.2/);
  assert.match(markdown, /SHA-256/);
});

test('BKE multimodal: una extracción estructurada no inventa referencia cuando no viene indicada', () => {
  const result = api.parseStructuredAnalysis('{"summary":"Resumen breve","citations":[{"reference":"","quote":"Texto literal"}]}');
  assert.equal(result.summary, 'Resumen breve');
  assert.equal(result.citations[0].label, 'Fragmento extraído 1');
});

test('BKE multimodal: solo usa fuentes aprobadas como evidencia del tutor', () => {
  const results = api.searchApproved([
    { id:'ok', title:'Manual de visitas', kind:'pdf', status:'approved', sections:[{ text:'Confirmar la visita y explicar los pasos.' }] },
    { id:'draft', title:'Borrador privado', kind:'image', status:'analyzed_draft', sections:[{ text:'No usar todavía.' }] }
  ], 'visita pasos');
  assert.equal(results.length, 1);
  assert.equal(results[0].assetId, 'ok');
});

test('BKE multimodal: el resultado analizado queda indexado y no obliga a reprocesar la fuente', () => {
  const results = api.searchApproved([
    { id:'pdf-1', title:'NTP técnica', kind:'pdf', status:'approved', sections:[{ text:'La instalación debe verificarse antes de operar.' }], analysis:{ text:'Resumen: verificar instalación antes de operar.' } }
  ], 'verificar instalación');
  assert.equal(results[0].assetId, 'pdf-1');
  assert.match(source, /status === 'analyzed_draft' \|\| asset\.status === 'approved'/);
  assert.match(source, /cached:true/);
  assert.match(source, /const learnedSections = asset\.sections\?\.length \? asset\.sections : \(analysis\.citations\.length \? analysis\.citations : sectionsFromText\(analysis\.text\)\)/);
});

test('BKE multimodal: no anuncia aprendizaje automático ni acciones comerciales', () => {
  assert.match(api.html(), /aprobación es obligatoria/i);
  assert.match(api.html(), /no se ejecutan acciones comerciales/i);
  assert.match(source, /status === 'analyzed_draft'/);
  assert.match(source, /reviewed:false/);
  assert.match(source, /No alteres CRM, agenda, finanzas, WhatsApp/);
  assert.match(memoryCenter, /gfcYarbiMultimodalHtml/);
  assert.match(index, /yarbi-multimodal-tutor\.js/);
});

test('BKE multimodal: limita el envío inline a 3 MB y mantiene archivos grandes pendientes', () => {
  assert.equal(api.MAX_INLINE_BYTES, 3 * 1024 * 1024);
  assert.match(source, /status:kind === 'text' \? 'local_ready' : \(dataUrl \? 'pending_analysis' : 'blocked'\)/);
  assert.match(source, /multimodal_file_too_large/);
});

test('pasarela Gemini: admite PDF, audio y video inline sin aceptar tipos arbitrarios', () => {
  const encoded = Buffer.from('synthetic-media').toString('base64');
  const contents = gemini.sanitizeContents([{ role:'user', parts:[
    { inline_data:{ mime_type:'application/pdf', data:encoded } },
    { inline_data:{ mime_type:'audio/mp4', data:encoded } },
    { inline_data:{ mime_type:'video/mp4', data:encoded } },
    { inline_data:{ mime_type:'application/x-secret', data:encoded } }
  ] }]);
  assert.equal(contents.length, 1);
  assert.equal(contents[0].parts.length, 3);
  assert.deepEqual(contents[0].parts.map(part => part.inline_data.mime_type), ['application/pdf','audio/mp4','video/mp4']);
});
