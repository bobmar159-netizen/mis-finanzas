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

function syntheticPdf(text) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    '<< /Length ' + (text.length + 30) + ' >>\nstream\nBT /F1 12 Tf 72 720 Td (' + text.replace(/[()\\]/g, '\\$&') + ') Tj ET\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let value = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(value)); value += (index + 1) + ' 0 obj\n' + object + '\nendobj\n'; });
  const xref = Buffer.byteLength(value);
  value += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n' + offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n ').join('\n') + '\n';
  value += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';
  return Buffer.from(value, 'binary');
}

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
  const evidenceByReference = api.searchApproved([{ id:'ntp', title:'NTP de prueba', sha256:'c'.repeat(64), kind:'pdf', status:'approved', sections }], 'numeral 5.2');
  const markdown = api.citationMarkdown(evidence);
  assert.equal(sections[0].label, 'Numeral 5.2');
  assert.equal(evidence[0].sectionLabel, 'Numeral 5.2');
  assert.equal(evidenceByReference[0].sectionLabel, 'Numeral 5.2');
  assert.match(markdown, /> \[📖 Numeral 5\.2\]/);
  assert.match(markdown, /SHA-256/);
});

test('BKE multimodal: una extracción estructurada no inventa referencia cuando no viene indicada', () => {
  const result = api.parseStructuredAnalysis('{"summary":"Resumen breve","citations":[{"reference":"","quote":"Texto literal"}]}');
  assert.equal(result.summary, 'Resumen breve');
  assert.equal(result.citations[0].label, 'Fragmento extraído 1');
});

test('BKE multimodal: la búsqueda dirigida exige cita y ubicación antes de afirmar que encontró la regla', () => {
  const found = api.parseDirectedAnswer('{"found":true,"answer":"Se admite bajo condiciones.","exact_quote":"La válvula podrá alimentar dos artefactos.","reference":"Numeral 7.3","plain_explanation":"Debe cumplirse la condición indicada.","caveat":"Verificar capacidad."}');
  const unsafe = api.parseDirectedAnswer('{"found":true,"answer":"Sí.","exact_quote":"","reference":"","plain_explanation":"","caveat":""}');
  assert.equal(found.found, true);
  assert.equal(unsafe.found, false);
  const formatted = api.formatDirectedAnswer(found, { title:'Norma técnica.pdf', sha256:'d'.repeat(64) });
  assert.match(formatted, /## ✅ Respuesta breve/);
  assert.match(formatted, /> \[📖 Numeral 7\.3\]/);
  assert.match(formatted, /“La válvula podrá alimentar dos artefactos\.”/);
  assert.match(api.formatDirectedAnswer(unsafe, { title:'Norma técnica.pdf' }), /No encontré/);
});

test('BKE multimodal: indexa páginas de PDF con referencia visible y límites explícitos', () => {
  const state = { characters:0, sections:0 };
  const rows = api.pdfPageSections(12, 'Numeral 6.2.5.4\nEl área libre de la rejilla será setenta y cinco por ciento.', state);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, 'Numeral 6.2.5.4 · Página 12');
  assert.match(rows[0].text, /setenta y cinco/);
  assert.equal(api.MAX_PDF_FILE_BYTES, 120 * 1024 * 1024);
});

test('BKE multimodal: PDF.js extrae e indexa un PDF real sin enviarlo al proveedor', async () => {
  const file = new File([syntheticPdf('Numeral 7.3 La valvula alimenta dos artefactos.')], 'norma.pdf', { type:'application/pdf' });
  const asset = await api.buildAsset(file);
  assert.equal(asset.kind, 'pdf');
  assert.equal(asset.status, 'local_ready');
  assert.equal(asset.extraction.pages, 1);
  assert.match(asset.sections.map(section => section.text).join(' '), /dos artefactos/);
});

test('BKE multimodal: reimportar un PDF actualiza una ficha antigua bloqueada sin duplicarla', () => {
  const upgraded = api.upgradeBlockedDuplicate(
    { id:'old', status:'blocked', createdAt:100 },
    { id:'new', status:'local_ready', createdAt:200, title:'Norma.pdf', sections:[{ id:'p1', label:'Página 1', text:'Regla' }] }
  );
  assert.equal(upgraded.id, 'old');
  assert.equal(upgraded.createdAt, 100);
  assert.equal(upgraded.status, 'local_ready');
  assert.equal(api.upgradeBlockedDuplicate({ status:'approved' }, { status:'local_ready' }), null);
  assert.equal(api.upgradeBlockedDuplicate({ status:'blocked' }, { status:'blocked' }), null);
});

