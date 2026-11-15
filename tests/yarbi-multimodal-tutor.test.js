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
  assert.match(formatted, /^\*\*✅ Se admite bajo condiciones\./);
  assert.match(formatted, /> \[📖 Numeral 7\.3\]/);
  assert.match(formatted, /“La válvula podrá alimentar dos artefactos\.”/);
  assert.match(api.formatDirectedAnswer(unsafe, { title:'Norma técnica.pdf' }), /No encontré/);
});

test('BKE multimodal: recupera sinónimos técnicos sin convertir el chat en comandos rígidos', () => {
  const results = api.searchApproved([{
    id:'ntp', title:'NTP 111.011', kind:'pdf', status:'approved',
    sections:[{ label:'Numeral 8.4', text:'Una misma llave de corte podrá controlar dos aparatos bajo las condiciones indicadas.' }]
  }], '¿puedo usar una sola válvula para dos artefactos?');
  assert.equal(results.length, 1);
  assert.equal(results[0].assetId, 'ntp');
  assert.ok(results[0].score >= 10);
  assert.deepEqual(api.retrievalGroups('válvula artefactos').map(group => group.term), ['valvula','artefactos']);
});

test('BKE semántico: recupera la idea aunque la consulta no comparta palabras con la norma', async () => {
  const previousToken = global.gfcAccountFreshAccessToken;
  const previousOrigin = global.gfcRuntimeApiOrigin;
  const previousFetch = global.fetch;
  const documentVector = Array(768).fill(0); documentVector[3] = 0.8; documentVector[27] = 0.6;
  const queryVector = Array(768).fill(0); queryVector[3] = 0.79; queryVector[27] = 0.61;
  const unrelatedVector = Array(768).fill(0); unrelatedVector[90] = 1;
  global.gfcAccountFreshAccessToken = async () => 'synthetic-token';
  global.gfcRuntimeApiOrigin = () => 'https://synthetic.invalid';
  global.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    assert.equal(payload.operation, 'embed');
    assert.equal(payload.taskType, 'RETRIEVAL_QUERY');
    return { ok:true, json:async () => ({ embeddings:[queryVector], model:'gemini-embedding-001', dimensions:768 }) };
  };
  try {
    const assets = [{
      id:'ntp', title:'NTP técnica', kind:'pdf', status:'approved', learningEnabled:true,
      sections:[
        { id:'p8', label:'Numeral 8.4 · Página 22', text:'Una válvula común podrá alimentar dos artefactos bajo estas condiciones.', semantic:{ version:api.SEMANTIC_INDEX_VERSION, vector:api.encodeEmbedding(documentVector) } },
        { id:'p2', label:'Página 2', text:'Definiciones administrativas generales.', semantic:{ version:api.SEMANTIC_INDEX_VERSION, vector:api.encodeEmbedding(unrelatedVector) } }
      ]
    }];
    const result = await api.semanticSearchApproved(assets, '¿se admite concentrar el aislamiento de varios consumos?');
    assert.equal(result.mode, 'semantic');
    assert.equal(result.evidence[0].sectionId, 'p8');
    assert.ok(result.evidence[0].semanticScore > 0.98);
  } finally {
    global.gfcAccountFreshAccessToken = previousToken;
    global.gfcRuntimeApiOrigin = previousOrigin;
    global.fetch = previousFetch;
  }
});

