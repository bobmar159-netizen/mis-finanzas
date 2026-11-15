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
    root.gfcYarbiMultimodalToggleLearning = api.toggleLearningFromUi;
    root.gfcYarbiMultimodalDelete = api.deleteFromUi;
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
  const MAX_PDF_FILE_BYTES = 120 * 1024 * 1024;
  const MAX_PDF_PAGES = 2500;
  const MAX_PDF_INDEX_CHARS = 12 * 1024 * 1024;
  const MAX_PDF_SECTIONS = 8000;
  let dbPromise = null;
  let progressTimer = null;
  let pdfJsPromise = null;

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
  function searchApproved(assets, query, options) {
    const terms = contentTokens(query);
    const limit = Math.max(1, Math.min(80, Number(options?.limit) || 36));
    return (Array.isArray(assets) ? assets : []).filter(asset => asset.status === 'approved' && asset.learningEnabled !== false).flatMap(asset => {
      const sections = Array.isArray(asset.sections) ? asset.sections : [];
      return sections.map(section => {
        const haystack = normalize([asset.title, section.label, section.text, asset.analysis?.summary].join(' '));
        const hits = terms.filter(term => haystack.includes(term));
        return hits.length ? { assetId:asset.id, title:asset.title, kind:asset.kind, sourceHash:asset.sha256 || '', sectionId:section.id || '', sectionLabel:clean(section.label || 'Fragmento sin referencia', 240), excerpt:section.text.slice(0, 800), hits, score:hits.length } : null;
      }).filter(Boolean);
    }).sort((a,b) => b.score - a.score || a.title.localeCompare(b.title, 'es-PE')).slice(0, limit);
  }
  function firstApprovedEvidence(assets) {
    const approved = (Array.isArray(assets) ? assets : []).filter(asset => asset.status === 'approved' && asset.learningEnabled !== false && Array.isArray(asset.sections) && asset.sections.length);
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
  function parseDirectedAnswer(value) {
    const raw = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    let parsed;
    try { parsed = JSON.parse(raw); } catch (_) { return { ok:false, found:false }; }
    const answer = clean(parsed?.answer, 900);
    const quote = clean(parsed?.exact_quote, 900);
    const reference = clean(parsed?.reference, 240);
    const plain = clean(parsed?.plain_explanation, 900);
    const caveat = clean(parsed?.caveat, 400);
    const found = parsed?.found === true && !!quote && !!reference;
    return { ok:true, found, answer, quote, reference, plain, caveat };
  }
  function brief(value, maximumWords) {
    const words = clean(value, 1800).split(/\s+/).filter(Boolean);
    return words.length <= maximumWords ? words.join(' ') : words.slice(0, maximumWords).join(' ') + '…';
  }
  function formatDirectedAnswer(result, asset) {
    const title = clean(asset?.title || 'Fuente aprobada', 140);
    if (!result?.found) {
      return '## 🔎 Respuesta breve\n\nNo encontré en **' + title + '** una cita literal que responda esa pregunta.\n\n' + (result?.caveat ? '> [Qué falta verificar]\n> ' + result.caveat + '\n\n' : '') + 'No afirmaré que está permitido o prohibido sin evidencia.';
    }
    return '## ✅ Respuesta breve\n\n' + (result.answer ? '**' + brief(result.answer, 45) + '**\n\n' : '')
      + '> [📖 ' + result.reference + ']\n> “' + brief(result.quote, 70) + '”\n\n'
      + (result.plain ? '**En sencillo:** ' + brief(result.plain, 55) + '\n\n' : '')
      + (result.caveat ? '⚠️ **Importante:** ' + brief(result.caveat, 40) + '\n\n' : '')
      + '_Fuente aprobada: ' + title + ' · SHA-256 ' + clean(String(asset?.sha256 || '').slice(0, 12)) + '…_';
  }
  function citationMarkdown(evidence) {
    return (Array.isArray(evidence) ? evidence : []).slice(0, 3).map(row =>
      '> [📖 ' + clean(row.sectionLabel || 'Fragmento sin referencia', 240) + ']\n> ' + clean(row.excerpt, 520) + '\n\n_Fuente aprobada: ' + clean(row.title, 140) + ' · SHA-256 ' + clean(String(row.sourceHash || '').slice(0, 12)) + '…_'
    ).join('\n\n');
  }
  function citationListMarkdown(evidence) {
    const seen = new Set();
    return (Array.isArray(evidence) ? evidence : []).filter(row => {
      const key = String(row.assetId || '') + '|' + String(row.sectionLabel || '');
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).slice(0, 3).map(row => '- **' + clean(row.title, 140) + '** — ' + clean(row.sectionLabel || 'Referencia no localizada', 240)).join('\n');
  }
  function quoteSupportedByEvidence(result, evidence) {
    const quote = normalize(result?.quote || '');
    return Boolean(quote) && (Array.isArray(evidence) ? evidence : []).some(row => normalize(row?.excerpt || '').includes(quote));
  }
  function quoteSupportedByAsset(result, asset) {
    const quote = normalize(result?.quote || '');
    return Boolean(quote) && (Array.isArray(asset?.sections) ? asset.sections : []).some(section => normalize(section?.text || '').includes(quote));
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
  async function removeAsset(id) { return transaction('readwrite', store => { store.delete(String(id || '')); return true; }); }
  async function digest(value) {
    if (!root?.crypto?.subtle || typeof root.TextEncoder === 'undefined') return null;
    const bytes = value instanceof ArrayBuffer ? value : new root.TextEncoder().encode(String(value));
    const hash = await root.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  async function readAsDataUrl(file) {
    if (!root?.FileReader) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      return 'data:' + (file.type || 'application/octet-stream') + ';base64,' + root.btoa(binary);
    }
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
  function pdfReferenceFromText(value, pageNumber) {
    const lines = String(value || '').split(/\n+/).map(line => clean(line, 240)).filter(Boolean);
    const reference = lines.find(line => /^(?:cap[ií]tulo|secci[oó]n|numeral|art[ií]culo|anexo|ntp|iso|tabla|figura)\b/i.test(line))
      || lines.find(line => /^\d+(?:\.\d+){1,5}\s+\S/.test(line));
    return (reference ? reference + ' · ' : '') + 'Página ' + pageNumber;
  }
  function pdfPageSections(pageNumber, value, state) {
    const text = String(value || '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (!text) return [];
    const label = pdfReferenceFromText(text, pageNumber);
    const rows = [];
    for (let offset = 0; offset < text.length; offset += 1500) {
      const fragment = text.slice(offset, offset + 1700).trim();
      if (!fragment) continue;
      state.characters += fragment.length;
      if (state.characters > MAX_PDF_INDEX_CHARS || state.sections + rows.length >= MAX_PDF_SECTIONS) throw new Error('multimodal_pdf_index_limit');
      rows.push({ id:'p' + pageNumber + '-' + (rows.length + 1), label, text:fragment });
    }
    state.sections += rows.length;
    return rows;
  }
  async function loadPdfJs() {
    if (pdfJsPromise) return pdfJsPromise;
    const source = root?.document?.baseURI ? new URL('vendor/pdf.min.mjs', root.document.baseURI).href : 'pdfjs-dist/legacy/build/pdf.mjs';
    pdfJsPromise = import(source).then(pdfjs => {
      if (pdfjs?.GlobalWorkerOptions && root?.document?.baseURI) pdfjs.GlobalWorkerOptions.workerSrc = new URL('vendor/pdf.worker.min.mjs', root.document.baseURI).href;
      return pdfjs;
    });
    return pdfJsPromise;
  }
  async function extractPdfSections(buffer, onProgress) {
    const pdfjs = await loadPdfJs();
    const resources = root?.document?.baseURI ? new URL('vendor/', root.document.baseURI).href : '';
    const task = pdfjs.getDocument({
      data:new Uint8Array(buffer),
      isEvalSupported:false,
      stopEvent:false,
      ...(resources ? {
        cMapUrl:resources + 'cmaps/',
        cMapPacked:true,
        standardFontDataUrl:resources + 'standard_fonts/',
        wasmUrl:resources + 'wasm/'
      } : {})
    });
    let documentHandle;
    try {
      documentHandle = await task.promise;
      if (documentHandle.numPages > MAX_PDF_PAGES) throw new Error('multimodal_pdf_page_limit');
      const sections = [];
      const state = { characters:0, sections:0 };
      for (let pageNumber = 1; pageNumber <= documentHandle.numPages; pageNumber += 1) {
        const page = await documentHandle.getPage(pageNumber);
        const content = await page.getTextContent({ disableNormalization:false });
        let pageText = '';
        for (const item of content.items || []) {
          if (typeof item?.str !== 'string') continue;
          pageText += item.str + (item.hasEOL ? '\n' : ' ');
        }
        sections.push(...pdfPageSections(pageNumber, pageText, state));
        page.cleanup?.();
        if (typeof onProgress === 'function') onProgress({ phase:'extracting', fraction:pageNumber / documentHandle.numPages, page:pageNumber, pages:documentHandle.numPages });
      }
      if (!sections.length) throw new Error('multimodal_pdf_no_text');
      return { sections, pages:documentHandle.numPages, indexedCharacters:state.characters };
    } finally {
      try { await documentHandle?.destroy?.(); } catch (_) {}
      try { await task.destroy?.(); } catch (_) {}
    }
  }
  function sampledAnalysisParts(sections) {
    const rows = Array.isArray(sections) ? sections.filter(row => row?.text) : [];
    if (!rows.length) return [];
    const partCount = Math.min(11, rows.length);
    const parts = [];
    for (let partIndex = 0; partIndex < partCount; partIndex += 1) {
      const start = Math.floor(partIndex * rows.length / partCount);
      const end = Math.max(start + 1, Math.floor((partIndex + 1) * rows.length / partCount));
      const sample = rows.slice(start, end).map(row => '[' + clean(row.label || 'Fragmento', 240) + '] ' + String(row.text || '')).join('\n\n').slice(0, 14500);
      if (sample) parts.push({ text:'Muestra distribuida ' + (partIndex + 1) + '/' + partCount + ':\n' + sample });
    }
    return parts;
  }
  async function buildAsset(file, onProgress) {
    const kind = classifyFile(file);
    if (kind === 'unsupported') throw new Error('unsupported_multimodal_type');
    const byteLimit = kind === 'pdf' ? MAX_PDF_FILE_BYTES : MAX_FILE_BYTES;
    if (Number(file?.size || 0) > byteLimit) throw new Error(kind === 'pdf' ? 'multimodal_pdf_too_large' : 'multimodal_file_too_large');
    const buffer = await readAsArrayBuffer(file, progress => {
      if (typeof onProgress === 'function') onProgress({ phase:'reading', fraction:Number(progress || 0) });
    });
    const sha256 = await digest(buffer);
    let sections = []; let dataUrl = ''; let extraction = null;
    if (kind === 'text') sections = sectionsFromText(new TextDecoder().decode(buffer));
    if (kind === 'pdf') {
      extraction = await extractPdfSections(buffer, onProgress);
      sections = extraction.sections;
    }
    if (kind !== 'text' && Number(file.size || 0) <= MAX_INLINE_BYTES) dataUrl = await readAsDataUrl(file);
    const locallyIndexed = kind === 'text' || (kind === 'pdf' && sections.length > 0);
    return { id:'bke_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8), title:titleFor(file), kind, mime:String(file.type || 'application/octet-stream').slice(0, 120), bytes:Number(file.size || 0), sha256, sections, dataUrl, extraction, analysis:null, status:locallyIndexed ? 'local_ready' : (dataUrl ? 'pending_analysis' : 'blocked'), createdAt:Date.now(), updatedAt:Date.now() };
  }
  function upgradeBlockedDuplicate(previous, incoming) {
    if (!previous || !incoming || previous.status !== 'blocked' || incoming.status !== 'local_ready') return null;
    return { ...incoming, id:previous.id, createdAt:Number(previous.createdAt || incoming.createdAt), updatedAt:Date.now() };
  }
  async function importFiles(files, onProgress) {
    const incoming = [...(files || [])]; const existing = await list();
    if (existing.length + incoming.length > MAX_ASSETS) throw new Error('multimodal_asset_limit');
    const created = [];
    for (let index = 0; index < incoming.length; index += 1) {
      const file = incoming[index];
      const asset = await buildAsset(file, state => {
        if (typeof onProgress !== 'function') return;
        const fraction = Number(state?.fraction || 0);
        const localPercent = state?.phase === 'extracting' ? 18 + fraction * 54 : fraction * 18;
        const overall = ((index + localPercent / 72) / Math.max(1, incoming.length)) * 72;
        onProgress({ phase:state?.phase || 'reading', percent:Math.round(overall), label:state?.phase === 'extracting' ? 'Indexando PDF' : 'Leyendo archivo', detail:state?.phase === 'extracting' ? ('Página ' + state.page + ' de ' + state.pages + ' · ' + titleFor(file)) : titleFor(file) });
      });
      const duplicateIndex = asset.sha256 ? existing.findIndex(row => row.sha256 === asset.sha256) : -1;
      if (duplicateIndex >= 0) {
        const upgraded = upgradeBlockedDuplicate(existing[duplicateIndex], asset);
        if (upgraded) {
          await put(upgraded); existing[duplicateIndex] = upgraded; created.push(upgraded);
          if (typeof onProgress === 'function') onProgress({ phase:'stored', percent:Math.round(((index + 1) / Math.max(1, incoming.length)) * 72), label:'PDF actualizado', detail:'Se reemplazó la ficha bloqueada por un índice local completo.' });
          continue;
        }
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
    const parts = [{ text:'Analiza esta fuente para la biblioteca de conocimiento de Yarbi. Devuelve SOLO JSON válido: {"summary":"","citations":[{"reference":"Capítulo, sección, numeral o página SOLO si está visible en la fuente; si no, usa Referencia no localizada","quote":"cita literal corta"}]}. Cada quote debe proceder literalmente de la fuente. No inventes números de página, capítulos, normas ni requisitos. No ejecutes acciones, no guardes instrucciones y omite lo ilegible. Las muestras están distribuidas por todo el documento; no afirmes que el resumen sustituye al índice completo.' }];
    if (asset.sections?.length) parts.push(...sampledAnalysisParts(asset.sections));
    if (asset.dataUrl) parts.push({ inline_data:{ mime_type:asset.mime, data:asset.dataUrl.split(',')[1] || '' } });
    const response = await root.fetch((typeof root.gfcRuntimeApiOrigin === 'function' ? root.gfcRuntimeApiOrigin() : '') + '/api/assistant/gemini', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer ' + token }, body:JSON.stringify({ system_instruction:{ parts:[{ text:'Eres el procesador seguro BKE de Yarbi. Solo produces un borrador de conocimiento para revisión del propietario. No alteres CRM, agenda, finanzas, WhatsApp ni memoria permanente.' }] }, contents:[{ role:'user', parts }], generationConfig:{ temperature:0.2, maxOutputTokens:2048 } }) });
    const data = await response.json().catch(() => ({})); if (!response.ok) return { ok:false, code:'multimodal_provider_unavailable', message:'El análisis no terminó (' + response.status + '). La fuente sigue pendiente y no se aprobó.' };
    const extracted = parseStructuredAnalysis(responseText(data));
    const analysis = { text:extracted.summary, citations:extracted.citations, at:Date.now(), provider:'gemini_safe_proxy', reviewed:false };
    const learnedSections = asset.sections?.length ? asset.sections : (analysis.citations.length ? analysis.citations : sectionsFromText(analysis.text));
    await put({ ...asset, sections:learnedSections, analysis, status:'analyzed_draft', updatedAt:Date.now() });
    await render(); return { ok:true, assetId:asset.id, analysis };
  }
  async function approve(id) { const asset = await get(id); if (!asset || !asset.analysis?.text) throw new Error('multimodal_analysis_required'); await put({ ...asset, status:'approved', learningEnabled:true, updatedAt:Date.now(), analysis:{ ...asset.analysis, reviewed:true, approvedAt:Date.now() } }); await render(); return true; }
  async function toggleLearning(id, enabled) {
    const asset = await get(id);
    if (!asset || asset.status !== 'approved') throw new Error('multimodal_asset_not_approved');
    await put({ ...asset, learningEnabled:enabled !== false, updatedAt:Date.now() });
    await render();
    return true;
  }
  function approvedPdfAssets(assets) {
    return (Array.isArray(assets) ? assets : []).filter(asset => asset.status === 'approved' && asset.learningEnabled !== false && asset.kind === 'pdf' && (asset.dataUrl || Array.isArray(asset.sections) && asset.sections.length));
  }
  function sourceCodes(value) {
    return normalize(value).match(/\b(?:ntp|em|iso|rne)\s+\d+(?:\s+\d+){0,3}\b/g) || [];
  }
  function explicitSourceMatches(assets, question) {
    const query = normalize(question);
    const queryTerms = new Set(contentTokens(question));
    const queryCodes = new Set(sourceCodes(question));
    return approvedPdfAssets(assets).filter(asset => {
      const title = normalize(String(asset.title || '').replace(/\.pdf$/i, ''));
      if (title.length >= 5 && query.includes(title)) return true;
      if (sourceCodes(asset.title).some(code => queryCodes.has(code))) return true;
      const titleTerms = contentTokens(asset.title).filter(term => /\d/.test(term) || term.length >= 4);
      if (!titleTerms.length) return false;
      const hits = titleTerms.filter(term => queryTerms.has(term));
      return hits.length >= 2 && hits.length / titleTerms.length >= 0.6;
    });
  }
  function rankApprovedSources(assets, question) {
    const terms = contentTokens(question);
    return approvedPdfAssets(assets).map(asset => {
      const titleHaystack = normalize(asset.title || '');
      const titleHits = terms.filter(term => titleHaystack.includes(term));
      const rows = (Array.isArray(asset.sections) ? asset.sections : []).map(section => {
        const haystack = normalize([section.label, section.text].join(' '));
        const hits = terms.filter(term => haystack.includes(term));
        return { assetId:asset.id, title:asset.title, kind:asset.kind, sourceHash:asset.sha256 || '', sectionId:section.id || '', sectionLabel:clean(section.label || 'Fragmento sin referencia', 240), excerpt:String(section.text || '').slice(0, 900), hits, score:hits.length };
      }).filter(row => row.score).sort((a,b) => b.score - a.score).slice(0, 4);
      const covered = new Set([...titleHits, ...rows.flatMap(row => row.hits)]);
      const coverage = terms.length ? covered.size / terms.length : 0;
      const best = Number(rows[0]?.score || 0);
      const score = Math.round(coverage * 100 + best * 12 + titleHits.length * 20);
      return { asset, score, coverage, evidence:rows, summary:clean(asset.analysis?.text || asset.analysis?.summary || '', 900) };
    }).sort((a,b) => b.score - a.score || String(a.asset.title || '').localeCompare(String(b.asset.title || ''), 'es-PE'));
  }
  function parseSourceRoute(value, allowedIds) {
    const raw = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    let parsed;
    try { parsed = JSON.parse(raw); } catch (_) { return { ok:false, selectedAssetId:'', confidence:'low', searchTerms:[] }; }
    const selectedAssetId = clean(parsed?.selected_asset_id, 180);
    const confidence = ['high','medium','low'].includes(String(parsed?.confidence || '').toLowerCase()) ? String(parsed.confidence).toLowerCase() : 'low';
    const allowed = new Set((Array.isArray(allowedIds) ? allowedIds : []).map(String));
    const searchTerms = (Array.isArray(parsed?.search_terms) ? parsed.search_terms : []).map(term => clean(term, 80)).filter(Boolean).slice(0, 8);
    if (!selectedAssetId || !allowed.has(selectedAssetId)) return { ok:true, selectedAssetId:'', confidence:'low', searchTerms, reason:clean(parsed?.reason, 240) };
    return { ok:true, selectedAssetId, confidence, searchTerms, reason:clean(parsed?.reason, 240) };
  }
  function localSourceDecision(rankings) {
    const first = rankings?.[0];
    const second = rankings?.[1];
    if (!first || first.coverage < 0.8 || first.score < 100) return null;
    if (second && first.score - second.score < 35) return null;
    return first;
  }
  async function routeApprovedSource(assets, question) {
    const candidates = approvedPdfAssets(assets);
    if (!candidates.length) return { asset:null, code:'no_approved_pdf', candidates:[] };
    if (candidates.length === 1) return { asset:candidates[0], confidence:'high', searchTerms:contentTokens(question), evidence:rankApprovedSources(candidates, question)[0]?.evidence || [] };
    const explicitMatches = explicitSourceMatches(candidates, question);
    if (explicitMatches.length === 1) return { asset:explicitMatches[0], confidence:'high', searchTerms:contentTokens(question), evidence:rankApprovedSources(explicitMatches, question)[0]?.evidence || [] };
    const rankings = rankApprovedSources(candidates, question);
    const catalogRows = rankings.slice(0, 12);
    const token = typeof root.gfcAccountFreshAccessToken === 'function' ? await root.gfcAccountFreshAccessToken() : '';
    if (token && typeof root.fetch === 'function') {
      const catalog = catalogRows.map((row, index) => ({
        candidate:index + 1,
        asset_id:String(row.asset.id || ''),
        title:clean(row.asset.title, 160),
        summary:row.summary,
        relevant_fragments:row.evidence.slice(0, 3).map(item => ({ reference:item.sectionLabel, text:clean(item.excerpt, 620) }))
      }));
      try {
        const response = await root.fetch((typeof root.gfcRuntimeApiOrigin === 'function' ? root.gfcRuntimeApiOrigin() : '') + '/api/assistant/gemini', {
          method:'POST',
          headers:{ 'Content-Type':'application/json', Authorization:'Bearer ' + token },
          body:JSON.stringify({
            system_instruction:{ parts:[{ text:'Eres el enrutador de fuentes de la biblioteca de Yarbi. Tu única tarea es elegir qué documento debe consultarse. No respondas la pregunta. No inventes fuentes. Si el catálogo no permite decidir, deja selected_asset_id vacío. Devuelve SOLO JSON.' }] },
            contents:[{ role:'user', parts:[{ text:'CONSULTA:\n' + clean(question, 1200) + '\n\nCATÁLOGO DE FUENTES APROBADAS:\n' + JSON.stringify(catalog) + '\n\nDevuelve: {"selected_asset_id":"id exacto o vacío","confidence":"high|medium|low","search_terms":["sinónimos técnicos útiles"],"reason":"motivo breve"}. Elige high o medium solo si el título, resumen o fragmentos son temáticamente pertinentes.' }] }],
            generationConfig:{ temperature:0, maxOutputTokens:400, responseMimeType:'application/json' }
          })
        });
        const data = await response.json().catch(() => ({}));
        if (response.ok) {
          const routed = parseSourceRoute(responseText(data), candidates.map(asset => asset.id));
          if (routed.selectedAssetId && routed.confidence !== 'low') {
            const selected = candidates.find(asset => String(asset.id) === routed.selectedAssetId);
            const ranked = rankings.find(row => String(row.asset.id) === routed.selectedAssetId);
            if (selected) return { asset:selected, confidence:routed.confidence, searchTerms:routed.searchTerms, evidence:ranked?.evidence || [], routed:true };
          }
        }
      } catch (_) {}
    }
    const local = localSourceDecision(rankings);
    if (local) return { asset:local.asset, confidence:'high', searchTerms:contentTokens(question), evidence:local.evidence, routed:false };
    return { asset:null, code:'source_ambiguous', candidates:rankings.slice(0, 4).map(row => row.asset) };
  }
  function selectApprovedDirectAsset(assets, evidence, question) {
    const candidates = (Array.isArray(assets) ? assets : []).filter(asset => asset.status === 'approved' && asset.kind === 'pdf' && asset.dataUrl);
    if (candidates.length === 1) return candidates[0];
    const matches = explicitSourceMatches(candidates, question);
    return matches.length === 1 ? matches[0] : null;
  }
  async function queryApprovedSource(asset, question) {
    if (!asset?.dataUrl || asset.status !== 'approved') return { ok:false, code:'approved_source_binary_unavailable' };
    const queryKey = 'source-v2|' + normalize(question).slice(0, 1200);
    const cached = (Array.isArray(asset.queryCache) ? asset.queryCache : []).find(item => item?.key === queryKey && item?.result?.ok);
    if (cached) return { ok:true, cached:true, reply:formatDirectedAnswer(cached.result, asset), result:cached.result };
    const token = typeof root.gfcAccountFreshAccessToken === 'function' ? await root.gfcAccountFreshAccessToken() : '';
    if (!token) return { ok:false, code:'session_required' };
    const instruction = 'Busca la respuesta exclusivamente dentro del PDF adjunto. La consulta puede usar sinónimos o describir una configuración técnica sin repetir el vocabulario exacto. Revisa todo el documento antes de responder. Devuelve SOLO JSON válido con esta forma: {"found":true|false,"answer":"respuesta directa y breve","exact_quote":"cita literal que sustenta exactamente la respuesta","reference":"norma, capítulo, numeral, artículo o página visible","plain_explanation":"significado sencillo en máximo 80 palabras","caveat":"condición, excepción o dato faltante"}. Usa found=true únicamente si la cita literal responde la consulta. Si el PDF no lo dice, usa found=false y explica brevemente qué término o condición podría faltar. No uses conocimiento general, no inventes numerales ni concluyas que algo está permitido por ausencia de prohibición.';
    const response = await root.fetch((typeof root.gfcRuntimeApiOrigin === 'function' ? root.gfcRuntimeApiOrigin() : '') + '/api/assistant/gemini', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', Authorization:'Bearer ' + token },
      body:JSON.stringify({
        system_instruction:{ parts:[{ text:'Eres el buscador técnico de la biblioteca aprobada de Yarbi. Prioriza exactitud y brevedad. No ejecutas acciones comerciales ni modificas la fuente.' }] },
        contents:[{ role:'user', parts:[
          { text:instruction + '\n\nCONSULTA:\n' + clean(question, 1200) },
          { inline_data:{ mime_type:asset.mime || 'application/pdf', data:asset.dataUrl.split(',')[1] || '' } }
        ] }],
        generationConfig:{ temperature:0.1, maxOutputTokens:1000, responseMimeType:'application/json' }
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { ok:false, code:'direct_source_provider_unavailable' };
    let result = parseDirectedAnswer(responseText(data));
    if (!result.ok) return { ok:false, code:'direct_source_invalid_response' };
    if (result.found && Array.isArray(asset.sections) && asset.sections.length && !quoteSupportedByAsset(result, asset)) {
      result = { ok:true, found:false, answer:'', quote:'', reference:'', plain:'', caveat:'La cita devuelta no coincide literalmente con el índice local de esta fuente.' };
    }
    const queryCache = [...(Array.isArray(asset.queryCache) ? asset.queryCache : []).filter(item => item?.key !== queryKey), { key:queryKey, result, at:Date.now() }].slice(-40);
    await put({ ...asset, queryCache });
    return { ok:true, cached:false, reply:formatDirectedAnswer(result, asset), result };
  }
  async function askTutor(question, prepared) {
    const text = clean(question, 1200); if (!text) throw new Error('tutor_question_required');
    const assets = Array.isArray(prepared?.assets) ? prepared.assets : await list();
    const evidence = Array.isArray(prepared?.evidence) ? prepared.evidence : searchApproved(assets, text);
    const context = evidence.map(row => '[' + row.title + ' · ' + row.sectionLabel + '] ' + row.excerpt).join('\n');
    const token = typeof root.gfcAccountFreshAccessToken === 'function' ? await root.gfcAccountFreshAccessToken() : '';
    if (!token) return { ok:false, message:'Inicia sesión para usar el tutor. Tus fuentes aprobadas siguen guardadas localmente.' };
    if (!evidence.length) return { ok:false, message:'No encontré una cita aprobada que respalde esta respuesta. No inventaré una referencia técnica; carga y aprueba la norma primero.' };
    const response = await root.fetch((typeof root.gfcRuntimeApiOrigin === 'function' ? root.gfcRuntimeApiOrigin() : '') + '/api/assistant/gemini', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer ' + token }, body:JSON.stringify({ system_instruction:{ parts:[{ text:'Eres el Tutor personal de Yarbi. Usa exclusivamente la evidencia aprobada. Devuelve SOLO JSON válido: {"found":true|false,"answer":"conclusión directa en máximo 45 palabras","exact_quote":"una única cita literal que responda la consulta","reference":"capítulo, numeral o página exacta de la evidencia","plain_explanation":"explicación sencilla en máximo 55 palabras","caveat":"condición relevante o vacío"}. No agregues introducciones, listas extensas ni conocimiento general. found=true requiere cita y referencia. Nunca ejecutes acciones ni guardes aprendizajes.' }] }, contents:[{ role:'user', parts:[{ text:'Pregunta del propietario:\n' + text + '\n\nEvidencia aprobada disponible:\n' + context }] }], generationConfig:{ temperature:0.1, maxOutputTokens:700, responseMimeType:'application/json' } }) });
    const data = await response.json().catch(() => ({})); if (!response.ok) return { ok:false, message:'El tutor no está disponible ahora. No inventé una explicación.' };
    const parsed = parseDirectedAnswer(responseText(data));
    const sourceAsset = assets.find(asset => String(asset.id) === String(evidence[0]?.assetId)) || { title:evidence[0]?.title, sha256:evidence[0]?.sourceHash };
    if (!parsed.ok || parsed.found && !quoteSupportedByEvidence(parsed, evidence)) {
      return { ok:true, text:formatDirectedAnswer({ found:false, caveat:'La respuesta recibida no pudo verificarse literalmente contra los fragmentos recuperados.' }, sourceAsset), evidence:[] };
    }
    return { ok:true, text:formatDirectedAnswer(parsed, sourceAsset), evidence:evidence.map(row => ({ title:row.title, assetId:row.assetId, sectionLabel:row.sectionLabel })) };
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
    if (explicit || strongMatch) {
      const route = await routeApprovedSource(assets, text);
      if (route.asset) {
        const expandedQuery = [text, ...(route.searchTerms || [])].join(' ');
        const routedEvidence = searchApproved([route.asset], expandedQuery, { limit:12 });
        evidence = routedEvidence.length ? routedEvidence : (route.evidence || []);
        if (route.asset.dataUrl) {
          const directed = await queryApprovedSource(route.asset, text);
          if (directed.ok) return { handled:true, reply:directed.reply, directSource:true, cached:!!directed.cached, sourceRouted:true };
          if (!evidence.length) return { handled:true, reply:'## ⚠️ No pude revisar el PDF completo\n\nLa fuente correcta está identificada, pero la consulta del documento no terminó ahora. No usaré otra norma como sustituto ni inventaré una respuesta.' };
        }
        if (evidence.length) {
          const routedResult = await askTutor(text, { assets:[route.asset], evidence });
          if (routedResult.ok) return { handled:true, reply:routedResult.text, evidence:routedResult.evidence, sourceRouted:true };
        }
        return { handled:true, reply:formatDirectedAnswer({ found:false, caveat:'La fuente fue seleccionada, pero el índice aprobado no contiene una cita literal verificable para esta consulta.' }, route.asset) };
      }
      if (route.code === 'source_ambiguous') {
        const names = (route.candidates || []).slice(0, 4).map(asset => '**' + clean(asset.title, 100) + '**').join(', ');
        return { handled:true, reply:'## 📚 Necesito identificar la norma correcta\n\nLa consulta puede corresponder a más de una fuente aprobada' + (names ? ': ' + names : '') + '. Indícame el nombre de la norma o un dato adicional. No elegiré un PDF por una coincidencia débil.' };
      }
    }
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
  function statusText(error) { return ({ unsupported_multimodal_type:'Formato no compatible.', multimodal_file_too_large:'El archivo supera el límite local de 40 MB para audio, video o imagen.', multimodal_pdf_too_large:'El PDF supera el límite seguro de 120 MB para este dispositivo.', multimodal_pdf_page_limit:'El PDF supera 2.500 páginas y no se procesó para proteger la memoria del teléfono.', multimodal_pdf_index_limit:'El texto del PDF supera el límite seguro de indexación local.', multimodal_pdf_no_text:'El PDF no contiene texto extraíble. Puede ser un escaneo y necesita OCR.', multimodal_asset_limit:'La biblioteca local alcanzó 80 fuentes.', multimodal_storage_unavailable:'El almacenamiento local no está disponible.', extractor_required:'Este archivo necesita un extractor autorizado.' }[error?.message] || error?.message || 'No pude procesar la fuente.'); }
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
  function formatBytes(value) {
    const bytes = Math.max(0, Number(value || 0));
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toLocaleString('es-PE', { maximumFractionDigits:1 }) + ' MB';
    return Math.max(1, Math.round(bytes / 1024)).toLocaleString('es-PE') + ' KB';
  }
  function card(asset) {
    const id = escapeHtml(asset.id);
    const enabled = asset.status === 'approved' && asset.learningEnabled !== false;
    const status = asset.status === 'approved' && !enabled ? 'Fuera del aprendizaje' : statusLabel(asset.status);
    const statusTone = enabled ? 'approved' : asset.status === 'approved' ? 'paused' : 'pending';
    const analysis = asset.analysis?.text ? '<div class="gfc-mm-detail-copy"><b>Resumen revisable</b><p>' + escapeHtml(asset.analysis.text) + '</p>' + ((asset.analysis?.citations || []).length ? '<small>' + asset.analysis.citations.length + ' cita(s) extraída(s).</small>' : '') + '</div>' : '';
    const extraction = asset.extraction?.pages ? '<div class="gfc-mm-index-meta">' + Number(asset.extraction.pages) + ' páginas · ' + Number(asset.sections?.length || 0) + ' fragmentos indexados</div>' : '';
    const primaryAction = asset.status === 'analyzed_draft'
      ? '<button class="gfc-mm-btn primary" onclick="gfcYarbiMultimodalApprove(\'' + id + '\')">Aprobar</button>'
      : asset.status === 'approved'
        ? '<button class="gfc-mm-btn" onclick="gfcYarbiMultimodalToggleLearning(\'' + id + '\',' + (!enabled) + ')">' + (enabled ? 'Pausar uso' : 'Volver a usar') + '</button>'
        : '<button class="gfc-mm-btn primary" onclick="gfcYarbiMultimodalAnalyze(\'' + id + '\')">Analizar</button>';
    return '<article class="gfc-mm-card"><div class="gfc-mm-card-head"><span class="gfc-mm-kind">' + ({ text:'📝', pdf:'📕', image:'🖼️', audio:'🎙️', video:'🎬' }[asset.kind] || '📎') + '</span><div class="gfc-mm-file-main"><b title="' + escapeHtml(asset.title) + '">' + escapeHtml(asset.title) + '</b><small>' + kindLabel(asset.kind) + ' · ' + formatBytes(asset.bytes) + '</small></div><span class="gfc-mm-state ' + statusTone + '">' + escapeHtml(status) + '</span></div><div class="gfc-mm-actions">' + primaryAction + '<button class="gfc-mm-btn danger" onclick="gfcYarbiMultimodalDelete(\'' + id + '\')" aria-label="Borrar ' + escapeHtml(asset.title) + '">Borrar</button><details class="gfc-mm-more"><summary>Detalles</summary><div class="gfc-mm-details-body">' + extraction + analysis + '<small>SHA-256 ' + escapeHtml(String(asset.sha256 || '').slice(0, 16)) + '…</small></div></details></div></article>';
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
  async function toggleLearningFromUi(id, enabled) {
    try {
      await toggleLearning(id, enabled);
      setStatus(enabled ? 'La fuente volvió al aprendizaje de Yarbi.' : 'La fuente se conserva en el teléfono, pero Yarbi dejó de usarla para responder.', false);
    } catch (error) { setStatus(statusText(error), true); }
  }
  async function deleteFromUi(id) {
    const asset = await get(id).catch(() => null);
    if (!asset) return false;
    const accepted = typeof root.confirm !== 'function' || root.confirm('¿Borrar “' + clean(asset.title, 100) + '” de este teléfono? Su índice y análisis local también se eliminarán.');
    if (!accepted) return false;
    await removeAsset(id);
    await render();
    setStatus('La fuente y su índice local fueron eliminados. Los demás documentos no cambiaron.', false);
    return true;
  }
  async function askTutorFromUi() { const input = root.document.getElementById('gfc-mm-tutor-question'); const out = root.document.getElementById('gfc-mm-tutor-answer'); if (!out) return; out.textContent = 'El tutor está preparando una explicación…'; try { const result = await askTutor(input?.value || ''); out.textContent = result.ok ? result.text : (result.message || 'No pude responder sin inventar información.'); } catch (error) { out.textContent = statusText(error); } }
  function html() { return '<main class="gfc-yarbi-tool-page gfc-mm-page"><section class="gfc-mm-hero"><span>📚</span><div><h2>Conocimiento y Tutor</h2><p>Selecciona una fuente, observa su procesamiento y decide cuándo puede usarla Yarbi.</p></div></section><section class="gfc-yarbi-tool-card"><div class="gfc-mm-steps"><span><b>1</b> Elegir</span><span><b>2</b> Procesar</span><span><b>3</b> Revisar</span><span><b>4</b> Aprobar</span></div><label class="gfc-mm-picker" for="gfc-mm-input"><span class="gfc-mm-picker-icon">⌕</span><div><b>Buscar archivos en el teléfono</b><small>PDF de hasta 120 MB: Yarbi los indexa por páginas en el teléfono. Los PDF escaneados sin texto requieren OCR.</small><em id="gfc-mm-selected">Ningún archivo seleccionado</em></div><input id="gfc-mm-input" type="file" multiple onchange="gfcYarbiMultimodalFilesChosen(this.files)" accept=".txt,.md,.csv,.json,.xml,.pdf,.jpg,.jpeg,.png,.webp,.heic,.mp3,.m4a,.wav,.ogg,.aac,.mp4,.mov,.webm,text/plain,application/pdf,image/*,audio/*,video/*"></label><div class="gfc-mm-primary-actions"><button class="gfc-yarbi-primary" onclick="gfcYarbiMultimodalImport()">Agregar y procesar</button><button class="gfc-yarbi-secondary" onclick="gfcYarbiMultimodalSaveOnly()">Solo guardar</button></div><section id="gfc-mm-progress" class="gfc-mm-progress-card" data-tone="working" hidden aria-live="polite"><div class="gfc-mm-progress-head"><span id="gfc-mm-progress-chip" class="gfc-mm-progress-chip">Procesando archivo</span><strong id="gfc-mm-progress-percent">0%</strong></div><div class="gfc-mm-progress-track"><i id="gfc-mm-progress-bar"></i></div><p id="gfc-mm-progress-detail">Preparando…</p></section><div id="gfc-mm-status" class="gfc-yarbi-import-summary">Tus fuentes aprobadas quedan indexadas localmente para responder rápido. La aprobación es obligatoria antes de usarlas como conocimiento. No se ejecutan acciones comerciales durante este proceso.</div></section><section class="gfc-yarbi-tool-card"><div class="gfc-yarbi-tool-title">Fuentes de esta biblioteca</div><div id="gfc-mm-list"></div></section><section class="gfc-yarbi-tool-card"><div class="gfc-yarbi-tool-title">🎓 Preguntar al Tutor</div><div class="gfc-yarbi-tool-copy">Yarbi responde primero de forma breve y muestra una sola cita literal con su capítulo, numeral o página. Si falta evidencia, se abstiene.</div><textarea id="gfc-mm-tutor-question" rows="4" placeholder="Ejemplo: ¿Qué exige esta norma y qué significa en palabras sencillas?"></textarea><button class="gfc-yarbi-primary" onclick="gfcYarbiTutorAsk()">Preguntar al tutor</button><article id="gfc-mm-tutor-answer" class="gfc-mm-tutor-answer">Aquí aparecerá una explicación respaldada por tus fuentes aprobadas.</article></section></main>'; }
  function attach() { void render(); }
  return Object.freeze({ classifyFile, normalize, contentTokens, knowledgeIntent, sectionsFromText, pdfPageSections, upgradeBlockedDuplicate, searchApproved, firstApprovedEvidence, responseText, parseStructuredAnalysis, parseDirectedAnswer, formatDirectedAnswer, citationMarkdown, citationListMarkdown, quoteSupportedByAsset, approvedPdfAssets, sourceCodes, explicitSourceMatches, rankApprovedSources, parseSourceRoute, localSourceDecision, routeApprovedSource, selectApprovedDirectAsset, queryApprovedSource, buildAsset, importFiles, list, analyze, approve, toggleLearning, removeAsset, askTutor, answerFromChat, html, attach, render, analyzeFromUi, approveFromUi, toggleLearningFromUi, deleteFromUi, importFromUi, askTutorFromUi, filesChosen, setProgress, formatBytes, MAX_INLINE_BYTES, MAX_PDF_FILE_BYTES });
}));