test('BKE multimodal: selecciona el PDF aprobado sin mezclar varias normas', () => {
  const one = { id:'pdf-a', title:'Norma A', kind:'pdf', status:'approved', dataUrl:'data:application/pdf;base64,QQ==' };
  const other = { id:'pdf-b', title:'Norma B', kind:'pdf', status:'approved', dataUrl:'data:application/pdf;base64,Qg==' };
  assert.equal(api.selectApprovedDirectAsset([one], [], 'válvula para artefactos').id, 'pdf-a');
  assert.equal(api.selectApprovedDirectAsset([one, other], [{ assetId:'pdf-b' }], 'según la norma').id, 'pdf-b');
  assert.equal(api.selectApprovedDirectAsset([one, other], [], 'según la norma'), null);
});

test('BKE multimodal: solo usa fuentes aprobadas como evidencia del tutor', () => {
  const results = api.searchApproved([
    { id:'ok', title:'Manual de visitas', kind:'pdf', status:'approved', sections:[{ text:'Confirmar la visita y explicar los pasos.' }] },
    { id:'draft', title:'Borrador privado', kind:'image', status:'analyzed_draft', sections:[{ text:'No usar todavía.' }] }
  ], 'visita pasos');
  assert.equal(results.length, 1);
  assert.equal(results[0].assetId, 'ok');
});

test('BKE multimodal: distingue consultas documentales de lecturas normales del negocio', () => {
  assert.equal(api.knowledgeIntent('¿Qué dice el numeral 5.2 de la NTP?'), true);
  assert.equal(api.knowledgeIntent('¿Cuál es mi balance del mes?'), false);
  assert.deepEqual(api.contentTokens('¿Qué dice la norma sobre ventilación permanente?'), ['ventilacion', 'permanente']);
});

test('BKE multimodal: el chat principal consulta la misma biblioteca aprobada', () => {
  assert.match(source, /root\.gfcYarbiMultimodalAnswer = api\.answerFromChat/);
  assert.match(source, /function answerFromChat/);
  assert.match(source, /Fuente procesada, aprobación pendiente/);
  assert.match(source, /No usaré su contenido como conocimiento definitivo/);
  assert.match(index, /window\.gfcYarbiMultimodalAnswer/);
  assert.match(index, /const multimodalKnowledgeReply/);
  assert.match(source, /Busca la respuesta exclusivamente dentro del PDF adjunto/);
  assert.match(source, /responseMimeType:'application\/json'/);
  assert.match(source, /queryCache/);
  assert.match(source, /conclusión directa en máximo 45 palabras/);
  assert.match(source, /explicación sencilla en máximo 55 palabras/);
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

test('BKE multimodal: limita el envío inline y procesa PDF grandes mediante índice local', () => {
  assert.equal(api.MAX_INLINE_BYTES, 3 * 1024 * 1024);
  assert.match(source, /MAX_PDF_FILE_BYTES = 120 \* 1024 \* 1024/);
  assert.match(source, /extractPdfSections/);
  assert.match(source, /pdf\.worker\.min\.mjs/);
  assert.match(source, /locallyIndexed \? 'local_ready'/);
  assert.match(source, /Índice local:/);
});

test('BKE multimodal: los controles visibles usan flujos UI con progreso y revisión', () => {
  const markup = api.html();
  assert.match(source, /root\.gfcYarbiMultimodalImport = \(\) => api\.importFromUi\(true\)/);
  assert.match(source, /root\.gfcYarbiMultimodalAnalyze = api\.analyzeFromUi/);
  assert.match(source, /root\.gfcYarbiMultimodalApprove = api\.approveFromUi/);
  assert.match(source, /root\.gfcYarbiTutorAsk = api\.askTutorFromUi/);
  assert.match(markup, /gfc-mm-progress-chip/);
  assert.match(markup, /gfc-mm-progress-percent/);
  assert.match(markup, /Agregar y procesar/);
  assert.match(markup, /Buscar archivos en el teléfono/);
});

test('BKE multimodal: la navegación conserva la pantalla anterior', () => {
  assert.match(memoryCenter, /_gfcYarbiNavigationStack/);
  assert.match(memoryCenter, /const previous = stack\.pop\(\)/);
  assert.match(memoryCenter, /Conocimiento y Tutor/);
  assert.match(memoryCenter, /Notas y textos/);
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