test('BKE semántico: cuantiza vectores sin alterar su orden de similitud', () => {
  const base = api.encodeEmbedding([1, 0, 0, 0]);
  const close = api.encodeEmbedding([0.98, 0.1, 0, 0]);
  const far = api.encodeEmbedding([0, 0, 1, 0]);
  assert.ok(api.quantizedCosine(base, close) > 0.98);
  assert.ok(api.quantizedCosine(base, far) < 0.05);
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

test('BKE canónico: migra notas históricas sin perder aprobación ni duplicar huellas', () => {
  const approved = api.legacySourceToAsset({
    id:'old-approved', title:'Procedimiento de visitas', status:'approved', sha256:'a'.repeat(64),
    approvedAt:120, sections:[{ id:'s1', label:'Regla 1', text:'Confirmar la visita antes de salir.' }]
  });
  const draft = api.legacySourceToAsset({
    id:'old-draft', title:'Borrador', status:'draft', sha256:'b'.repeat(64),
    sections:[{ id:'s1', label:'Fragmento 1', text:'Texto por revisar.' }]
  });
  assert.equal(approved.status, 'approved');
  assert.equal(approved.learningEnabled, true);
  assert.equal(approved.provenance.approvalPreserved, true);
  assert.equal(draft.status, 'local_ready');
  assert.equal(draft.learningEnabled, false);
  const planned = api.planLegacyMigration([
    { id:'duplicate', status:'approved', sha256:'a'.repeat(64), sections:[{ text:'Duplicado.' }] },
    { id:'new', status:'draft', sha256:'c'.repeat(64), sections:[{ text:'Nueva nota.' }] }
  ], [approved], 80);
  assert.equal(planned.length, 1);
  assert.equal(planned[0].provenance.sourceId, 'new');
});

test('BKE canónico: las notas aprobadas participan en el mismo ranking que los PDF', () => {
  const assets = [
    { id:'text', title:'Procedimiento interno', kind:'text', status:'approved', sections:[{ label:'Regla', text:'Confirmar siempre la visita con el cliente.' }] },
    { id:'pdf', title:'Norma técnica', kind:'pdf', status:'approved', sections:[{ label:'Página 1', text:'Instalaciones generales.' }] },
    { id:'paused', title:'Nota pausada', kind:'text', status:'approved', learningEnabled:false, sections:[{ label:'Regla', text:'Confirmar visita.' }] }
  ];
  assert.deepEqual(api.approvedKnowledgeAssets(assets).map(asset => asset.id), ['text','pdf']);
  assert.equal(api.rankApprovedSources(assets, 'confirmar visita')[0].asset.id, 'text');
});

test('BKE canónico: permite pegar texto en la misma biblioteca con revisión obligatoria', () => {
  assert.match(source, /gfcYarbiMultimodalImportText/);
  assert.match(source, /gfc-mm-text-value/);
  assert.match(source, /Pega aquí un procedimiento, regla o material de referencia/);
  assert.match(source, /Falta tu aprobación|Falta tu aprobaci[oó]n|falta tu aprobación/i);
  assert.match(memoryCenter, /una sola biblioteca/);
});

test('BKE multimodal: no elige una norma por una coincidencia débil', () => {
  const one = { id:'pdf-a', title:'NTP 111.011.pdf', kind:'pdf', status:'approved', dataUrl:'data:application/pdf;base64,QQ==' };
  const other = { id:'pdf-b', title:'EM.040 Instalaciones de gas.pdf', kind:'pdf', status:'approved', dataUrl:'data:application/pdf;base64,Qg==' };
  assert.equal(api.selectApprovedDirectAsset([one], [], 'válvula para artefactos').id, 'pdf-a');
  assert.equal(api.selectApprovedDirectAsset([one, other], [{ assetId:'pdf-b' }], 'válvula para dos artefactos'), null);
  assert.equal(api.selectApprovedDirectAsset([one, other], [], 'según la NTP 111.011').id, 'pdf-a');
  assert.equal(api.selectApprovedDirectAsset([one, other], [], 'según EM.040').id, 'pdf-b');
  assert.equal(api.selectApprovedDirectAsset([one, other], [], 'según la norma'), null);
});

test('BKE multimodal: enruta fuentes con identificadores permitidos y rechaza IDs inventados', () => {
  const routed = api.parseSourceRoute('{"selected_asset_id":"ntp","confidence":"high","search_terms":["llave de corte","artefactos"]}', ['ntp','em040']);
  const invented = api.parseSourceRoute('{"selected_asset_id":"produccion","confidence":"high","search_terms":[]}', ['ntp','em040']);
  assert.equal(routed.selectedAssetId, 'ntp');
  assert.deepEqual(routed.searchTerms, ['llave de corte','artefactos']);
  assert.equal(invented.selectedAssetId, '');
  assert.equal(invented.confidence, 'low');
});

test('BKE multimodal: la respuesta unificada exige una fuente permitida y una cita verificable', () => {
  const valid = api.parseLibraryAnswer('{"selected_asset_id":"ntp","found":true,"answer":"Sí, bajo condiciones.","exact_quote":"Una llave controla dos aparatos.","reference":"Numeral 8.4","plain_explanation":"Revisa las condiciones.","caveat":""}', ['ntp']);
  const invented = api.parseLibraryAnswer('{"selected_asset_id":"otra","found":true,"answer":"Sí.","exact_quote":"Texto","reference":"1"}', ['ntp']);
  assert.equal(valid.ok, true);
  assert.equal(valid.selectedAssetId, 'ntp');
  assert.equal(valid.found, true);
  assert.equal(invented.selectedAssetId, '');
  assert.equal(invented.found, false);
});

test('BKE multimodal: corta una consulta bloqueada y devuelve un timeout controlado', async () => {
  const previousFetch = global.fetch;
  global.fetch = (_url, options) => new Promise((_resolve, reject) => {
    options.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name:'AbortError' })), { once:true });
  });
  try {
    await assert.rejects(
      api.fetchJsonWithTimeout('https://synthetic.invalid', { method:'POST' }, 50),
      error => error?.code === 'multimodal_request_timeout'
    );
  } finally {
    global.fetch = previousFetch;
  }
});

