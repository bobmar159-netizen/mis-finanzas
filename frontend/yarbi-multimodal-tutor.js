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
    root.gfcYarbiMultimodalSemanticIndex = api.semanticIndexFromUi;
    root.gfcYarbiMultimodalApprove = api.approveFromUi;
    root.gfcYarbiMultimodalToggleLearning = api.toggleLearningFromUi;
    root.gfcYarbiMultimodalDelete = api.deleteFromUi;
    root.gfcYarbiMultimodalFilesChosen = api.filesChosen;
    root.gfcYarbiMultimodalImportText = api.importTextFromUi;
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
  const GEMINI_REQUEST_TIMEOUT_MS = 18000;
  const SEMANTIC_QUERY_TIMEOUT_MS = 7000;
  const SEMANTIC_INDEX_VERSION = 'gemini-embedding-001@768-r1';
  const SEMANTIC_BATCH_SIZE = 24;
  const SEMANTIC_DIMENSIONS = 768;
  let dbPromise = null;
  let progressTimer = null;
  let pdfJsPromise = null;
  let semanticUpgradeRunning = false;
  let legacyMigrationPromise = null;
  const semanticQueryCache = new Map();

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
  const RETRIEVAL_EQUIVALENTS = [
    ['valvula','valvulas','llave','llaves','corte'],
    ['artefacto','artefactos','aparato','aparatos','equipo','equipos'],
    ['permitir','permitido','permite','puede','podra','admitir','admite','autorizado'],
    ['unica','unico','sola','solo','misma','mismo','comun'],
    ['dos','doble','ambos','ambas','2'],
    ['capitulo','seccion','numeral','articulo','apartado'],
    ['tuberia','tuberias','conducto','conductos'],
    ['ventilacion','ventilar','aireacion','abertura','rejilla']
  ];
  function retrievalGroups(value) {
    return contentTokens(value).map(term => {
      const equivalent = RETRIEVAL_EQUIVALENTS.find(group => group.includes(term));
      const variants = new Set(equivalent || [term]);
      variants.add(term);
      if (term.endsWith('es') && term.length > 5) variants.add(term.slice(0, -2));
      if (term.endsWith('s') && term.length > 4) variants.add(term.slice(0, -1));
      return { term, variants:[...variants] };
    });
  }
  function matchRetrievalGroups(haystack, groups) {
    return (Array.isArray(groups) ? groups : []).filter(group => group.variants.some(variant => haystack.includes(variant)));
  }
  function normalizeEmbedding(values) {
    const rows = (Array.isArray(values) ? values : []).map(Number).filter(Number.isFinite);
    const norm = Math.sqrt(rows.reduce((sum, value) => sum + value * value, 0));
    return norm > 0 ? rows.map(value => value / norm) : [];
  }
  function bytesToBase64(bytes) {
    if (typeof root?.btoa === 'function') {
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      return root.btoa(binary);
    }
    return typeof Buffer !== 'undefined' ? Buffer.from(bytes).toString('base64') : '';
  }
  function base64ToBytes(value) {
    const encoded = String(value || '');
    if (!encoded) return new Uint8Array(0);
    if (typeof root?.atob === 'function') {
      const binary = root.atob(encoded); const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      return bytes;
    }
    return typeof Buffer !== 'undefined' ? new Uint8Array(Buffer.from(encoded, 'base64')) : new Uint8Array(0);
  }
  function encodeEmbedding(values) {
    const normalized = normalizeEmbedding(values);
    if (!normalized.length) return '';
    const bytes = new Uint8Array(normalized.length);
    normalized.forEach((value, index) => { bytes[index] = Math.max(1, Math.min(255, Math.round(value * 127) + 128)); });
    return bytesToBase64(bytes);
  }
  function quantizedCosine(left, right) {
    const a = base64ToBytes(left); const b = base64ToBytes(right);
    if (!a.length || a.length !== b.length) return -1;
    let dot = 0; let aNorm = 0; let bNorm = 0;
    for (let index = 0; index < a.length; index += 1) {
      const av = a[index] - 128; const bv = b[index] - 128;
      dot += av * bv; aNorm += av * av; bNorm += bv * bv;
    }
    return aNorm && bNorm ? dot / Math.sqrt(aNorm * bNorm) : -1;
  }
  function semanticReady(section) {
    return section?.semantic?.version === SEMANTIC_INDEX_VERSION && typeof section?.semantic?.vector === 'string' && !!section.semantic.vector;
  }
  function knowledgeIntent(value) {
    return /\b(?:norma|ntp|iso|manual|pdf|documento|archivo|fuente|biblioteca|cap[ií]tulo|numeral|art[ií]culo|anexo|tabla|procedimiento|reglamento|ficha\s+t[eé]cnica)\b/i.test(String(value || ''));
  }
  function obviousBusinessIntent(value) {
    return /\b(?:cliente|crm|agenda|visita|cita|mensaje|whatsapp|cobro|cobrar|deuda|balance|ingreso|gasto|movimiento|stock|cotizaci[oó]n|recordatorio|llamar|hoy|ma[ñn]ana|ayer)\b/i.test(String(value || ''));
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
    const groups = retrievalGroups(query);
    const limit = Math.max(1, Math.min(80, Number(options?.limit) || 36));
    return (Array.isArray(assets) ? assets : []).filter(asset => asset.status === 'approved' && asset.learningEnabled !== false).flatMap(asset => {
      const sections = Array.isArray(asset.sections) ? asset.sections : [];
      return sections.map(section => {
        const title = normalize(asset.title || '');
        const reference = normalize(section.label || '');
        const body = normalize(section.text || '');
        const titleGroups = matchRetrievalGroups(title, groups);
        const referenceGroups = matchRetrievalGroups(reference, groups);
        const bodyGroups = matchRetrievalGroups(body, groups);
        const matched = new Map();
        [...bodyGroups, ...referenceGroups].forEach(group => matched.set(group.term, group));
        if (!matched.size) return null;
        const exactHits = [...matched.values()].filter(group => body.includes(group.term) || reference.includes(group.term));
        const score = matched.size * 3 + exactHits.length * 2 + titleGroups.length * 2 + referenceGroups.length;
        return { assetId:asset.id, title:asset.title, kind:asset.kind, sourceHash:asset.sha256 || '', sectionId:section.id || '', sectionLabel:clean(section.label || 'Fragmento sin referencia', 240), excerpt:section.text.slice(0, 900), hits:[...matched.keys()], score };
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
      return '## 🔎 Respuesta breve\n\n'
        + 'No encontré una cita literal que responda esa pregunta en **' + title + '**.\n\n'
        + '> [Evidencia insuficiente]\n> ' + (result?.caveat ? brief(result.caveat, 42) : 'La fuente revisada no contiene un fragmento verificable para sostener una respuesta.') + '\n\n'
        + 'No afirmaré que está permitido o prohibido sin respaldo documental.';
    }
    const reference = clean(result.reference, 180).replace(/[\[\]]/g, '');
    return '## ✅ Respuesta breve\n\n'
      + (result.answer ? brief(result.answer, 38) : 'Encontré evidencia relacionada en la fuente aprobada.') + '\n\n'
      + '> [📖 Cita literal · ' + reference + ']\n> “' + brief(result.quote, 54) + '”\n> Fuente: ' + title + '\n\n'
      + (result.plain ? '### En palabras sencillas\n\n' + brief(result.plain, 42) + '\n\n' : '')
      + (result.caveat ? '> [⚠️ Condición importante]\n> ' + brief(result.caveat, 30) + '\n\n' : '')
      + '_La cita es evidencia textual; la explicación sencilla es una interpretación de Yarbi._';
  }
  function sourceNames(rows) {
    return (Array.isArray(rows) ? rows : []).slice(0, 3).map(asset => '**' + clean(asset?.title || 'Fuente sin nombre', 100) + '**').join(', ');
  }
  function libraryAvailabilityReply(assets) {
    const rows = Array.isArray(assets) ? assets : [];
    const drafts = rows.filter(asset => asset.status === 'analyzed_draft');
    if (drafts.length) {
      return '**Tus fuentes sí están procesadas, pero falta aprobarlas.**\n\n> [🟠 Estado]\n> ' + sourceNames(drafts) + '\n\nEntra a **⋮ → Conocimiento y Tutor** y pulsa **Aprobar**. No las borres ni las vuelvas a cargar.';
    }
    const pending = rows.filter(asset => asset.status === 'local_ready' || asset.status === 'pending_analysis');
    if (pending.length) {
      return '**Tus fuentes están guardadas, pero aún no terminaron de prepararse.**\n\n> [⏳ Estado]\n> ' + sourceNames(pending) + '\n\nEntra a **⋮ → Conocimiento y Tutor** y pulsa **Analizar**. No necesitas volver a cargarlas.';
    }
    const paused = rows.filter(asset => asset.status === 'approved' && asset.learningEnabled === false);
    if (paused.length) {
      return '**Tus fuentes están aprobadas, pero su uso está pausado.**\n\n> [⏸️ Estado]\n> ' + sourceNames(paused) + '\n\nEntra a **⋮ → Conocimiento y Tutor** y pulsa **Volver a usar**.';
    }
    const blocked = rows.filter(asset => asset.kind === 'pdf' && asset.status === 'blocked');
    if (blocked.length) {
      return '**Encontré el PDF, pero no pude extraer su texto.**\n\n> [⚠️ Requiere OCR o extractor]\n> ' + sourceNames(blocked) + '\n\nNo lo borraré ni fingiré que conozco su contenido.';
    }
    if (rows.length) {
      return '**Encontré tus fuentes, pero ninguna está disponible para responder todavía.**\n\n> [🔎 Revisión necesaria]\n> ' + sourceNames(rows) + '\n\nAbre **⋮ → Conocimiento y Tutor** para ver el estado exacto. No las elimines.';
    }
    return '**No encuentro fuentes guardadas en esta instalación.**\n\nEntra a **⋮ → Conocimiento y Tutor** para comprobar la biblioteca. Si allí tampoco aparecen, la versión anterior no conservó el contenido y recién entonces será necesario cargarlas otra vez.';
  }
  function legacySourceToAsset(source) {
    const rows = (Array.isArray(source?.sections) ? source.sections : []).map((section, index) => ({
      id:clean(section?.id || ('legacy-' + (index + 1)), 120),
      label:clean(section?.label || ('Fragmento ' + (index + 1)), 240),
      text:String(section?.text || '').replace(/\u0000/g, '').trim()
    })).filter(section => section.text).slice(0, MAX_PDF_SECTIONS);
    if (!rows.length) return null;
    const approved = source?.status === 'approved';
    const sourceId = clean(source?.id || source?.sha256 || ('source-' + Date.now()), 150);
    const createdAt = Number(source?.createdAt || Date.now());
    const approvedAt = Number(source?.approvedAt || source?.updatedAt || createdAt);
    return {
      id:'legacy_' + sourceId.replace(/[^a-zA-Z0-9_-]/g, '_'),
      title:clean(source?.title || 'Texto migrado', 140),
      kind:'text',
      mime:clean(source?.mime || 'text/plain', 120),
      bytes:Number(source?.charCount || rows.reduce((total, row) => total + row.text.length, 0)),
      sha256:clean(source?.sha256 || '', 80),
      sections:rows,
      dataUrl:'',
      extraction:{ type:'legacy_text', sections:rows.length, originalHandling:source?.originalHandling || 'not_copied' },
      analysis:approved ? {
        text:'Fuente textual revisada y aprobada por el propietario antes de consolidar la biblioteca.',
        citations:rows.slice(0, 6).map(row => ({ label:row.label, text:row.text.slice(0, 500) })),
        at:approvedAt,
        provider:'legacy_local_migration',
        reviewed:true,
        approvedAt
      } : null,
      status:approved ? 'approved' : 'local_ready',
      learningEnabled:approved,
      provenance:{ source:'yarbi_knowledge_library_v1', sourceId, migratedAt:Date.now(), approvalPreserved:approved },
      createdAt,
      updatedAt:Number(source?.updatedAt || Date.now())
    };
  }
  function planLegacyMigration(legacySources, currentAssets, limit) {
    const existing = Array.isArray(currentAssets) ? currentAssets : [];
    const knownHashes = new Set(existing.map(asset => String(asset?.sha256 || '')).filter(Boolean));
    const knownLegacyIds = new Set(existing.map(asset => String(asset?.provenance?.sourceId || '')).filter(Boolean));
    const capacity = Math.max(0, Number(limit || MAX_ASSETS) - existing.length);
    const planned = [];
    for (const source of Array.isArray(legacySources) ? legacySources : []) {
      const asset = legacySourceToAsset(source);
      if (!asset) continue;
      if (asset.sha256 && knownHashes.has(asset.sha256)) continue;
      if (knownLegacyIds.has(String(asset.provenance?.sourceId || ''))) continue;
      if (planned.length >= capacity) break;
      planned.push(asset);
      if (asset.sha256) knownHashes.add(asset.sha256);
      knownLegacyIds.add(String(asset.provenance?.sourceId || ''));
    }
    return planned;
  }

  function requestTimeoutError() {
    const error = new Error('multimodal_request_timeout');
    error.code = 'multimodal_request_timeout';
    return error;
  }
  async function fetchJsonWithTimeout(url, options, timeoutMs) {
    if (typeof root.fetch !== 'function') throw new Error('multimodal_provider_unavailable');
    const limit = Math.max(50, Math.min(30000, Number(timeoutMs) || GEMINI_REQUEST_TIMEOUT_MS));
    const Controller = root.AbortController || globalThis.AbortController;
    const controller = typeof Controller === 'function' ? new Controller() : null;
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = (root.setTimeout || setTimeout)(() => {
        try { controller?.abort(); } catch (_) {}
        reject(requestTimeoutError());
      }, limit);
    });
    try {
      const request = root.fetch(url, { ...(options || {}), ...(controller ? { signal:controller.signal } : {}) });
      const response = await Promise.race([request, timeout]);
      const data = await response.json().catch(() => ({}));
      return { response, data };
    } catch (error) {
      if (controller?.signal?.aborted || error?.name === 'AbortError' || error?.code === 'multimodal_request_timeout') throw requestTimeoutError();
      throw error;
    } finally {
      if (timer) (root.clearTimeout || clearTimeout)(timer);
    }
  }
  async function requestEmbeddings(texts, taskType, title, timeoutMs) {
    const rows = (Array.isArray(texts) ? texts : []).map(value => clean(value, 4000)).filter(Boolean).slice(0, 24);
    if (!rows.length) throw new Error('semantic_input_required');
    const token = typeof root.gfcAccountFreshAccessToken === 'function' ? await root.gfcAccountFreshAccessToken() : '';
    if (!token) throw new Error('session_required');
    const { response, data } = await fetchJsonWithTimeout((typeof root.gfcRuntimeApiOrigin === 'function' ? root.gfcRuntimeApiOrigin() : '') + '/api/assistant/gemini', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', Authorization:'Bearer ' + token },
      body:JSON.stringify({ operation:'embed', texts:rows, taskType, title:clean(title, 240) })
    }, timeoutMs || GEMINI_REQUEST_TIMEOUT_MS);
    if (!response.ok) {
      const error = new Error(response.status === 504 ? 'multimodal_request_timeout' : 'semantic_provider_unavailable');
      error.status = response.status;
      throw error;
    }
    const embeddings = Array.isArray(data?.embeddings) ? data.embeddings : [];
    if (embeddings.length !== rows.length || embeddings.some(values => !Array.isArray(values) || values.length !== SEMANTIC_DIMENSIONS)) throw new Error('semantic_response_invalid');
    return embeddings;
  }
  function lexicalEvidenceKey(row) { return String(row?.assetId || '') + '|' + String(row?.sectionId || ''); }
  function semanticEvidence(assets, queryVector, lexicalRows, options) {
    const lexical = new Map((Array.isArray(lexicalRows) ? lexicalRows : []).map(row => [lexicalEvidenceKey(row), row]));
    const queryEncoded = encodeEmbedding(queryVector);
    if (!queryEncoded) return [];
    const candidates = [];
    (Array.isArray(assets) ? assets : []).filter(asset => asset.status === 'approved' && asset.learningEnabled !== false).forEach(asset => {
      (Array.isArray(asset.sections) ? asset.sections : []).forEach(section => {
        if (!semanticReady(section)) return;
        const key = String(asset.id || '') + '|' + String(section.id || '');
        const lexicalRow = lexical.get(key);
        const semanticScore = quantizedCosine(queryEncoded, section.semantic.vector);
        const lexicalScore = lexicalRow ? Math.min(1, Number(lexicalRow.score || 0) / 24) : 0;
        const hybridScore = semanticScore * 0.82 + lexicalScore * 0.18;
        if (semanticScore < 0.18 && !lexicalRow) return;
        candidates.push({
          assetId:asset.id,
          title:asset.title,
          kind:asset.kind,
          sourceHash:asset.sha256 || '',
          sectionId:section.id || '',
          sectionLabel:clean(section.label || 'Fragmento sin referencia', 240),
          excerpt:String(section.text || '').slice(0, 1200),
          hits:lexicalRow?.hits || [],
          score:Math.round(hybridScore * 100),
          semanticScore,
          hybridScore
        });
      });
    });
    candidates.sort((a,b) => b.hybridScore - a.hybridScore || b.semanticScore - a.semanticScore);
    const limit = Math.max(1, Math.min(20, Number(options?.limit) || 12));
    const selected = []; const perAsset = new Map(); const pageKeys = new Set();
    for (const row of candidates) {
      const count = perAsset.get(String(row.assetId)) || 0;
      const pageKey = String(row.assetId) + '|' + String(row.sectionLabel);
      if (count >= 5 || pageKeys.has(pageKey) && count >= 3) continue;
      selected.push(row); perAsset.set(String(row.assetId), count + 1); pageKeys.add(pageKey);
      if (selected.length >= limit) break;
    }
    return selected;
  }
  async function semanticSearchApproved(assets, question, options) {
    const approved = (Array.isArray(assets) ? assets : []).filter(asset => asset.status === 'approved' && asset.learningEnabled !== false);
    const lexical = searchApproved(approved, question, { limit:36 });
    if (!approved.some(asset => (asset.sections || []).some(semanticReady))) return { evidence:lexical, mode:'lexical' };
    const key = normalize(question).slice(0, 1400);
    let queryVector = semanticQueryCache.get(key);
    try {
      if (!queryVector) {
        [queryVector] = await requestEmbeddings([question], 'RETRIEVAL_QUERY', '', SEMANTIC_QUERY_TIMEOUT_MS);
        semanticQueryCache.set(key, queryVector);
        while (semanticQueryCache.size > 40) semanticQueryCache.delete(semanticQueryCache.keys().next().value);
      }
      const evidence = semanticEvidence(approved, queryVector, lexical, options);
      return { evidence:evidence.length ? evidence : lexical, mode:evidence.length ? 'semantic' : 'lexical' };
    } catch (_) {
      return { evidence:lexical, mode:'lexical_fallback' };
    }
  }
  function setChatProcess(phase, label) {
    try { if (typeof root.gfcYarbiSetProcessStatus === 'function') root.gfcYarbiSetProcessStatus(phase, label); } catch (_) {}
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
  async function migrateLegacyKnowledge() {
    if (legacyMigrationPromise) return legacyMigrationPromise;
    legacyMigrationPromise = (async () => {
      const legacyApi = root?.YarbiKnowledgeLibrary;
      if (!legacyApi || typeof legacyApi.list !== 'function') return { migrated:0, approved:0, drafts:0, available:false };
      const [legacySources, currentAssets] = await Promise.all([legacyApi.list(), list()]);
      const planned = planLegacyMigration(legacySources, currentAssets, MAX_ASSETS);
      for (const asset of planned) await put(asset);
      return {
        migrated:planned.length,
        approved:planned.filter(asset => asset.status === 'approved').length,
        drafts:planned.filter(asset => asset.status !== 'approved').length,
        available:true
      };
    })().catch(error => ({ migrated:0, approved:0, drafts:0, available:false, error:clean(error?.message || 'legacy_migration_failed', 100) }));
    return legacyMigrationPromise;
  }
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
  async function buildTextAsset(title, value) {
    const text = String(value || '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim();
    if (!text) throw new Error('text_source_required');
    if (text.length > MAX_TEXT) throw new Error('multimodal_text_too_large');
    const sections = sectionsFromText(text);
    if (!sections.length) throw new Error('text_source_required');
    return {
      id:'bke_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
      title:clean(title, 140) || 'Nota de conocimiento',
      kind:'text', mime:'text/plain', bytes:new root.TextEncoder().encode(text).byteLength,
      sha256:await digest(text), sections, dataUrl:'',
      extraction:{ type:'pasted_text', sections:sections.length, originalHandling:'owner_text' },
      analysis:null, status:'local_ready', createdAt:Date.now(), updatedAt:Date.now()
    };
  }
  async function indexSemanticAsset(id, onProgress) {
    let asset = await get(id);
    if (!asset) throw new Error('multimodal_asset_not_found');
    const sections = Array.isArray(asset.sections) ? asset.sections.map(section => ({ ...section })) : [];
    if (!sections.length) throw new Error('semantic_sections_required');
    const pending = sections.map((section, index) => ({ section, index })).filter(row => !semanticReady(row.section));
    if (!pending.length && asset.semanticIndex?.version === SEMANTIC_INDEX_VERSION) return { ok:true, cached:true, indexed:sections.length };
    const total = sections.length;
    let indexed = total - pending.length;
    asset = { ...asset, semanticIndex:{ version:SEMANTIC_INDEX_VERSION, model:'gemini-embedding-001', dimensions:SEMANTIC_DIMENSIONS, status:'indexing', indexedSections:indexed, totalSections:total, updatedAt:Date.now() } };
    await put(asset);
    try {
      for (let offset = 0; offset < pending.length; offset += SEMANTIC_BATCH_SIZE) {
        const batch = pending.slice(offset, offset + SEMANTIC_BATCH_SIZE);
        const vectors = await requestEmbeddings(batch.map(row => '[' + clean(row.section.label || 'Fragmento', 240) + ']\n' + String(row.section.text || '')), 'RETRIEVAL_DOCUMENT', asset.title, 22000);
        batch.forEach((row, position) => {
          sections[row.index] = { ...row.section, semantic:{ version:SEMANTIC_INDEX_VERSION, vector:encodeEmbedding(vectors[position]) } };
        });
        indexed += batch.length;
        asset = { ...asset, sections, semanticIndex:{ ...asset.semanticIndex, status:'indexing', indexedSections:indexed, totalSections:total, updatedAt:Date.now() }, updatedAt:Date.now() };
        const batchNumber = Math.floor(offset / SEMANTIC_BATCH_SIZE) + 1;
        if (batchNumber % 4 === 0 || offset + batch.length >= pending.length) await put(asset);
        if (typeof onProgress === 'function') onProgress({ indexed, total, fraction:indexed / Math.max(1, total) });
      }
      asset = { ...asset, sections, semanticIndex:{ ...asset.semanticIndex, status:'ready', indexedSections:total, totalSections:total, indexedAt:Date.now(), updatedAt:Date.now() }, updatedAt:Date.now() };
      await put(asset);
      return { ok:true, cached:false, indexed:total };
    } catch (error) {
      await put({ ...asset, sections, semanticIndex:{ ...asset.semanticIndex, status:indexed ? 'partial' : 'failed', indexedSections:indexed, totalSections:total, errorCode:clean(error?.message || 'semantic_index_failed', 80), updatedAt:Date.now() }, updatedAt:Date.now() });
      throw error;
    }
  }
  async function upgradeSemanticIndexesInBackground() {
    if (semanticUpgradeRunning) return false;
    semanticUpgradeRunning = true;
    try {
      const token = typeof root.gfcAccountFreshAccessToken === 'function' ? await root.gfcAccountFreshAccessToken() : '';
      if (!token) return false;
      const assets = await list();
      const pending = assets.filter(asset => asset.status === 'approved' && asset.learningEnabled !== false && asset.sections?.length && asset.semanticIndex?.version !== SEMANTIC_INDEX_VERSION);
      for (const asset of pending) {
        try { await indexSemanticAsset(asset.id); } catch (_) { break; }
      }
      await render();
      return true;
    } finally {
      semanticUpgradeRunning = false;
    }
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
    const { response, data } = await fetchJsonWithTimeout((typeof root.gfcRuntimeApiOrigin === 'function' ? root.gfcRuntimeApiOrigin() : '') + '/api/assistant/gemini', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer ' + token }, body:JSON.stringify({ system_instruction:{ parts:[{ text:'Eres el procesador seguro BKE de Yarbi. Solo produces un borrador de conocimiento para revisión del propietario. No alteres CRM, agenda, finanzas, WhatsApp ni memoria permanente.' }] }, contents:[{ role:'user', parts }], generationConfig:{ temperature:0.2, maxOutputTokens:2048 } }) }, 22000);
    if (!response.ok) return { ok:false, code:'multimodal_provider_unavailable', message:'El análisis no terminó (' + response.status + '). La fuente sigue pendiente y no se aprobó.' };
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
  function approvedKnowledgeAssets(assets) {
    return (Array.isArray(assets) ? assets : []).filter(asset => asset.status === 'approved' && asset.learningEnabled !== false && (asset.dataUrl || Array.isArray(asset.sections) && asset.sections.length));
  }
  function sourceCodes(value) {
    return normalize(value).match(/\b(?:ntp|em|iso|rne)\s+\d+(?:\s+\d+){0,3}\b/g) || [];
  }
  function explicitSourceMatches(assets, question) {
    const query = normalize(question);
    const queryTerms = new Set(contentTokens(question));
    const queryCodes = new Set(sourceCodes(question));
    return approvedKnowledgeAssets(assets).filter(asset => {
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
    const groups = retrievalGroups(question);
    return approvedKnowledgeAssets(assets).map(asset => {
      const titleHaystack = normalize(asset.title || '');
      const summary = clean(asset.analysis?.text || asset.analysis?.summary || '', 900);
      const titleHits = matchRetrievalGroups(titleHaystack, groups);
      const summaryHits = matchRetrievalGroups(normalize(summary), groups);
      const rows = searchApproved([asset], question, { limit:6 });
      const covered = new Set([...titleHits.map(group => group.term), ...summaryHits.map(group => group.term), ...rows.flatMap(row => row.hits)]);
      const coverage = groups.length ? covered.size / groups.length : 0;
      const best = Number(rows[0]?.score || 0);
      const score = Math.round(coverage * 100 + best * 5 + titleHits.length * 16 + summaryHits.length * 5);
      return { asset, score, coverage, evidence:rows, summary };
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
    const candidates = approvedKnowledgeAssets(assets);
    if (!candidates.length) return { asset:null, code:'no_approved_source', candidates:[] };
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
        const { response, data } = await fetchJsonWithTimeout((typeof root.gfcRuntimeApiOrigin === 'function' ? root.gfcRuntimeApiOrigin() : '') + '/api/assistant/gemini', {
          method:'POST',
          headers:{ 'Content-Type':'application/json', Authorization:'Bearer ' + token },
          body:JSON.stringify({
            system_instruction:{ parts:[{ text:'Eres el enrutador de fuentes de la biblioteca de Yarbi. Tu única tarea es elegir qué documento debe consultarse. No respondas la pregunta. No inventes fuentes. Si el catálogo no permite decidir, deja selected_asset_id vacío. Devuelve SOLO JSON.' }] },
            contents:[{ role:'user', parts:[{ text:'CONSULTA:\n' + clean(question, 1200) + '\n\nCATÁLOGO DE FUENTES APROBADAS:\n' + JSON.stringify(catalog) + '\n\nDevuelve: {"selected_asset_id":"id exacto o vacío","confidence":"high|medium|low","search_terms":["sinónimos técnicos útiles"],"reason":"motivo breve"}. Elige high o medium solo si el título, resumen o fragmentos son temáticamente pertinentes.' }] }],
            generationConfig:{ temperature:0, maxOutputTokens:400, responseMimeType:'application/json' }
          })
        }, 12000);
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
    const { response, data } = await fetchJsonWithTimeout((typeof root.gfcRuntimeApiOrigin === 'function' ? root.gfcRuntimeApiOrigin() : '') + '/api/assistant/gemini', {
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
    }, GEMINI_REQUEST_TIMEOUT_MS);
    if (!response.ok) return { ok:false, code:response.status === 504 ? 'multimodal_request_timeout' : 'direct_source_provider_unavailable' };
    let result = parseDirectedAnswer(responseText(data));
    if (!result.ok) return { ok:false, code:'direct_source_invalid_response' };
    if (result.found && Array.isArray(asset.sections) && asset.sections.length && !quoteSupportedByAsset(result, asset)) {
      result = { ok:true, found:false, answer:'', quote:'', reference:'', plain:'', caveat:'La cita devuelta no coincide literalmente con el índice local de esta fuente.' };
    }
    const queryCache = [...(Array.isArray(asset.queryCache) ? asset.queryCache : []).filter(item => item?.key !== queryKey), { key:queryKey, result, at:Date.now() }].slice(-40);
    await put({ ...asset, queryCache });
    return { ok:true, cached:false, reply:formatDirectedAnswer(result, asset), result };
  }
  function parseLibraryAnswer(value, allowedIds) {
    const raw = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    let parsed;
    try { parsed = JSON.parse(raw); } catch (_) { return { ok:false, selectedAssetId:'', found:false }; }
    const selectedAssetId = clean(parsed?.selected_asset_id, 180);
    const allowed = new Set((Array.isArray(allowedIds) ? allowedIds : []).map(String));
    if (!selectedAssetId || !allowed.has(selectedAssetId)) return { ok:true, selectedAssetId:'', found:false, caveat:clean(parsed?.caveat || 'No fue posible identificar una fuente suficiente.', 400) };
    return { ...parseDirectedAnswer(raw), selectedAssetId };
  }
  async function queryApprovedLibrary(assets, question, prepared) {
    const candidates = approvedKnowledgeAssets(assets);
    if (!candidates.length) return { ok:false, code:'no_approved_source' };
    const preparedEvidence = Array.isArray(prepared?.evidence) ? prepared.evidence : [];
    const rankings = rankApprovedSources(candidates, question).map(row => {
      const semanticRows = preparedEvidence.filter(item => String(item.assetId) === String(row.asset.id));
      if (!semanticRows.length) return row;
      return {
        ...row,
        evidence:semanticRows,
        coverage:Math.max(Number(row.coverage || 0), 0.86),
        score:Math.max(Number(row.score || 0), Math.round(Number(semanticRows[0]?.hybridScore || 0.5) * 220))
      };
    }).sort((a,b) => b.score - a.score || String(a.asset.title || '').localeCompare(String(b.asset.title || ''), 'es-PE'));
    const explicitMatches = explicitSourceMatches(candidates, question);
    const deterministic = explicitMatches.length === 1
      ? rankings.find(row => String(row.asset.id) === String(explicitMatches[0].id)) || { asset:explicitMatches[0], evidence:searchApproved(explicitMatches, question, { limit:10 }) }
      : candidates.length === 1
        ? rankings[0]
        : localSourceDecision(rankings);

    if (deterministic?.asset) {
      setChatProcess('consulting', 'Revisando ' + clean(deterministic.asset.title, 54));
      const evidence = deterministic.evidence?.length ? deterministic.evidence : searchApproved([deterministic.asset], question, { limit:12 });
      if (evidence.length) {
        const queryKey = 'library-v4|' + normalize(question).slice(0, 1200);
        const cached = (Array.isArray(deterministic.asset.queryCache) ? deterministic.asset.queryCache : []).find(item => item?.key === queryKey && item?.result?.ok);
        if (cached) return { ok:true, cached:true, reply:formatDirectedAnswer(cached.result, deterministic.asset), result:cached.result, asset:deterministic.asset };
        const result = await askTutor(question, { assets:[deterministic.asset], evidence });
        if (!result.ok) return { ok:false, code:'library_provider_unavailable' };
        const refreshed = await get(deterministic.asset.id) || deterministic.asset;
        const parsed = result.result || null;
        if (parsed?.ok) {
          const queryCache = [...(Array.isArray(refreshed.queryCache) ? refreshed.queryCache : []).filter(item => item?.key !== queryKey), { key:queryKey, result:parsed, at:Date.now() }].slice(-60);
          await put({ ...refreshed, queryCache });
        }
        return { ok:true, reply:result.text, result, asset:deterministic.asset };
      }
      if (deterministic.asset.kind === 'pdf' && deterministic.asset.dataUrl) return queryApprovedSource(deterministic.asset, question);
      return { ok:false, code:'library_evidence_missing', candidates:[deterministic.asset] };
    }

    const rows = rankings.slice(0, 5).filter(row => row.evidence?.length);
    if (!rows.length) return { ok:false, code:'source_ambiguous', candidates:rankings.slice(0, 4).map(row => row.asset) };
    const token = typeof root.gfcAccountFreshAccessToken === 'function' ? await root.gfcAccountFreshAccessToken() : '';
    if (!token) return { ok:false, code:'session_required' };
    const catalog = rows.map(row => ({
      asset_id:String(row.asset.id || ''),
      title:clean(row.asset.title, 160),
      fragments:row.evidence.slice(0, 3).map(item => ({ reference:item.sectionLabel, text:clean(item.excerpt, 600) }))
    }));
    setChatProcess('consulting', 'Buscando la cita exacta en tus normas');
    const { response, data } = await fetchJsonWithTimeout((typeof root.gfcRuntimeApiOrigin === 'function' ? root.gfcRuntimeApiOrigin() : '') + '/api/assistant/gemini', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', Authorization:'Bearer ' + token },
      body:JSON.stringify({
        system_instruction:{ parts:[{ text:'Eres el buscador documental de Yarbi. Resuelve la consulta en una sola pasada usando exclusivamente los fragmentos aprobados. Primero identifica la fuente correcta y luego responde. Devuelve SOLO JSON válido. No mezcles normas, no uses conocimiento externo y no inventes citas ni numerales.' }] },
        contents:[{ role:'user', parts:[{ text:('CONSULTA:\n' + clean(question, 1200) + '\n\nFUENTES Y FRAGMENTOS APROBADOS:\n' + JSON.stringify(catalog) + '\n\nDevuelve {"selected_asset_id":"id exacto o vacío","found":true|false,"answer":"respuesta directa en máximo 38 palabras","exact_quote":"cita literal única","reference":"capítulo, numeral o página","plain_explanation":"explicación sencilla en máximo 42 palabras","caveat":"condición relevante o vacío"}. found=true exige una cita literal presente en los fragmentos de la fuente elegida.').slice(0, 15800) }] }],
        generationConfig:{ temperature:0, maxOutputTokens:750, responseMimeType:'application/json' }
      })
    }, GEMINI_REQUEST_TIMEOUT_MS);
    if (!response.ok) return { ok:false, code:response.status === 504 ? 'multimodal_request_timeout' : 'library_provider_unavailable' };
    let result = parseLibraryAnswer(responseText(data), candidates.map(asset => asset.id));
    const selected = candidates.find(asset => String(asset.id) === String(result.selectedAssetId));
    if (!result.ok || !selected) return { ok:false, code:'source_ambiguous', candidates:rankings.slice(0, 4).map(row => row.asset) };
    if (result.found && !quoteSupportedByAsset(result, selected)) {
      result = { ok:true, selectedAssetId:selected.id, found:false, answer:'', quote:'', reference:'', plain:'', caveat:'La cita recibida no coincide literalmente con el índice local de la fuente seleccionada.' };
    }
    const queryKey = 'library-v4|' + normalize(question).slice(0, 1200);
    const queryCache = [...(Array.isArray(selected.queryCache) ? selected.queryCache : []).filter(item => item?.key !== queryKey), { key:queryKey, result, at:Date.now() }].slice(-40);
    await put({ ...selected, queryCache });
    return { ok:true, reply:formatDirectedAnswer(result, selected), result, asset:selected };
  }
  async function askTutor(question, prepared) {
    const text = clean(question, 1200); if (!text) throw new Error('tutor_question_required');
    const assets = Array.isArray(prepared?.assets) ? prepared.assets : await list();
    const evidence = Array.isArray(prepared?.evidence) ? prepared.evidence : searchApproved(assets, text);
    const context = evidence.map(row => '[' + row.title + ' · ' + row.sectionLabel + '] ' + row.excerpt).join('\n');
    const token = typeof root.gfcAccountFreshAccessToken === 'function' ? await root.gfcAccountFreshAccessToken() : '';
    if (!token) return { ok:false, message:'Inicia sesión para usar el tutor. Tus fuentes aprobadas siguen guardadas localmente.' };
    if (!evidence.length) return { ok:false, message:'No encontré una cita aprobada que respalde esta respuesta. No inventaré una referencia técnica; carga y aprueba la norma primero.' };
    const { response, data } = await fetchJsonWithTimeout((typeof root.gfcRuntimeApiOrigin === 'function' ? root.gfcRuntimeApiOrigin() : '') + '/api/assistant/gemini', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer ' + token }, body:JSON.stringify({ system_instruction:{ parts:[{ text:'Eres el Tutor personal de Yarbi. Usa exclusivamente la evidencia aprobada. Devuelve SOLO JSON válido: {"found":true|false,"answer":"conclusión directa en máximo 45 palabras","exact_quote":"una única cita literal que responda la consulta","reference":"capítulo, numeral o página exacta de la evidencia","plain_explanation":"explicación sencilla en máximo 55 palabras","caveat":"condición relevante o vacío"}. No agregues introducciones, listas extensas ni conocimiento general. found=true requiere cita y referencia. Nunca ejecutes acciones ni guardes aprendizajes.' }] }, contents:[{ role:'user', parts:[{ text:'Pregunta del propietario:\n' + text + '\n\nEvidencia aprobada disponible:\n' + context }] }], generationConfig:{ temperature:0.1, maxOutputTokens:700, responseMimeType:'application/json' } }) }, GEMINI_REQUEST_TIMEOUT_MS);
    if (!response.ok) return { ok:false, message:'El tutor no está disponible ahora. No inventé una explicación.' };
    const parsed = parseDirectedAnswer(responseText(data));
    const sourceAsset = assets.find(asset => String(asset.id) === String(evidence[0]?.assetId)) || { title:evidence[0]?.title, sha256:evidence[0]?.sourceHash };
    if (!parsed.ok || parsed.found && !quoteSupportedByEvidence(parsed, evidence)) {
      return { ok:true, text:formatDirectedAnswer({ found:false, caveat:'La respuesta recibida no pudo verificarse literalmente contra los fragmentos recuperados.' }, sourceAsset), evidence:[] };
    }
    return { ok:true, text:formatDirectedAnswer(parsed, sourceAsset), result:parsed, evidence:evidence.map(row => ({ title:row.title, assetId:row.assetId, sectionLabel:row.sectionLabel })) };
  }
  async function answerFromChat(question) {
    const text = clean(question, 1200);
    if (!text) return { handled:false };
    let assets;
    try { await migrateLegacyKnowledge(); assets = await list(); }
    catch (_) { return knowledgeIntent(text) ? { handled:true, reply:'## 📚 Biblioteca no disponible\n\nNo pude abrir ahora las fuentes guardadas en este dispositivo. No inventaré una respuesta ni consultaré otro entorno.' } : { handled:false }; }
    const explicit = knowledgeIntent(text);
    let evidence = searchApproved(assets, text);
    const terms = contentTokens(text);
    const minimumHits = terms.length > 1 ? 2 : 1;
    const strongMatch = evidence.some(row => Number(row.score || 0) >= minimumHits);
    const semanticAvailable = assets.some(asset => asset.status === 'approved' && asset.learningEnabled !== false && (asset.sections || []).some(semanticReady));
    if (!evidence.length && explicit && terms.length === 0) evidence = firstApprovedEvidence(assets);
    if (!explicit && !strongMatch && (!semanticAvailable || obviousBusinessIntent(text))) return { handled:false };
    if (explicit || strongMatch || semanticAvailable) {
      try {
        setChatProcess('consulting', 'Interpretando el significado de tu pregunta');
        const semantic = await semanticSearchApproved(assets, text, { limit:14 });
        const semanticStrong = semantic.mode === 'semantic' && Number(semantic.evidence?.[0]?.semanticScore || -1) >= 0.48;
        if (!explicit && !strongMatch && !semanticStrong) return { handled:false };
        const libraryResult = await queryApprovedLibrary(assets, text, semantic);
        if (libraryResult.ok) {
          setChatProcess('writing', 'Ordenando la respuesta verificada');
          return { handled:true, reply:libraryResult.reply, directSource:true, cached:!!libraryResult.cached, sourceRouted:true };
        }
        if (libraryResult.code === 'source_ambiguous' || libraryResult.code === 'library_evidence_missing') {
          const names = (libraryResult.candidates || []).slice(0, 4).map(asset => '**' + clean(asset.title, 100) + '**').join(', ');
          return { handled:true, reply:'**Necesito una pista para elegir la norma correcta.**\n\n' + (names ? '> [📚 Fuentes posibles]\n> ' + names + '\n\n' : '') + 'Dime el nombre de la norma, el tema o un numeral. No mezclaré documentos por una coincidencia débil.' };
        }
        if (libraryResult.code === 'no_approved_source' || libraryResult.code === 'no_approved_pdf') return { handled:true, reply:libraryAvailabilityReply(assets) };
        if (libraryResult.code === 'session_required') return { handled:true, reply:'**Inicia sesión para consultar tus normas.**\n\nLa biblioteca local permanece guardada y no se usó otro entorno.' };
        if (libraryResult.code === 'multimodal_request_timeout') return { handled:true, reply:'**La consulta tardó demasiado y la detuve.**\n\n> [⏱️ Límite seguro]\n> Tus PDF siguen guardados. Yarbi no quedó bloqueado, no cambió de fuente y no inventó una respuesta.' };
        return { handled:true, reply:'**No pude terminar la consulta documental ahora.**\n\n> [⏱️ Respuesta segura]\n> La búsqueda se detuvo sin cambiar de norma ni inventar una cita. Puedes reintentar; tus PDF siguen guardados.' };
      } catch (error) {
        if (error?.code === 'multimodal_request_timeout' || error?.message === 'multimodal_request_timeout') {
          return { handled:true, reply:'**La consulta tardó demasiado y la detuve.**\n\n> [⏱️ Límite seguro]\n> Tus PDF siguen guardados. Yarbi no quedó bloqueado, no cambió de fuente y no inventó una respuesta.' };
        }
        return { handled:true, reply:'**No pude completar la búsqueda en tus normas.**\n\n> [⚠️ Sin respuesta inventada]\n> Conservé la biblioteca y cerré el proceso para que puedas seguir usando el chat.' };
      }
    }
    if (!evidence.length) {
      const approved = assets.filter(asset => asset.status === 'approved');
      if (explicit && approved.length > 1) {
        const names = approved.slice(0, 4).map(asset => '**' + clean(asset.title, 100) + '**').join(', ');
        return { handled:true, reply:'**Necesito una pista sobre la fuente.**\n\n> [📚 Fuentes aprobadas]\n> ' + names + '\n\nDime el nombre, el tema o el numeral para citar sin mezclar documentos.' };
      }
      const drafts = assets.filter(asset => asset.status === 'analyzed_draft');
      if (drafts.length) {
        const names = drafts.slice(0, 3).map(asset => '**' + clean(asset.title, 100) + '**').join(', ');
        return { handled:true, reply:'**Fuente procesada, aprobación pendiente.**\n\nEncontré ' + names + '. Para usarla aquí: **⋮ → Conocimiento y Tutor → Aprobar para tutoría**. No usaré su contenido como conocimiento definitivo hasta que lo apruebes.' };
      }
      return { handled:true, reply:libraryAvailabilityReply(assets) };
    }
    const result = await askTutor(text, { assets, evidence });
    if (result.ok) return { handled:true, reply:result.text, evidence:result.evidence };
    return {
      handled:true,
      reply:'**Encontré evidencia local, pero no pude completar la explicación.**\n\n' + citationMarkdown(evidence),
      evidence:evidence.map(row => ({ title:row.title, assetId:row.assetId, sectionLabel:row.sectionLabel })),
      degraded:true
    };
  }
  function statusText(error) { return ({ unsupported_multimodal_type:'Formato no compatible.', text_source_required:'Escribe una nota o instrucción antes de guardarla.', multimodal_text_too_large:'El texto supera el límite local de 200.000 caracteres.', multimodal_file_too_large:'El archivo supera el límite local de 40 MB para audio, video o imagen.', multimodal_pdf_too_large:'El PDF supera el límite seguro de 120 MB para este dispositivo.', multimodal_pdf_page_limit:'El PDF supera 2.500 páginas y no se procesó para proteger la memoria del teléfono.', multimodal_pdf_index_limit:'El texto del PDF supera el límite seguro de indexación local.', multimodal_pdf_no_text:'El PDF no contiene texto extraíble. Puede ser un escaneo y necesita OCR.', multimodal_asset_limit:'La biblioteca local alcanzó 80 fuentes.', multimodal_storage_unavailable:'El almacenamiento local no está disponible.', extractor_required:'Este archivo necesita un extractor autorizado.', session_required:'Inicia sesión para crear el índice semántico.', semantic_provider_unavailable:'La comprensión semántica no está disponible ahora. El avance local permanece guardado.', semantic_response_invalid:'El proveedor devolvió un índice incompleto. No se usó.', semantic_sections_required:'Esta fuente aún no tiene fragmentos de texto para indexar.' }[error?.message] || error?.message || 'No pude procesar la fuente.'); }
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
    const semanticReadyState = asset.semanticIndex?.version === SEMANTIC_INDEX_VERSION && asset.semanticIndex?.status === 'ready';
    const semantic = asset.sections?.length
      ? '<div class="gfc-mm-index-meta">' + (semanticReadyState ? '🧠 Índice semántico listo · interpreta significado' : asset.semanticIndex?.status === 'partial' ? '🟠 Índice semántico parcial · puede reanudarse' : '⚪ Índice semántico pendiente') + '</div>'
      : '';
    const primaryAction = asset.status === 'analyzed_draft'
      ? '<button class="gfc-mm-btn primary" onclick="gfcYarbiMultimodalApprove(\'' + id + '\')">Aprobar</button>'
      : asset.status === 'approved'
        ? '<button class="gfc-mm-btn" onclick="gfcYarbiMultimodalToggleLearning(\'' + id + '\',' + (!enabled) + ')">' + (enabled ? 'Pausar uso' : 'Volver a usar') + '</button>'
        : '<button class="gfc-mm-btn primary" onclick="gfcYarbiMultimodalAnalyze(\'' + id + '\')">Analizar</button>';
    const semanticAction = asset.sections?.length && !semanticReadyState ? '<button class="gfc-mm-btn" onclick="gfcYarbiMultimodalSemanticIndex(\'' + id + '\')">Mejorar búsqueda</button>' : '';
    return '<article class="gfc-mm-card"><div class="gfc-mm-card-head"><span class="gfc-mm-kind">' + ({ text:'📝', pdf:'📕', image:'🖼️', audio:'🎙️', video:'🎬' }[asset.kind] || '📎') + '</span><div class="gfc-mm-file-main"><b title="' + escapeHtml(asset.title) + '">' + escapeHtml(asset.title) + '</b><small>' + kindLabel(asset.kind) + ' · ' + formatBytes(asset.bytes) + '</small></div><span class="gfc-mm-state ' + statusTone + '">' + escapeHtml(status) + '</span></div>' + semantic + '<div class="gfc-mm-actions">' + primaryAction + semanticAction + '<button class="gfc-mm-btn danger" onclick="gfcYarbiMultimodalDelete(\'' + id + '\')" aria-label="Borrar ' + escapeHtml(asset.title) + '">Borrar</button><details class="gfc-mm-more"><summary>Detalles</summary><div class="gfc-mm-details-body">' + extraction + analysis + '<small>SHA-256 ' + escapeHtml(String(asset.sha256 || '').slice(0, 16)) + '…</small></div></details></div></article>';
  }
  async function render() { const target = root?.document?.getElementById('gfc-mm-list'); if (!target) return; try { const rows = await list(); target.innerHTML = rows.length ? rows.map(card).join('') : '<p>Aún no hay fuentes multimodales. Puedes cargar documentos, imágenes, audios o videos.</p>'; } catch (_) { target.innerHTML = '<p>No se pudo abrir la biblioteca local.</p>'; } }
  function setStatus(message, error) { const target = root?.document?.getElementById('gfc-mm-status'); if (target) { target.textContent = message; target.dataset.tone = error ? 'error' : 'normal'; } }
  async function importTextFromUi(autoAnalyze = true) {
    const titleInput = root?.document?.getElementById('gfc-mm-text-title');
    const textInput = root?.document?.getElementById('gfc-mm-text-value');
    try {
      const asset = await buildTextAsset(titleInput?.value || 'Nota de conocimiento', textInput?.value || '');
      const assets = await list();
      if (assets.some(row => asset.sha256 && row.sha256 === asset.sha256)) {
        setStatus('Ese texto ya existe en la biblioteca. No se creó un duplicado.', false);
        return { ok:true, duplicate:true };
      }
      if (assets.length >= MAX_ASSETS) throw new Error('multimodal_asset_limit');
      await put(asset);
      if (textInput) textInput.value = '';
      if (titleInput) titleInput.value = '';
      await render();
      if (!autoAnalyze) {
        setProgress(100, 'Texto guardado', 'Quedó pendiente de análisis y aprobación.', 'complete');
        setStatus('La nota está en la biblioteca canónica. Pulsa “Analizar” cuando quieras prepararla.', false);
        return { ok:true, assetId:asset.id, analyzed:false };
      }
      let semanticPending = false;
      try {
        await indexSemanticAsset(asset.id, state => setProgress(Math.max(2, Number(state?.fraction || 0) * 55), 'Comprendiendo el texto', 'Fragmento ' + state.indexed + ' de ' + state.total, 'working'));
      } catch (_) { semanticPending = true; }
      startEstimatedAnalysis(asset.title, 58);
      const result = await analyze(asset.id);
      clearProgressTimer();
      if (!result.ok) {
        setProgress(100, 'Texto guardado', result.message || 'El análisis queda pendiente.', 'pending_review');
        setStatus(result.message || 'La fuente quedó guardada y pendiente de análisis.', false);
        return { ok:true, assetId:asset.id, analyzed:false, semanticPending };
      }
      setProgress(100, 'Borrador listo', 'Revisa el contenido y pulsa “Aprobar”.', 'pending_review');
      setStatus('La nota se procesó una sola vez. Falta tu aprobación para que Yarbi la use.', false);
      await render();
      return { ok:true, assetId:asset.id, analyzed:true, semanticPending };
    } catch (error) {
      clearProgressTimer();
      setProgress(0, 'No se pudo guardar', statusText(error), 'error');
      setStatus(statusText(error), true);
      return { ok:false, message:statusText(error) };
    }
  }
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
          let sourcePending = false;
          if (asset.sections?.length) {
            try {
              await indexSemanticAsset(asset.id, state => {
                const sourceProgress = (index + Number(state?.fraction || 0) * 0.55) / Math.max(1, rows.length);
                setProgress(72 + sourceProgress * 16, 'Comprendiendo significado', 'Fragmento ' + state.indexed + ' de ' + state.total + ' · ' + clean(asset.title, 80), 'working');
              });
            } catch (_) { sourcePending = true; }
          }
          startEstimatedAnalysis(asset.title, 24 + Math.round(index / Math.max(1, rows.length) * 24));
          const result = await analyze(asset.id);
          clearProgressTimer();
          if (result.ok) analyzed += 1; else sourcePending = true;
          if (sourcePending) pending += 1;
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
  async function semanticIndexFromUi(id) {
    const asset = await get(id).catch(() => null);
    if (!asset) return { ok:false };
    setProgress(1, 'Preparando comprensión semántica', clean(asset.title, 90), 'working');
    setStatus('Yarbi convertirá cada fragmento en un índice de significado. Este proceso se realiza una vez.', false);
    try {
      const result = await indexSemanticAsset(id, state => setProgress(Math.max(2, Number(state?.fraction || 0) * 100), 'Comprendiendo significado', 'Fragmento ' + state.indexed + ' de ' + state.total, 'working'));
      setProgress(100, result.cached ? 'Índice ya disponible' : 'Índice semántico listo', result.indexed + ' fragmentos preparados para consultas por significado.', 'complete');
      setStatus('Yarbi ya puede encontrar ideas equivalentes aunque uses palabras diferentes.', false);
      await render();
      return result;
    } catch (error) {
      setProgress(0, 'Índice incompleto', statusText(error), 'error');
      setStatus('El avance quedó guardado y puede reanudarse. ' + statusText(error), true);
      await render();
      return { ok:false, message:statusText(error) };
    }
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
  function mountCanonicalTextImport() {
    const anchor = root?.document?.getElementById('gfc-mm-status');
    if (!anchor || root.document.getElementById('gfc-mm-text-import')) return;
    anchor.insertAdjacentHTML('afterend', '<div id="gfc-mm-migration-status" class="gfc-yarbi-import-summary" hidden></div><details id="gfc-mm-text-import" class="gfc-mm-more gfc-mm-text-import"><summary>✍️ Agregar una nota o instrucción escrita</summary><div class="gfc-mm-details-body"><input id="gfc-mm-text-title" maxlength="140" placeholder="Título de la fuente"><textarea id="gfc-mm-text-value" rows="6" maxlength="200000" placeholder="Pega aquí un procedimiento, regla o material de referencia. Se guardará como borrador hasta que lo apruebes."></textarea><div class="gfc-mm-primary-actions"><button class="gfc-yarbi-primary" onclick="gfcYarbiMultimodalImportText(true)">Guardar y procesar</button><button class="gfc-yarbi-secondary" onclick="gfcYarbiMultimodalImportText(false)">Solo guardar</button></div></div></details>');
  }
  function html() { return '<main class="gfc-yarbi-tool-page gfc-mm-page"><section class="gfc-mm-hero"><span>📚</span><div><h2>Conocimiento y Tutor</h2><p>Yarbi procesa cada fuente una vez y luego busca por significado, no solo por palabras.</p></div></section><section class="gfc-yarbi-tool-card"><div class="gfc-mm-steps"><span><b>1</b> Elegir</span><span><b>2</b> Comprender</span><span><b>3</b> Revisar</span><span><b>4</b> Aprobar</span></div><label class="gfc-mm-picker" for="gfc-mm-input"><span class="gfc-mm-picker-icon">⌕</span><div><b>Buscar archivos en el teléfono</b><small>PDF de hasta 120 MB: Yarbi extrae páginas y crea un índice semántico persistente. Los PDF escaneados sin texto requieren OCR.</small><em id="gfc-mm-selected">Ningún archivo seleccionado</em></div><input id="gfc-mm-input" type="file" multiple onchange="gfcYarbiMultimodalFilesChosen(this.files)" accept=".txt,.md,.csv,.json,.xml,.pdf,.jpg,.jpeg,.png,.webp,.heic,.mp3,.m4a,.wav,.ogg,.aac,.mp4,.mov,.webm,text/plain,application/pdf,image/*,audio/*,video/*"></label><div class="gfc-mm-primary-actions"><button class="gfc-yarbi-primary" onclick="gfcYarbiMultimodalImport()">Agregar y procesar</button><button class="gfc-yarbi-secondary" onclick="gfcYarbiMultimodalSaveOnly()">Solo guardar</button></div><section id="gfc-mm-progress" class="gfc-mm-progress-card" data-tone="working" hidden aria-live="polite"><div class="gfc-mm-progress-head"><span id="gfc-mm-progress-chip" class="gfc-mm-progress-chip">Procesando archivo</span><strong id="gfc-mm-progress-percent">0%</strong></div><div class="gfc-mm-progress-track"><i id="gfc-mm-progress-bar"></i></div><p id="gfc-mm-progress-detail">Preparando…</p></section><div id="gfc-mm-status" class="gfc-yarbi-import-summary">El índice semántico queda en este teléfono para consultas rápidas. La aprobación es obligatoria antes de usar una fuente y no se ejecutan acciones comerciales durante el procesamiento.</div></section><section class="gfc-yarbi-tool-card"><div class="gfc-yarbi-tool-title">Fuentes de esta biblioteca</div><div id="gfc-mm-list"></div></section><section class="gfc-yarbi-tool-card"><div class="gfc-yarbi-tool-title">🎓 Preguntar al Tutor</div><div class="gfc-yarbi-tool-copy">Pregunta con tus propias palabras. Yarbi interpreta la intención, responde primero de forma breve y muestra la cita con capítulo, numeral o página.</div><textarea id="gfc-mm-tutor-question" rows="3" placeholder="Ejemplo: ¿Puedo usar una sola llave para alimentar dos equipos?"></textarea><button class="gfc-yarbi-primary" onclick="gfcYarbiTutorAsk()">Preguntar al tutor</button><article id="gfc-mm-tutor-answer" class="gfc-mm-tutor-answer">Aquí aparecerá una explicación respaldada por tus fuentes aprobadas.</article></section></main>'; }
  function attach() {
    mountCanonicalTextImport();
    void (async () => {
      const migration = await migrateLegacyKnowledge();
      const notice = root?.document?.getElementById('gfc-mm-migration-status');
      if (notice && migration.migrated) {
        notice.hidden = false;
        notice.textContent = '✓ ' + migration.migrated + ' fuente(s) anterior(es) integradas sin duplicar ni borrar la biblioteca original.';
      }
      await render();
      if (root?.setTimeout) root.setTimeout(() => { void upgradeSemanticIndexesInBackground(); }, 900);
    })();
  }
  return Object.freeze({ classifyFile, normalize, contentTokens, retrievalGroups, knowledgeIntent, obviousBusinessIntent, sectionsFromText, pdfPageSections, upgradeBlockedDuplicate, searchApproved, semanticEvidence, semanticSearchApproved, normalizeEmbedding, encodeEmbedding, quantizedCosine, firstApprovedEvidence, responseText, parseStructuredAnalysis, parseDirectedAnswer, parseLibraryAnswer, formatDirectedAnswer, libraryAvailabilityReply, legacySourceToAsset, planLegacyMigration, migrateLegacyKnowledge, citationMarkdown, citationListMarkdown, quoteSupportedByAsset, approvedPdfAssets, approvedKnowledgeAssets, sourceCodes, explicitSourceMatches, rankApprovedSources, parseSourceRoute, localSourceDecision, routeApprovedSource, selectApprovedDirectAsset, queryApprovedSource, queryApprovedLibrary, fetchJsonWithTimeout, requestEmbeddings, buildAsset, buildTextAsset, importFiles, indexSemanticAsset, list, analyze, approve, toggleLearning, removeAsset, askTutor, answerFromChat, html, attach, render, analyzeFromUi, semanticIndexFromUi, approveFromUi, toggleLearningFromUi, deleteFromUi, importFromUi, importTextFromUi, askTutorFromUi, filesChosen, setProgress, formatBytes, MAX_INLINE_BYTES, MAX_PDF_FILE_BYTES, GEMINI_REQUEST_TIMEOUT_MS, SEMANTIC_INDEX_VERSION, SEMANTIC_DIMENSIONS });
}));
