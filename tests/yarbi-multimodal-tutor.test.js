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

test('BKE audio/video: convierte transcripción y observaciones temporales en fragmentos buscables y revisables', () => {
  const parsed = api.parseStructuredAnalysis(JSON.stringify({
    summary:'Se explica una prueba de hermeticidad.',
    transcript:'Primero cierro las válvulas y verifico la presión. Luego registro el resultado.',
    observations:[
      { timestamp:'00:12', text:'Se observa un manómetro conectado a la instalación.' },
      { timestamp:'99:99', text:'Este tiempo inválido se descarta.' }
    ],
    citations:[]
  }));
  const audio = api.mediaTranscriptSections('audio', parsed);
  const video = api.mediaTranscriptSections('video', parsed);
  assert.ok(audio.length > 0);
  assert.match(audio.map(row => row.text).join(' '), /cierro las válvulas/);
  assert.equal(audio.some(row => /observa un manómetro/.test(row.text)), false);
  assert.ok(video.some(row => row.label.includes('00:12') && /manómetro/.test(row.text)));
  assert.ok(video.some(row => /cierro las válvulas/.test(row.text)));
  assert.equal(video.some(row => row.text.includes('tiempo inválido')), false);
  assert.deepEqual(api.mediaTranscriptSections('audio', { summary:'Solo un resumen, sin transcripción.' }), []);
});

function syntheticPng(width, height) {
  const bytes=new Uint8Array(24);
  bytes.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);
  const view=new DataView(bytes.buffer);
  view.setUint32(16, width, false); view.setUint32(20, height, false);
  return bytes;
}

test('File Search de imágenes valida PNG/JPEG real, MIME y tope de 4096 × 4096', () => {
  const png=syntheticPng(3200, 1800);
  assert.deepEqual(api.inspectFileSearchImage(png, 'image/png'), { mimeType:'image/png', width:3200, height:1800 });
  assert.equal(api.inspectFileSearchImage(png, 'image/jpeg'), null);
  assert.equal(api.inspectFileSearchImage(syntheticPng(4097, 100), 'image/png'), null);
  const jpeg=new Uint8Array(24);
  jpeg.set([0xff,0xd8,0xff,0xc0,0,17,8,0,10,0,20]);
  assert.deepEqual(api.inspectFileSearchImage(jpeg, 'image/jpeg'), { mimeType:'image/jpeg', width:20, height:10 });
  assert.equal(api.inspectFileSearchImage(new Uint8Array(24), 'image/png'), null);
});