test('BKE multimodal: el ranking conserva fuentes separadas y las pausadas no participan', () => {
  const assets = [
    { id:'ntp', title:'NTP 111.011', kind:'pdf', status:'approved', sections:[{ label:'Numeral 8.4', text:'Una válvula puede controlar dos artefactos bajo estas condiciones.' }] },
    { id:'em040', title:'EM.040', kind:'pdf', status:'approved', sections:[{ label:'Artículo 1', text:'Requisitos generales para instalaciones de gas.' }] },
    { id:'paused', title:'Manual antiguo', kind:'pdf', status:'approved', learningEnabled:false, sections:[{ label:'Página 2', text:'válvula dos artefactos' }] }
  ];
  const ranking = api.rankApprovedSources(assets, 'una válvula para dos artefactos');
  assert.equal(ranking[0].asset.id, 'ntp');
  assert.equal(ranking.some(row => row.asset.id === 'paused'), false);
});

test('BKE multimodal: Gemini enruta la consulta sin responderla ni cambiar el catálogo', async () => {
  const previousToken = global.gfcAccountFreshAccessToken;
  const previousOrigin = global.gfcRuntimeApiOrigin;
  const previousFetch = global.fetch;
  global.gfcAccountFreshAccessToken = async () => 'synthetic-token';
  global.gfcRuntimeApiOrigin = () => 'https://synthetic.invalid';
  global.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    assert.match(payload.system_instruction.parts[0].text, /No respondas la pregunta/);
    return { ok:true, json:async () => ({ candidates:[{ content:{ parts:[{ text:'{"selected_asset_id":"ntp","confidence":"high","search_terms":["llave de corte"]}' }] } }] }) };
  };
  try {
    const assets = [
      { id:'ntp', title:'NTP 111.011', kind:'pdf', status:'approved', sections:[{ label:'Numeral 8', text:'Válvulas para artefactos.' }] },
      { id:'em040', title:'EM.040', kind:'pdf', status:'approved', sections:[{ label:'Artículo 1', text:'Instalaciones de gas.' }] }
    ];
    const routed = await api.routeApprovedSource(assets, '¿puedo usar una sola válvula para dos artefactos?');
    assert.equal(routed.asset.id, 'ntp');
    assert.deepEqual(routed.searchTerms, ['llave de corte']);
  } finally {
    global.gfcAccountFreshAccessToken = previousToken;
    global.gfcRuntimeApiOrigin = previousOrigin;
    global.fetch = previousFetch;
  }
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
  assert.match(index, /let multimodalKnowledgeReply = null/);
  assert.ok(index.indexOf('let multimodalKnowledgeReply = null') < index.indexOf('const knowledgeReply = typeof window.gfcYarbiKnowledgeAnswer'), 'la biblioteca PDF debe preceder a la biblioteca textual heredada');
  assert.match(index, /multimodal-knowledge-error/);
  assert.match(source, /Busca la respuesta exclusivamente dentro del PDF adjunto/);
  assert.match(source, /responseMimeType:'application\/json'/);
  assert.match(source, /queryCache/);
  assert.match(source, /queryApprovedLibrary\(assets, text, semantic\)/);
  assert.match(source, /Interpretando el significado de tu pregunta/);
  assert.match(source, /RETRIEVAL_DOCUMENT/);
  assert.match(source, /RETRIEVAL_QUERY/);
  assert.match(source, /La consulta tardó demasiado y la detuve/);
  assert.match(source, /fetchJsonWithTimeout/);
  assert.match(source, /conclusión directa en máximo 45 palabras/);
  assert.match(source, /explicación sencilla en máximo 55 palabras/);
});

