(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.YarbiMultimodalTutor = api;
    root.gfcYarbiMultimodalHtml = api.html;
    root.gfcYarbiMultimodalAttach = api.attach;
    root.gfcYarbiMultimodalImport = () => api.importFromUi(true);
    root.gfcYarbiMultimodalSaveOnly = () => api.importFromUi(false);
    root.gfcYarbiMultimodalAnalyze = api.analyzeFromUi;
    root.gfcYarbiMultimodalApprove = api.approveFromUi;
    root.gfcYarbiMultimodalFilesChosen = api.filesChosen;
    root.gfcYarbiTutorAsk = api.askTutorFromUi;
    root.gfcYarbiMultimodalAnswer = api.answerFromChat;
  }
}(typeof window === 'undefined' ? globalThis : window, function (root) {
  'use strict';

  const DB_NAME = 'yarbi_bke_multimodal_v1';
  const STORE = 'assets';
  const MAX_ASSETS = 80;
  const MAX_TEXT = 200000;
  const MAX_INLINE_BYTES = 3 * 1024 * 1024;
  const MAX_FILE_BYTES = 40 * 1024 * 1024;
  let dbPromise = null;
  let progressTimer = null;

  function clean(value, limit = 240) {
    return String(value == null ? '' : value).replace(/\u0000/g, '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
  }
  function normalize(value) {
    return clean(value, 10000).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-PE').replace(/[^a-z0-9ñ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function escapeHtml(value) {
    return clean(value, 10000).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  }
  function classifyFile(file) {
    const name = String(file?.name || '').toLowerCase();
    const type = String(file?.type || '').toLowerCase();
    if (/\.(txt|md|markdown|csv|json|xml)$/i.test(name) || ['text/plain','text/markdown','text/csv','application/json','application/xml'].includes(type)) return 'text';
    if (/\.pdf$/i.test(name) || type === 'application/pdf') return 'pdf';
    if (/\.(jpg|jpeg|png|webp|heic)$/i.test(name) || type.startsWith('image/')) return 'image';
    if (/\.(mp3|m4a|wav|ogg|aac|webm)$/i.test(name) || type.startsWith('audio/')) return 'audio';
    if (/\.(mp4|mov|webm|mkv)$/i.test(name) || type.startsWith('video/')) return 'video';
    return 'unsupported';
  }
  function titleFor(file) { return clean(file?.name || 'Fuente sin nombre', 140) || 'Fuente sin nombre'; }
  function kindLabel(kind) { return ({ text:'Texto', pdf:'PDF', image:'Imagen', audio:'Audio', video:'Video' }[kind] || 'Archivo'); }
  function statusLabel(status) { return ({ local_ready:'Listo localmente', pending_analysis:'Pendiente de análisis', analyzed_draft:'Borrador analizado', approved:'Aprobado para tutoría', blocked:'Requiere extractor' }[status] || 'Pendiente'); }
  function tokens(value) { return [...new Set(normalize(value).split(' ').filter(token => token.length > 1))]; }
  const KNOWLEDGE_STOP_WORDS = new Set(['que','qué','como','cómo','cual','cuál','cuales','cuáles','donde','dónde','cuando','cuándo','quien','quién','para','por','con','sin','sobre','entre','desde','hasta','una','uno','unos','unas','del','las','los','esta','este','esto','esa','ese','eso','sus','segun','según','dice','dime','explica','explicame','yarbi','yarbis','archivo','documento','pdf','norma']);
  function contentTokens(value) {
    return tokens(value).filter(token => token.length > 2 && !KNOWLEDGE_STOP_WORDS.has(token));
  }
  function knowledgeIntent(value) {
    return /\b(?:norma|ntp|iso|manual|pdf|documento|archivo|fuente|biblioteca|cap[ií]tulo|numeral|art[ií]culo|anexo|tabla|procedimiento|reglamento|ficha\s+t[eé]cnica)\b/i.test(String(value || ''));
  }
  function referenceLabel(value, fallback) {
    const candidate = clean(value, 240);
    return /^(?:cap[ií]tulo|secci[oó]n|numeral|art[ií]culo|anexo|ntp|iso|tabla|figura)\b/i.test(candidate) ? candidate : fallback;
  }
  function sectionsFromText(value) {
    const text = String(value == null ? '' : value).replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim().slice(0, MAX_TEXT);
    const chunks = text.split(/\n\s*\n+/).map(item => ({ raw:item, text:item.replace(/\s+/g, ' ').trim() })).filter(item => item.text);
    const sections = [];
    let activeReference = '';
    chunks.forEach(chunkValue => {
      const detected = referenceLabel(String(chunkValue.raw).split(/[:\n]/)[0] || '', '');
      if (detected) activeReference = detected;
      for (let offset = 0; offset < chunkValue.text.length && sections.length < 160; offset += 1300) {
        const text = chunkValue.text.slice(offset, offset + 1300).trim();
        if (text) sections.push({ id:'m' + (sections.length + 1), label:activeReference || ('Fragmento ' + (sections.length + 1)), text });
      }
    });
    return sections.filter(item => item.text);
  }
  function searchApproved(assets, query) {
    const terms = contentTokens(query);
    return (Array.isArray(assets) ? assets : []).filter(asset => asset.status === 'approved').flatMap(asset => {
      const sections = Array.isArray(asset.sections) ? asset.sections : [];
      return sections.map(section => {
        const haystack = normalize([asset.title, section.label, section.text, asset.analysis?.summary].join(' '));
        const hits = terms.filter(term => haystack.includes(term));
        return hits.length ? { assetId:asset.id, title:asset.title, kind:asset.kind, sourceHash:asset.sha256 || '', sectionId:section.id || '', sectionLabel:clean(section.label || 'Fragmento sin referencia', 240), excerpt:section.text.slice(0, 800), hits, score:hits.length } : null;
      }).filter(Boolean);
    }).sort((a,b) => b.score - a.score || a.title.localeCompare(b.title, 'es-PE')).slice(0, 8);
  }
  function firstApprovedEvidence(assets) {
    const approved = (Array.isArray(assets) ? assets : []).filter(asset => asset.status === 'approved' && Array.isArray(asset.sections) && asset.sections.length);
    if (approved.length !== 1) return [];
    return approved[0].sections.slice(0, 4).map(section => ({
      assetId:approved[0].id,
      title:approved[0].title,
      kind:approved[0].kind,
      sourceHash:approved[0].sha256 || '',
      sectionId:section.id || '',
      sectionLabel:clean(section.label || 'Fragmento sin referencia', 240),
      excerpt:String(section.text || '').slice(0, 800),
      hits:[],
      score:0
    })).filter(row => row.excerpt);
  }
  function responseText(data) {
    const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
    return candidates.flatMap(candidate => Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []).map(part => String(part?.text || '')).filter(Boolean).join('\n').trim();
  }
  function parseStructuredAnalysis(value) {
    const raw = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    let parsed;
    try { parsed = JSON.parse(raw); } catch (_) { return { summary:String(value || '').trim(), citations:[] }; }
    const citations = (Array.isArray(parsed?.citations) ? parsed.citations : []).map((item, index) => {
      const quote = clean(item?.quote, 1200);
      const reference = clean(item?.reference, 240);
      if (!quote) return null;
      return { id:'c' + (index + 1), label:referenceLabel(reference, 'Fragmento extraído ' + (index + 1)), text:quote };
    }).filter(Boolean).slice(0, 80);
    return { summary:clean(parsed?.summary || '', 12000), citations };
  }
  function citationMarkdown(evidence) {
    return (Array.isArray(evidence) ? evidence : []).slice(0, 4).map(row =>
      '### ' + clean(row.title, 140) + '\n\n**Referencia:** ' + clean(row.sectionLabel || 'Fragmento sin referencia', 240) + '\n\n> ' + clean(row.excerpt, 800) + '\n\n_Fuente aprobada · SHA-256 ' + clean(String(row.sourceHash || '').slice(0, 12)) + '…_'
    ).join('\n\n');
  }
  function localUnavailableReply() {
    return 'No puedo analizar esa fuente sin el servicio de comprensión configurado. La dejé guardada localmente como pendiente; no inventé su contenido ni la marqué como aprendida.';
  }
  function openDb() {
    if (dbPromise) return dbPromise;
    if (!root?.indexedDB) return Promise.reject(new Error('multimodal_storage_unavailable'));
    dbPromise = new Promise((resolve, reject) => {
      const request = root.indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath:'id' }); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('multimodal_storage_unavailable'));
    });
    return dbPromise;
  }
  function requestValue(request) { return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error || new Error('multimodal_storage_failed')); }); }
  async function transaction(mode, callback) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode); const store = tx.objectStore(STORE); let value;
      Promise.resolve(callback(store)).then(result => { value = result; }).catch(error => { try { tx.abort(); } catch (_) {} reject(error); });
      tx.oncomplete = () => resolve(value); tx.onerror = () => reject(tx.error || new Error('multimodal_storage_failed')); tx.onabort = () => reject(tx.error || new Error('multimodal_storage_aborted'));
    });
  }
  async function list() { const rows = await transaction('readonly', store => requestValue(store.getAll())); return (Array.isArray(rows) ? rows : []).sort((a,b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)); }
  async function get(id) { return transaction('readonly', store => requestValue(store.get(String(id || '')))); }
  async function put(asset) { return transaction('readwrite', store => { store.put(asset); return asset; }); }
  async function digest(value) {
    if (!root?.crypto?.subtle || typeof root.TextEncoder === 'undefined') return null;
    const bytes = value instanceof ArrayBuffer ? value : new root.TextEncoder().encode(String(value));
    const hash = await root.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => { const reader = new root.FileReader(); reader.onload = () => resolve(String(reader.result || '')); reader.onerror = () => reject(reader.error || new Error('file_read_failed')); reader.readAsDataURL(file); });
  }
  function readAsArrayBuffer(file, onProgress) {
    if (!root?.FileReader) return file.arrayBuffer();
    return new Promise((resolve, reject) => {
      const reader = new root.FileReader();
      reader.onprogress = event => {
        if (!event.lengthComputable || typeof onProgress !== 'function') return;
        onProgress(Math.max(0, Math.min(1, event.loaded / Math.max(1, event.total))));
      };
      reader.onload = () => { if (typeof onProgress === 'function') onProgress(1); resolve(reader.result); };
      reader.onerror = () => reject(reader.error || new Error('file_read_failed'));
      reader.readAsArrayBuffer(file);
    });
  }
  async function buildAsset(file, onProgress) {
    const kind = classifyFile(file);
    if (kind === 'unsupported') throw new Error('unsupported_multimodal_type');
    if (Number(file?.size || 0) > MAX_FILE_BYTES) throw new Error('multimodal_file_too_large');
    const buffer = await readAsArrayBuffer(file, onProgress);
    const sha256 = await digest(buffer);
    let sections = []; let dataUrl = '';
    if (kind === 'text') sections = sectionsFromText(new TextDecoder().decode(buffer));
    if (kind !== 'text' && Number(file.size || 0) <= MAX_INLINE_BYTES) dataUrl = await readAsDataUrl(file);
    return { id:'bke_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8), title:titleFor(file), kind, mime:String(file.type || 'application/octet-stream').slice(0, 120), bytes:Number(file.size || 0), sha256, sections, dataUrl, analysis:null, status:kind === 'text' ? 'local_ready' : (dataUrl ? 'pending_analysis' : 'blocked'), createdAt:Date.now(), updatedAt:Date.now() };
  }
  async function importFiles(files, onProgress) {
    const incoming = [...(files || [])]; const existing = await list();
    if (existing.length + incoming.length > MAX_ASSETS) throw new Error('multimodal_asset_limit');
    const created = [];
    for (let index = 0; index < incoming.length; index += 1) {
      const file = incoming[index];
      const asset = await buildAsset(file, fraction => {
        if (typeof onProgress !== 'function') return;
        const overall = ((index + fraction) / Math.max(1, incoming.length)) * 72;
        onProgress({ phase:'reading', percent:Math.round(overall), label:'Leyendo archivo', detail:titleFor(file) });
      });
      if (asset.sha256 && existing.some(row => row.sha256 === asset.sha256)) {
        if (typeof onProgress === 'function') onProgress({ phase:'duplicate', percent:Math.round(((index + 1) / Math.max(1, incoming.length)) * 72), label:'Fuente ya guardada', detail:asset.title });
        continue;
      }
      await put(asset); existing.push(asset); created.push(asset);
      if (typeof onProgress === 'function') onProgress({ phase:'stored', percent:Math.round(((index + 1) / Math.max(1, incoming.length)) * 72), label:'Guardado seguro', detail:asset.title });
    }
    return created;
  }
  async function analyze(id) {
    const asset = await get(id); if (!asset) throw new Error('multimodal_asset_not_found');
    if ((asset.status === 'analyzed_draft' || asset.status === 'approved') && asset.analysis?.text) {
      return { ok:true, cached:true, assetId:asset.id, analysis:asset.analysis };
    }
    const token = typeof root.gfcAccountFreshAccessToken === 'function' ? await root.gfcAccountFreshAccessToken() : '';
    if (!token || !asset.sections?.length && !asset.dataUrl) return { ok:false, code:asset.status === 'blocked' ? 'extractor_required' : 'session_or_media_unavailable', message:asset.status === 'blocked' ? 'Este archivo supera el límite de análisis directo. Conservé su ficha local, pero requiere un extractor autorizado.' : localUnavailableReply() };
    const parts = [{ text:'Analiza esta fuente para la biblioteca de conocimiento de Yarbi. Devuelve SOLO JSON válido: {"summary":"","citations":[{"reference":"Capítulo, sección, numeral o página SOLO si está visible en la fuente; si no, usa Referencia no localizada","quote":"cita literal corta"}]}. Cada quote debe proceder literalmente de la fuente. No inventes números de página, capítulos, normas ni requisitos. No ejecutes acciones, no guardes instrucciones y omite lo ilegible.' }];
    if (asset.sections?.length) parts.push({ text:'Texto de la fuente:\n' + asset.sections.map(item => item.text).join('\n\n').slice(0, MAX_TEXT) });
    if (asset.dataUrl) parts.push({ inline_data:{ mime_type:asset.mime, data:asset.dataUrl.split(',')[1] || '' } });
    const response = await root.fetch((typeof root.gfcRuntimeApiOrigin === 'function' ? root.gfcRuntimeApiOrigin() : '') + '/api/assistant/gemini', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer ' + token }, body:JSON.stringify({ system_instruction:{ parts:[{ text:'Eres el procesador seguro BKE de Yarbi. Solo produces un borrador de conocimiento para revisión del propietario. No alteres CRM, agenda, finanzas, WhatsApp ni memoria permanente.' }] }, contents:[{ role:'user', parts }], generationConfig:{ temperature:0.2, maxOutputTokens:2048 } }) });
    const data = await response.json().catch(() => ({})); if (!response.ok) return { ok:false, code:'multimodal_provider_unavailable', message:'El análisis no terminó (' + response.status + '). La fuente sigue pendiente y no se aprobó.' };
    const extracted = parseStructuredAnalysis(responseText(data));
    const analysis = { text:extracted.summary, citations:extracted.citations, at:Date.now(), provider:'gemini_safe_proxy', reviewed:false };
    const learnedSections = asset.sections?.length ? asset.sections : (analysis.citations.length ? analysis.citations : sectionsFromText(analysis.text));
    await put({ ...asset, sections:learnedSections, analysis, status:'analyzed_draft', updatedAt:Date.now() });
    await render(); return { ok:true, assetId:asset.id, analysis };
  }
  async function approve(id) { const asset = await get(id); if (!asset || !asset.analysis?.text) throw new Error('multimodal_analysis_required'); await put({ ...asset, status:'approved', updatedAt:Date.now(), analysis:{ ...asset.analysis, reviewed:true, approvedAt:Date.now() } }); await render(); return true; }
  async function askTutor(question, prepared) {
    const text = clean(question, 1200); if (!text) throw new Error('tutor_question_required');
    const assets = Array.isArray(prepared?.assets) ? prepared.assets : await list();
    const evidence = Array.isArray(prepared?.evidence) ? prepared.evidence : searchApproved(assets, text);
    const citations = citationMarkdown(evidence); const context = evidence.map(row => '[' + row.title + ' · ' + row.sectionLabel + '] ' + row.excerpt).join('\n');
    const token = typeof root.gfcAccountFreshAccessToken === 'function' ? await root.gfcAccountFreshAccessToken() : '';
    if (!token) return { ok:false, message:'Inicia sesión para usar el tutor. Tus fuentes aprobadas siguen guardadas localmente.' };
    if (!evidence.length) return { ok:false, message:'No encontré una cita aprobada que respalde esta respuesta. No inventaré una referencia técnica; carga y aprueba la norma primero.' };
    const response = await root.fetch((typeof root.gfcRuntimeApiOrigin === 'function' ? root.gfcRuntimeApiOrigin() : '') + '/api/assistant/gemini', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer ' + token }, body:JSON.stringify({ system_instruction:{ parts:[{ text:'Eres el Tutor personal de Yarbi. Explica exclusivamente con la evidencia aprobada proporcionada. Usa títulos, pasos y checks. Separa: 1) qué dice textualmente la fuente, 2) qué significa en palabras sencillas, 3) límites o datos faltantes. No cites capítulo, numeral, página ni norma que no figure exactamente en la evidencia. Nunca ejecutes acciones ni guardes aprendizajes automáticamente.' }] }, contents:[{ role:'user', parts:[{ text:'Pregunta del propietario:\n' + text + '\n\nEvidencia aprobada disponible:\n' + context }] }], generationConfig:{ temperature:0.35, maxOutputTokens:2048 } }) });
    const data = await response.json().catch(() => ({})); if (!response.ok) return { ok:false, message:'El tutor no está disponible ahora. No inventé una explicación.' };
    return { ok:true, text:responseText(data) + '\n\n---\n\n## Referencias verificadas\n\n' + citations, evidence:evidence.map(row => ({ title:row.title, assetId:row.assetId, sectionLabel:row.sectionLabel })) };
  }
  async function answerFromChat(question) {
    const text = clean(question, 1200);
    if (!text) return { handled:false };
    let assets;
    try { assets = await list(); }
    catch (_) { return knowledgeIntent(text) ? { handled:true, reply:'## 📚 Biblioteca no disponible\n\nNo pude abrir ahora las fuentes guardadas en este dispositivo. No inventaré una respuesta ni consultaré otro entorno.' } : { handled:false }; }
    const explicit = knowledgeIntent(text);
    let evidence = searchApproved(assets, text);
    const terms = contentTokens(text);
    const minimumHits = terms.length > 1 ? 2 : 1;
    const strongMatch = evidence.some(row => Number(row.score || 0) >= minimumHits);
    if (!evidence.length && explicit && terms.length === 0) evidence = firstApprovedEvidence(assets);
    if (!explicit && !strongMatch) return { handled:false };
    if (!evidence.length) {
      const approved = assets.filter(asset => asset.status === 'approved');
      if (explicit && approved.length > 1) {
        const names = approved.slice(0, 4).map(asset => '**' + clean(asset.title, 100) + '**').join(', ');
        return { handled:true, reply:'## 📚 Necesito una pista sobre la fuente\n\nTienes varias fuentes aprobadas: ' + names + '. Indícame el nombre de la norma, el tema o el numeral para citar la correcta sin mezclar documentos.' };
      }
      const drafts = assets.filter(asset => asset.status === 'analyzed_draft');
      if (drafts.length) {
        const names = drafts.slice(0, 3).map(asset => '**' + clean(asset.title, 100) + '**').join(', ');
        return { handled:true, reply:'## ⏳ Fuente procesada, aprobación pendiente\n\nEncontré ' + names + ', pero todavía está como **borrador**. Para que Yarbi la use en el chat: **⋮ → Conocimiento y Tutor → Aprobar para tutoría**.\n\nNo usaré su contenido como conocimiento definitivo hasta que lo revises.' };
      }
      return { handled:true, reply:'## 📚 No encontré evidencia aprobada\n\nNo hay una fuente aprobada que respalde esta consulta. Entra a **⋮ → Conocimiento y Tutor**, procesa el documento y pulsa **Aprobar para tutoría**. No inventaré una norma, capítulo ni numeral.' };
    }
    const result = await askTutor(text, { assets, evidence });
    if (result.ok) return { handled:true, reply:result.text, evidence:result.evidence };
    return {
      handled:true,
      reply:'## 📚 Evidencia local encontrada\n\nYarbi encontró la fuente aprobada, pero no pudo generar ahora la explicación completa. Estas son las referencias verificadas; no se inventó contenido:\n\n' + citationMarkdown(evidence),
      evidence:evidence.map(row => ({ title:row.title, assetId:row.assetId, sectionLabel:row.sectionLabel })),
      degraded:true
    };
  }
  function statusText(error) { return ({ unsupported_multimodal_type:'Formato no compatible.', multimodal_file_too_large:'El archivo supera el límite local de 40 MB.', multimodal_asset_limit:'La biblioteca local alcanzó 80 fuentes.', multimodal_storage_unavailable:'El almacenamiento local no está disponible.', extractor_required:'Este archivo necesita un extractor autorizado.' }[error?.message] || error?.message || 'No pude procesar la fuente.'); }
  function progressTone(phase) {
    if (phase === 'error') return 'error';
    if (phase === 'complete' || phase === 'approved') return 'success';
    if (phase === 'pending_review') return 'review';
    return 'working';
  }
  function setProgress(percent, label, detail, phase) {
    const safePercent = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    const shell = root?.document?.getElementById('gfc-mm-progress');
    const chip = root?.document?.getElementById('gfc-mm-progress-chip');
    const value = root?.document?.getElementById('gfc-mm-progress-percent');
    const bar = root?.document?.getElementById('gfc-mm-progress-bar');
    const copy = root?.document?.getElementById('gfc-mm-progress-detail');
    if (shell) { shell.hidden = false; shell.dataset.tone = progressTone(phase); }
    if (chip) chip.textContent = label || 'Procesando archivo';
    if (value) value.textContent = safePercent + '%';
    if (bar) bar.style.width = safePercent + '%';
    if (copy) copy.textContent = detail || '';
  }
  function clearProgressTimer() {
    if (progressTimer && root?.clearInterval) root.clearInterval(progressTimer);
    progressTimer = null;
  }
  function startEstimatedAnalysis(title, startPercent) {
    clearProgressTimer();
    let percent = Math.max(18, Number(startPercent) || 24);
    setProgress(percent, 'Procesando archivo', 'Yarbi está leyendo y organizando “' + clean(title, 80) + '”. Avance estimado.', 'working');
    if (!root?.setInterval) return;
    progressTimer = root.setInterval(() => {
      percent = Math.min(88, percent + (percent < 55 ? 5 : percent < 76 ? 3 : 1));
      setProgress(percent, percent < 58 ? 'Extrayendo contenido' : percent < 80 ? 'Organizando conocimiento' : 'Preparando borrador', 'El porcentaje del análisis remoto es estimado; 100% solo se muestra después de guardar el resultado.', 'working');
    }, 650);
  }
  function filesChosen(files) {
    const rows = [...(files || [])];
    const selected = root?.document?.getElementById('gfc-mm-selected');
    if (selected) selected.textContent = rows.length ? (rows.length === 1 ? rows[0].name : rows.length + ' archivos seleccionados') : 'Ningún archivo seleccionado';
    if (rows.length) setProgress(0, 'Listo para procesar', rows.length === 1 ? rows[0].name : rows.length + ' fuentes seleccionadas', 'working');
    return rows.length;
  }
  function card(asset) {
    const analysis = asset.analysis?.text ? '<details><summary>Ver borrador</summary><p>' + escapeHtml(asset.analysis.text) + '</p>' + ((asset.analysis?.citations || []).length ? '<p><b>' + asset.analysis.citations.length + ' cita(s) extraída(s) para revisión.</b></p>' : '') + '</details>' : '';
    const action = asset.status === 'analyzed_draft' ? '<button class="gfc-yarbi-primary" onclick="gfcYarbiMultimodalApprove(\'' + escapeHtml(asset.id) + '\')">Aprobar para tutoría</button>' : asset.status === 'approved' ? '<span class="gfc-mm-approved">✓ Aprobado</span>' : '<button class="gfc-yarbi-secondary" onclick="gfcYarbiMultimodalAnalyze(\'' + escapeHtml(asset.id) + '\')">Analizar con Yarbi</button>';
    return '<article class="gfc-mm-card"><div class="gfc-mm-card-head"><span class="gfc-mm-kind">' + ({ text:'📝', pdf:'📕', image:'🖼️', audio:'🎙️', video:'🎬' }[asset.kind] || '📎') + '</span><div><b>' + escapeHtml(asset.title) + '</b><small>' + kindLabel(asset.kind) + ' · ' + statusLabel(asset.status) + ' · ' + Math.max(1, Math.round(Number(asset.bytes || 0) / 1024)) + ' KB</small></div></div><p>Huella: ' + escapeHtml(String(asset.sha256 || '').slice(0, 16)) + '…</p>' + analysis + '<div class="gfc-mm-actions">' + action + '</div></article>';
  }
  async function render() { const target = root?.document?.getElementById('gfc-mm-list'); if (!target) return; try { const rows = await list(); target.innerHTML = rows.length ? rows.map(card).join('') : '<p>Aún no hay fuentes multimodales. Puedes cargar documentos, imágenes, audios o videos.</p>'; } catch (_) { target.innerHTML = '<p>No se pudo abrir la biblioteca local.</p>'; } }
  function setStatus(message, error) { const target = root?.document?.getElementById('gfc-mm-status'); if (target) { target.textContent = message; target.dataset.tone = error ? 'error' : 'normal'; } }
  async function importFromUi(autoAnalyze = true) {
    const input = root?.document?.getElementById('gfc-mm-input');
    const selectedFiles = [...(input?.files || [])];
    if (!selectedFiles.length) { setStatus('Primero elige uno o más archivos desde el explorador del teléfono.', true); return []; }
    try {
      setProgress(1, 'Preparando archivos', selectedFiles.length === 1 ? selectedFiles[0].name : selectedFiles.length + ' fuentes', 'working');
      const rows = await importFiles(selectedFiles, state => setProgress(state.percent, state.label, state.detail, state.phase));
      await render();
      if (!rows.length) {
        setProgress(100, 'Sin duplicar', 'La fuente ya estaba guardada en tu biblioteca.', 'complete');
        setStatus('No se creó una copia: Yarbi reconoció la misma huella SHA-256.', false);
      } else if (!autoAnalyze) {
        setProgress(100, 'Guardado local completado', rows.length + ' fuente(s) pendientes de análisis.', 'complete');
        setStatus('La fuente quedó en el celular. Podrás procesarla después con “Analizar con Yarbi”.', false);
      } else {
        let analyzed = 0; let pending = 0;
        for (let index = 0; index < rows.length; index += 1) {
          const asset = rows[index];
          if (asset.status === 'blocked') { pending += 1; continue; }
          startEstimatedAnalysis(asset.title, 24 + Math.round(index / Math.max(1, rows.length) * 24));
          const result = await analyze(asset.id);
          clearProgressTimer();
          if (result.ok) analyzed += 1; else pending += 1;
        }
        await render();
        if (pending) {
          setProgress(100, 'Procesamiento parcial', analyzed + ' analizada(s) · ' + pending + ' pendiente(s)', 'pending_review');
          setStatus('Las fuentes disponibles quedaron guardadas. Las pendientes muestran su causa y no se marcaron como aprendidas.', false);
        } else {
          setProgress(100, 'Borrador listo para revisar', analyzed + ' fuente(s) procesada(s) una sola vez y guardada(s) localmente.', 'pending_review');
          setStatus('Revisa las citas y pulsa “Aprobar para tutoría”. Yarbi todavía no las usa como conocimiento definitivo.', false);
        }
      }
      if (input) input.value = '';
      filesChosen([]);
      return rows;
    } catch (error) {
      clearProgressTimer();
      setProgress(0, 'No se pudo completar', statusText(error), 'error');
      setStatus(statusText(error), true);
      return [];
    }
  }
  async function analyzeFromUi(id) {
    const asset = await get(id).catch(() => null);
    startEstimatedAnalysis(asset?.title || 'fuente', 20);
    setStatus('Procesando una sola vez. Puedes seguir viendo el avance arriba.', false);
    try {
      const result = await analyze(id); clearProgressTimer();
      if (result.ok) setProgress(100, result.cached ? 'Análisis recuperado' : 'Borrador listo', result.cached ? 'No fue necesario procesar la fuente otra vez.' : 'Revisa las citas antes de aprobar.', 'pending_review');
      else setProgress(0, 'Análisis pendiente', result.message || 'La fuente no se aprobó.', 'error');
      setStatus(result.ok ? 'Borrador listo. Revísalo antes de aprobarlo.' : (result.message || 'No se aprobó la fuente.'), !result.ok);
      await render(); return result;
    } catch (error) { clearProgressTimer(); setProgress(0, 'Análisis interrumpido', statusText(error), 'error'); setStatus(statusText(error), true); return { ok:false, message:statusText(error) }; }
  }
  async function approveFromUi(id) { try { setProgress(92, 'Guardando aprobación', 'Vinculando la revisión a esta fuente.', 'working'); await approve(id); setProgress(100, 'Fuente aprobada', 'Disponible para respuestas del tutor con citas verificables.', 'approved'); setStatus('Fuente aprobada para tutoría. No modifica CRM ni instrucciones permanentes.'); } catch (error) { setProgress(0, 'No se aprobó', statusText(error), 'error'); setStatus(statusText(error), true); } }
  async function askTutorFromUi() { const input = root.document.getElementById('gfc-mm-tutor-question'); const out = root.document.getElementById('gfc-mm-tutor-answer'); if (!out) return; out.textContent = 'El tutor está preparando una explicación…'; try { const result = await askTutor(input?.value || ''); out.textContent = result.ok ? result.text : (result.message || 'No pude responder sin inventar información.'); } catch (error) { out.textContent = statusText(error); } }
  function html() { return '<main class="gfc-yarbi-tool-page gfc-mm-page"><section class="gfc-mm-hero"><span>📚</span><div><h2>Conocimiento y Tutor</h2><p>Selecciona una fuente, observa su procesamiento y decide cuándo puede usarla Yarbi.</p></div></section><section class="gfc-yarbi-tool-card"><div class="gfc-mm-steps"><span><b>1</b> Elegir</span><span><b>2</b> Procesar</span><span><b>3</b> Revisar</span><span><b>4</b> Aprobar</span></div><label class="gfc-mm-picker" for="gfc-mm-input"><span class="gfc-mm-picker-icon">⌕</span><div><b>Buscar archivos en el teléfono</b><small>Abre el explorador de Android: Recientes, Descargas, almacenamiento y proveedores como Drive.</small><em id="gfc-mm-selected">Ningún archivo seleccionado</em></div><input id="gfc-mm-input" type="file" multiple onchange="gfcYarbiMultimodalFilesChosen(this.files)" accept=".txt,.md,.csv,.json,.xml,.pdf,.jpg,.jpeg,.png,.webp,.heic,.mp3,.m4a,.wav,.ogg,.aac,.mp4,.mov,.webm,text/plain,application/pdf,image/*,audio/*,video/*"></label><div class="gfc-mm-primary-actions"><button class="gfc-yarbi-primary" onclick="gfcYarbiMultimodalImport()">Agregar y procesar</button><button class="gfc-yarbi-secondary" onclick="gfcYarbiMultimodalSaveOnly()">Solo guardar</button></div><section id="gfc-mm-progress" class="gfc-mm-progress-card" data-tone="working" hidden aria-live="polite"><div class="gfc-mm-progress-head"><span id="gfc-mm-progress-chip" class="gfc-mm-progress-chip">Procesando archivo</span><strong id="gfc-mm-progress-percent">0%</strong></div><div class="gfc-mm-progress-track"><i id="gfc-mm-progress-bar"></i></div><p id="gfc-mm-progress-detail">Preparando…</p></section><div id="gfc-mm-status" class="gfc-yarbi-import-summary">Tus fuentes aprobadas quedan indexadas localmente para responder rápido. La aprobación es obligatoria antes de usarlas como conocimiento. No se ejecutan acciones comerciales durante este proceso.</div></section><section class="gfc-yarbi-tool-card"><div class="gfc-yarbi-tool-title">Fuentes de esta biblioteca</div><div id="gfc-mm-list"></div></section><section class="gfc-yarbi-tool-card"><div class="gfc-yarbi-tool-title">🎓 Preguntar al Tutor</div><div class="gfc-yarbi-tool-copy">Yarbi responde con la cita disponible, la referencia visible y una explicación sencilla. Si falta evidencia, se abstiene.</div><textarea id="gfc-mm-tutor-question" rows="4" placeholder="Ejemplo: ¿Qué exige esta norma y qué significa en palabras sencillas?"></textarea><button class="gfc-yarbi-primary" onclick="gfcYarbiTutorAsk()">Preguntar al tutor</button><article id="gfc-mm-tutor-answer" class="gfc-mm-tutor-answer">Aquí aparecerá una explicación respaldada por tus fuentes aprobadas.</article></section></main>'; }
  function attach() { void render(); }
  return Object.freeze({ classifyFile, normalize, contentTokens, knowledgeIntent, sectionsFromText, searchApproved, firstApprovedEvidence, responseText, parseStructuredAnalysis, citationMarkdown, buildAsset, importFiles, list, analyze, approve, askTutor, answerFromChat, html, attach, render, analyzeFromUi, approveFromUi, importFromUi, askTutorFromUi, filesChosen, setProgress, MAX_INLINE_BYTES });
}));