test('BKE conserva PNG/JPEG apto para Gemini como original, con dimensiones verificadas', async () => {
  const file=new File([syntheticPng(640, 480)], 'plano.png', { type:'image/png' });
  const asset=await api.buildAsset(file);
  assert.equal(asset.kind, 'image');
  assert.equal(asset.mime, 'image/png');
  assert.deepEqual(asset.fileSearchImage, { mimeType:'image/png', width:640, height:480 });
  assert.equal(asset.originalBlob.size, file.size);
  assert.equal(asset.originalBlob.type, 'image/png');
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
  assert.match(formatted, /^## ✅ Respuesta breve/);
  assert.ok(formatted.indexOf('Se admite bajo condiciones.') < formatted.indexOf('Cita literal'), 'la conclusión debe aparecer antes de la evidencia');
  assert.match(formatted, /> \[📖 Cita literal · Numeral 7\.3\]/);
  assert.match(formatted, /“La válvula podrá alimentar dos artefactos\.”/);
  assert.match(formatted, /### En palabras sencillas/);
  assert.match(formatted, /la explicación sencilla es una interpretación de Yarbi/i);
  assert.match(api.formatDirectedAnswer(unsafe, { title:'Norma técnica.pdf' }), /No encontré/);
});

test('BKE multimodal: usa variantes semánticas generadas para recuperar paráfrasis sin un diccionario rígido', () => {
  const assets = [{
    id:'ntp', title:'NTP 111.011', kind:'pdf', status:'approved',
    sections:[{ label:'Numeral 8.4', text:'Una misma llave de corte podrá controlar dos aparatos bajo las condiciones indicadas.' }]
  }];
  const question = '¿puedo usar una sola válvula para dos artefactos?';
  const results = api.searchApprovedQueries(assets, [question, 'llave de corte para aparatos']);
  assert.ok(api.searchApproved(assets, question)[0].coverage < 0.25, 'la recuperación local debe reconocer que la consulta literal solo coincide parcialmente');
  assert.equal(results.length, 1);
  assert.equal(results[0].assetId, 'ntp');
  assert.equal(results[0].coverage, 1, 'la consulta reformulada debe recuperar el fragmento con cobertura completa');
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

test('BKE semántico: una coincidencia local fuerte evita una llamada redundante de embeddings', async () => {
  const previousFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => { fetchCalls += 1; throw new Error('no debe llamar embeddings'); };
  try {
    const vector = api.encodeEmbedding([1, ...Array(767).fill(0)]);
    const result = await api.semanticSearchApproved([{
      id:'ntp-local', title:'NTP local', kind:'pdf', status:'approved', learningEnabled:true,
      sections:[{ id:'p1', label:'Numeral 8.4', text:'Una válvula común podrá alimentar dos artefactos bajo condiciones verificadas.', semantic:{ version:api.SEMANTIC_INDEX_VERSION, vector } }]
    }], 'Una válvula común podrá alimentar dos artefactos bajo condiciones verificadas.');
    assert.equal(result.mode, 'lexical_confident');
    assert.equal(result.evidence[0].sectionId, 'p1');
    assert.equal(fetchCalls, 0);
  } finally { global.fetch = previousFetch; }
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

test('BKE tutor: conserva la reformulación semántica de una pregunta desordenada', () => {
  const plan = api.parseKnowledgeIntent(JSON.stringify({
    intent:'knowledge',
    reason:'pregunta técnica',
    normalized_query:'condiciones para alimentar dos artefactos desde una válvula común',
    search_terms:['válvula común','dos artefactos','alimentación','condiciones'],
    query_variants:['una llave para dos aparatos de gas']
  }));
  assert.equal(plan.intent, 'knowledge');
  assert.match(plan.normalizedQuery, /dos artefactos/);
  assert.deepEqual(plan.searchTerms, ['válvula común','dos artefactos','alimentación','condiciones']);
  assert.deepEqual(plan.variants, ['una llave para dos aparatos de gas']);
});

test('BKE tutor: preserva cifras, unidades y códigos y pide aclaración si el intérprete los cambia', () => {
  const question = '¿La NTP 111.011 permite 2 artefactos con 21 m de tubería?';
  const values = api.protectedValues(question);
  assert.deepEqual(values, ['ntp111.011','2','21m']);
  const safe = api.validateProtectedKnowledgeIntent(question, [], {
    normalizedQuery:'Según NTP 111.011, condiciones para 2 artefactos y tubería de 21 m.'
  });
  const changed = api.validateProtectedKnowledgeIntent(question, [], {
    normalizedQuery:'Según NTP 111.011, condiciones para 1 artefacto y tubería de 12 m.'
  });
  const invented = api.validateProtectedKnowledgeIntent('¿Qué indica el numeral?', [], {
    normalizedQuery:'La norma indica un máximo de 2 artefactos en este caso.'
  });
  assert.equal(safe.ok, true);
  assert.equal(changed.clarificationRequired, true);
  assert.match(changed.clarificationQuestion, /2|21m/);
  assert.equal(invented.clarificationRequired, true);
  assert.match(invented.clarificationQuestion, /añadió el valor/);
});

test('BKE tutor: el intérprete solicita aclaración sin convertirla en consulta documental', async () => {
  const previousToken = global.gfcAccountFreshAccessToken;
  const previousOrigin = global.gfcRuntimeApiOrigin;
  const previousFetch = global.fetch;
  global.gfcAccountFreshAccessToken = async () => 'synthetic-token';
  global.gfcRuntimeApiOrigin = () => 'https://synthetic.invalid';
  global.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    assert.match(payload.system_instruction.parts[0].text, /Conserva exactamente cada número/);
    return { ok:true, json:async () => ({ candidates:[{ content:{ parts:[{ text:JSON.stringify({
      intent:'knowledge', normalized_query:'NTP 111.011 permite 1 artefacto', search_terms:['válvula'],
      query_variants:[], clarification_required:false
    }) }] } }] }) };
  };
  try {
    const result = await api.classifyKnowledgeIntent('¿NTP 111.011 permite 2 artefactos?', [{
      id:'ntp', title:'NTP 111.011', kind:'pdf', status:'approved', sections:[{ label:'Numeral 7', text:'Regla sintética.' }]
    }], []);
    assert.equal(result.intent, 'knowledge');
    assert.equal(result.clarificationRequired, true);
    assert.match(result.clarificationQuestion, /2/);
    assert.equal(result.source, 'gemini_intent_clarification');
  } finally {
    global.gfcAccountFreshAccessToken = previousToken;
    global.gfcRuntimeApiOrigin = previousOrigin;
    global.fetch = previousFetch;
  }
});

test('BKE tutor: resuelve una pregunta elíptica usando el contexto y la fuente ya mencionada', async () => {
  const previousToken = global.gfcAccountFreshAccessToken;
  const previousOrigin = global.gfcRuntimeApiOrigin;
  const previousFetch = global.fetch;
  let sent = '';
  global.gfcAccountFreshAccessToken = async () => 'synthetic-token';
  global.gfcRuntimeApiOrigin = () => 'https://synthetic.invalid';
  global.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    sent = payload.contents[0].parts[0].text;
    return { ok:true, json:async () => ({ candidates:[{ content:{ parts:[{ text:JSON.stringify({
      intent:'knowledge', normalized_query:'¿Qué establece NTP 111.011 sobre válvula para 2 artefactos?',
      search_terms:['válvula común','dos artefactos'], query_variants:[], source_asset_id:'ntp'
    }) }] } }] }) };
  };
  try {
    const context = [
      { role:'user', text:'Estoy revisando NTP 111.011 sobre una válvula para dos artefactos.' },
      { role:'assistant', text:'¿Quieres que busque las condiciones de esa conexión?' }
    ];
    const result = await api.classifyKnowledgeIntent('¿Y qué pasa si uso la otra?', [
      { id:'ntp', title:'NTP 111.011', kind:'pdf', status:'approved', sections:[{ label:'Numeral 8.4', text:'Texto sintético.' }] },
      { id:'em040', title:'EM.040', kind:'pdf', status:'approved', sections:[{ label:'Numeral 3', text:'Otro texto sintético.' }] }
    ], context);
    assert.match(sent, /Estoy revisando NTP 111\.011/);
    assert.match(sent, /¿Y qué pasa si uso la otra\?/);
    assert.equal(result.intent, 'knowledge');
    assert.equal(result.sourceAssetId, 'ntp');
    assert.equal(result.clarificationRequired, false);
  } finally {
    global.gfcAccountFreshAccessToken = previousToken;
    global.gfcRuntimeApiOrigin = previousOrigin;
    global.fetch = previousFetch;
  }
});

test('BKE local y respaldo: las fuentes locales quedan separadas por propietario', () => {
  const ownerA = '11111111-1111-4111-8111-111111111111';
  const ownerB = '22222222-2222-4222-8222-222222222222';
  const rows = [
    { id:'a', ownerAccountId:ownerA, title:'Norma privada A' },
    { id:'b', ownerAccountId:ownerB, title:'Norma privada B' },
    { id:'device', ownerAccountId:'device', title:'Biblioteca local sin cuenta' },
    { id:'legacy', title:'Biblioteca local anterior' }
  ];
  const firstOwner = api.scopeLocalKnowledgeAssets(rows, ownerA);
  const sharedStoreAfterMigration = [...firstOwner.assets, rows.find(asset => asset.id === 'b')];
  const secondOwner = api.scopeLocalKnowledgeAssets(sharedStoreAfterMigration, ownerB);
  assert.deepEqual(firstOwner.assets.map(asset => asset.id).sort(), ['a','device','legacy']);
  assert.deepEqual(firstOwner.migrated.map(asset => asset.ownerAccountId), [ownerA, ownerA]);
  assert.deepEqual(secondOwner.assets.map(asset => asset.id), ['b']);
  assert.equal(api.scopeLocalKnowledgeAssets(rows, 'device').assets.some(asset => asset.id === 'a'), false);
});

test('BKE local: el índice léxico reutilizado invalida cuando cambia la versión de una fuente', () => {
  const asset = { id:'cached-source', sha256:'d'.repeat(64), updatedAt:100, title:'Manual', kind:'pdf', status:'approved', sections:[{ id:'p1', label:'Página 1', text:'Válvula de seguridad.' }] };
  assert.equal(api.searchApproved([asset], 'válvula').length, 1);
  asset.sections[0].text = 'Prueba de hermeticidad.';
  asset.updatedAt = 101;
  assert.equal(api.searchApproved([asset], 'válvula').length, 0);
  assert.equal(api.searchApproved([asset], 'hermeticidad').length, 1);
});

test('BKE RAG: verifica la cita contra la evidencia de la fuente seleccionada', () => {
  const rankings = [
    { asset:{ id:'ntp', title:'NTP 111.011' }, evidence:[{ sectionLabel:'Numeral 8.4 · Página 22' }] },
    { asset:{ id:'em040', title:'EM.040' }, evidence:[{ sectionLabel:'Numeral 5.1 · Página 9' }] }
  ];
  assert.equal(api.verifiedReferenceForSelectedRanking({ reference:'Numeral 8.4' }, 'ntp', rankings), 'Numeral 8.4 · Página 22');
  assert.equal(api.verifiedReferenceForSelectedRanking({ reference:'Numeral 5.1' }, 'ntp', rankings), '');
  assert.equal(api.verifiedReferenceForSelectedRanking({ reference:'Numeral 5.1' }, 'em040', rankings), 'Numeral 5.1 · Página 9');
});

test('BKE tutor: combina pregunta original y conceptos interpretados sin duplicar fragmentos', () => {
  const assets = [{ id:'norma-1', title:'Norma de gas', status:'approved', learningEnabled:true, sections:[
    { id:'p1', label:'Numeral 6.2 · Página 10', text:'Una válvula común puede alimentar dos artefactos bajo las condiciones indicadas.' },
    { id:'p2', label:'Numeral 7 · Página 12', text:'La prueba de hermeticidad debe realizarse antes de operar.' }
  ] }];
  const rows = api.searchApprovedQueries(assets, ['¿puedo usar una sola llave para dos equipos?', 'válvula común dos artefactos'], { limit:10 });
  assert.equal(rows.filter(row => row.sectionId === 'p1').length, 1);
  assert.equal(rows[0].sectionId, 'p1');
  assert.ok(rows[0].hits.includes('valvula') || rows[0].hits.includes('artefacto'));
});

test('BKE multimodal: el chat principal consulta la misma biblioteca aprobada', () => {
  assert.match(source, /root\.gfcYarbiMultimodalAnswer = api\.answerFromChat/);
  assert.match(source, /function answerFromChat/);
  assert.match(source, /Fuente procesada, aprobación pendiente/);
  assert.match(source, /No usaré su contenido como conocimiento definitivo/);
  assert.match(index, /window\.gfcYarbiMultimodalAnswer/);
  assert.match(index, /window\.gfcYarbiMultimodalAnswer\(query, \{ context \}\)/);
  assert.match(index, /get_approved_knowledge/);
  assert.match(index, /let multimodalKnowledgeReply = null/);
  assert.ok(index.indexOf('let multimodalKnowledgeReply = null') < index.indexOf('const knowledgeReply = typeof window.gfcYarbiKnowledgeAnswer'), 'la biblioteca PDF debe preceder a la biblioteca textual heredada');
  assert.match(index, /multimodal-knowledge-error/);
  assert.match(index, /gfcAwaitYarbiKnowledgeReply/);
  assert.match(index, /knowledge_deadline/);
  assert.match(index, /multimodal-knowledge-complete/);
  assert.match(source, /Eres el buscador documental de Yarbi/);
  assert.match(source, /responseMimeType:'application\/json'/);
  assert.match(source, /queryCache/);
  assert.match(source, /queryApprovedLibrary\(assets, queryForRetrieval/);
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
  assert.match(pending, /pulsa \*\*Preparar revisión\*\*/);
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
  assert.match(source, /mediaTranscriptSections\(asset\.kind, extracted\)/);
  assert.match(source, /const learnedSections = asset\.sections\?\.length \? asset\.sections : mediaSections\.length \? mediaSections/);
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
  assert.match(source, /root\.gfcYarbiMultimodalFileSearch = api\.syncApprovedAssetToFileSearchFromUi/);
  assert.match(source, /root\.gfcYarbiMultimodalSelectPdf = api\.selectOriginalPdfForFileSearchFromUi/);
  assert.match(source, /El archivo seleccionado no coincide exactamente con el PDF aprobado/);
  assert.match(source, /knowledge_file_search_index_failed/);
  assert.doesNotMatch(source, /root\.gfcYarbiTutorAsk =/);
  assert.match(markup, /gfc-mm-progress-chip/);
  assert.match(markup, /gfc-mm-progress-percent/);
  assert.match(markup, /Agregar y procesar/);
  assert.match(markup, /Buscar archivos en el teléfono/);
  assert.match(markup, /gfcSetYarbiInteractionMode\('normal'\)/);
  assert.doesNotMatch(markup, /Preguntar al Tutor|gfc-mm-tutor-question|gfc-mm-tutor-answer/);
});

test('BKE multimodal: la navegación conserva la pantalla anterior', () => {
  assert.match(memoryCenter, /_gfcYarbiNavigationStack/);
  assert.match(memoryCenter, /const previous = stack\.pop\(\)/);
  assert.match(memoryCenter, /Biblioteca de Yarbi/);
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

test('respaldo de conocimiento: el servidor vincula dueño y fragmentos a la identidad autenticada', () => {
  const ownerA = '11111111-1111-4111-8111-111111111111';
  const ownerB = '22222222-2222-4222-8222-222222222222';
  const accepted = gemini.validateKnowledgeSync({
    operation:'knowledge_sync',
    asset:{ owner_account_id:ownerB, sha256:'a'.repeat(64), title:'NTP sintética', kind:'pdf', bytes:1200, section_count:1 },
    sections:[{ index:0, id:'p1-1', label:'Numeral 1 · Página 1', text:'Contenido sintético.' }]
  }, ownerA);
  assert.equal(accepted.asset.owner_account_id, ownerA);
  assert.equal(accepted.sections[0].owner_account_id, ownerA);
  assert.equal(gemini.knowledgeCoverageComplete(2, 0, 1, 2), true);
  assert.equal(gemini.knowledgeCoverageComplete(2, 0, 2, 2), false, 'un índice con hueco o sección sobrante no debe declararse completo');
  assert.equal(gemini.knowledgeCoverageComplete(1, 1, 1, 1), false, 'la primera sección debe comenzar en índice cero');
});

test('respaldo rechaza embeddings sin versión y acepta el vector cuantizado contractual', () => {
  const owner = '11111111-1111-4111-8111-111111111111';
  const base = {
    operation:'knowledge_sync',
    asset:{ sha256:'c'.repeat(64), title:'Fuente sintética', kind:'pdf', bytes:1200, section_count:1 },
    sections:[{ index:0, id:'p1-1', label:'Página 1', text:'Contenido sintético.' }]
  };
  const vector = Buffer.alloc(768, 7).toString('base64');
  assert.equal(gemini.validateKnowledgeSync({ ...base, sections:[{ ...base.sections[0], embedding_base64:vector }] }, owner), null);
  const accepted = gemini.validateKnowledgeSync({ ...base, sections:[{ ...base.sections[0], embedding_base64:vector, embedding_version:'quantized-768-v1' }] }, owner);
  assert.equal(accepted.sections[0].embedding_base64.length, 1024);
  assert.equal(accepted.sections[0].embedding_version, 'quantized-768-v1');
});