test('BKE multimodal: explica el estado real de la fuente sin pedir borrarla o recargarla', () => {
  const draft = api.libraryAvailabilityReply([{ kind:'pdf', status:'analyzed_draft', title:'NTP 111.011.pdf' }]);
  assert.match(draft, /falta aprobarla/i);
  assert.match(draft, /No las borres ni las vuelvas a cargar/i);
  const pending = api.libraryAvailabilityReply([{ kind:'pdf', status:'local_ready', title:'Manual.pdf' }]);
  assert.match(pending, /pulsa \*\*Analizar\*\*/);
  const paused = api.libraryAvailabilityReply([{ kind:'pdf', status:'approved', learningEnabled:false, title:'Norma.pdf' }]);
  assert.match(paused, /uso está pausado/i);
  const missing = api.libraryAvailabilityReply([]);
  assert.match(missing, /No encuentro fuentes guardadas en esta instalación/);
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
  assert.match(source, /fragmentos indexados/);
});

test('BKE multimodal: presenta fuentes compactas con peso, pausa y borrado independientes', () => {
  assert.equal(api.formatBytes(2.45 * 1024 * 1024), '2.5 MB');
  assert.match(source, /gfcYarbiMultimodalToggleLearning/);
  assert.match(source, /gfcYarbiMultimodalDelete/);
  assert.match(source, /Fuera del aprendizaje/);
  assert.match(source, /La fuente y su índice local fueron eliminados/);
  assert.match(index, /\.gfc-mm-state\.paused/);
  assert.match(index, /\.gfc-mm-btn\.danger/);
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
  assert.match(memoryCenter, /if \(initialTab === 'knowledge'\) initialTab = 'memoria'/);
  assert.doesNotMatch(memoryCenter, /<b>Notas y textos<\/b>/);
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

test('pasarela Gemini: limita embeddings y acepta solo tareas de recuperación documentadas', () => {
  const valid = gemini.sanitizeEmbeddingRequest({ operation:'embed', taskType:'RETRIEVAL_DOCUMENT', title:'Norma técnica', texts:['Fragmento uno', 'Fragmento dos'] });
  const invalid = gemini.sanitizeEmbeddingRequest({ operation:'embed', texts:[] });
  const coerced = gemini.sanitizeEmbeddingRequest({ operation:'embed', taskType:'ADMIN_OVERRIDE', texts:['Consulta'] });
  assert.equal(valid.taskType, 'RETRIEVAL_DOCUMENT');
  assert.equal(valid.outputDimensionality, 768);
  assert.deepEqual(valid.texts, ['Fragmento uno', 'Fragmento dos']);
  assert.equal(invalid, null);
  assert.equal(coerced.taskType, 'RETRIEVAL_QUERY');
});
