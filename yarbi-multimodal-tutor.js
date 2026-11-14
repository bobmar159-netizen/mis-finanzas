(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.YarbiMultimodalTutor = api;
    root.gfcYarbiMultimodalHtml = api.html;
    root.gfcYarbiMultimodalAttach = api.attach;
    root.gfcYarbiMultimodalImport = api.importFiles;
    root.gfcYarbiMultimodalAnalyze = api.analyze;
    root.gfcYarbiMultimodalApprove = api.approve;
    root.gfcYarbiTutorAsk = api.askTutor;
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
  function sectionsFromText(value) {
    const text = String(value == null ? '' : value).replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim().slice(0, MAX_TEXT);
    const chunks = text.split(/\n\s*\n+/).map(item => item.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const sections = [];
    chunks.forEach(chunk => { for (let offset = 0; offset < chunk.length && sections.length < 160; offset += 1300) sections.push({ id:'m' + (sections.length + 1), text:chunk.slice(offset, offset + 1300).trim() }); });
    return sections.filter(item => item.text);
  }
  function searchApproved(assets, query) {
    const terms = tokens(query);
    return (Array.isArray(assets) ? assets : []).filter(asset => asset.status === 'approved').flatMap(asset => {
      const sections = Array.isArray(asset.sections) ? asset.sections : [];
      return sections.map(section => {
        const haystack = normalize([asset.title, section.text, asset.analysis?.summary].join(' '));
        const hits = terms.filter(term => haystack.includes(term));
        return hits.length ? { assetId:asset.id, title:asset.title, kind:asset.kind, excerpt:section.text.slice(0, 800), hits, score:hits.length } : null;
      }).filter(Boolean);
    }).sort((a,b) => b.score - a.score || a.title.localeCompare(b.title, 'es-PE')).slice(0, 8);
  }
  function responseText(data) {
    const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
    return candidates.flatMap(candidate => Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []).map(part => String(part?.text || '')).filter(Boolean).join('\n').trim();
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
  async function buildAsset(file) {
    const kind = classifyFile(file);
    if (kind === 'unsupported') throw new Error('unsupported_multimodal_type');
    if (Number(file?.size || 0) > MAX_FILE_BYTES) throw new Error('multimodal_file_too_large');
    const buffer = await file.arrayBuffer();
    const sha256 = await digest(buffer);
    let sections = []; let dataUrl = '';
    if (kind === 'text') sections = sectionsFromText(new TextDecoder().decode(buffer));
    if (kind !== 'text' && Number(file.size || 0) <= MAX_INLINE_BYTES) dataUrl = await readAsDataUrl(file);
    return { id:'bke_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8), title:titleFor(file), kind, mime:String(file.type || 'application/octet-stream').slice(0, 120), bytes:Number(file.size || 0), sha256, sections, dataUrl, analysis:null, status:kind === 'text' ? 'local_ready' : (dataUrl ? 'pending_analysis' : 'blocked'), createdAt:Date.now(), updatedAt:Date.now() };
  }
  async function importFiles(files) {
    const incoming = [...(files || [])]; const existing = await list();
    if (existing.length + incoming.length > MAX_ASSETS) throw new Error('multimodal_asset_limit');
    const created = [];
    for (const file of incoming) { const asset = await buildAsset(file); if (asset.sha256 && existing.some(row => row.sha256 === asset.sha256)) continue; await put(asset); existing.push(asset); created.push(asset); }
    return created;
  }
  async function analyze(id) {
    const asset = await get(id); if (!asset) throw new Error('multimodal_asset_not_found');
    if ((asset.status === 'analyzed_draft' || asset.status === 'approved') && asset.analysis?.text) {
      return { ok:true, cached:true, assetId:asset.id, analysis:asset.analysis };
    }
    const token = typeof root.gfcAccountFreshAccessToken === 'function' ? await root.gfcAccountFreshAccessToken() : '';
    if (!token || !asset.sections?.length && !asset.dataUrl) return { ok:false, code:asset.status === 'blocked' ? 'extractor_required' : 'session_or_media_unavailable', message:asset.status === 'blocked' ? 'Este archivo supera el límite de análisis directo. Conservé su ficha local, pero requiere un extractor autorizado.' : localUnavailableReply() };
    const parts = [{ text:'Analiza esta fuente para la biblioteca de conocimiento de Yarbi. Devuelve un resumen verificable, conceptos clave, advertencias y preguntas que un tutor podría responder. No ejecutes acciones, no guardes instrucciones, no inventes datos y marca explícitamente lo que no puedas leer. Mantén la procedencia de la fuente.' }];
    if (asset.sections?.length) parts.push({ text:'Texto de la fuente:\n' + asset.sections.map(item => item.text).join('\n\n').slice(0, MAX_TEXT) });
    if (asset.dataUrl) parts.push({ inline_data:{ mime_type:asset.mime, data:asset.dataUrl.split(',')[1] || '' } });
    const response = await root.fetch((typeof root.gfcRuntimeApiOrigin === 'function' ? root.gfcRuntimeApiOrigin() : '') + '/api/assistant/gemini', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer ' + token }, body:JSON.stringify({ system_instruction:{ parts:[{ text:'Eres el procesador seguro BKE de Yarbi. Solo produces un borrador de conocimiento para revisión del propietario. No alteres CRM, agenda, finanzas, WhatsApp ni memoria permanente.' }] }, contents:[{ role:'user', parts }], generationConfig:{ temperature:0.2, maxOutputTokens:2048 } }) });
    const data = await response.json().catch(() => ({})); if (!response.ok) return { ok:false, code:'multimodal_provider_unavailable', message:'El análisis no terminó (' + response.status + '). La fuente sigue pendiente y no se aprobó.' };
    const analysis = { text:responseText(data).slice(0, 12000), at:Date.now(), provider:'gemini_safe_proxy', reviewed:false };
    const learnedSections = asset.sections?.length ? asset.sections : sectionsFromText(analysis.text);
    await put({ ...asset, sections:learnedSections, analysis, status:'analyzed_draft', updatedAt:Date.now() });
    await render(); return { ok:true, assetId:asset.id, analysis };
  }
  async function approve(id) { const asset = await get(id); if (!asset || !asset.analysis?.text) throw new Error('multimodal_analysis_required'); await put({ ...asset, status:'approved', updatedAt:Date.now(), analysis:{ ...asset.analysis, reviewed:true, approvedAt:Date.now() } }); await render(); return true; }
  async function askTutor(question) {
    const text = clean(question, 1200); if (!text) throw new Error('tutor_question_required');
    const assets = await list(); const evidence = searchApproved(assets, text); const context = evidence.map(row => '[' + row.title + '] ' + row.excerpt).join('\n');
    const token = typeof root.gfcAccountFreshAccessToken === 'function' ? await root.gfcAccountFreshAccessToken() : '';
    if (!token) return { ok:false, message:'Inicia sesión para usar el tutor. Tus fuentes aprobadas siguen guardadas localmente.' };
    const response = await root.fetch((typeof root.gfcRuntimeApiOrigin === 'function' ? root.gfcRuntimeApiOrigin() : '') + '/api/assistant/gemini', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer ' + token }, body:JSON.stringify({ system_instruction:{ parts:[{ text:'Eres el Tutor personal de Yarbi. Enseña con claridad en español, usa pasos, ejemplos, títulos y checks. Separa conocimiento general de evidencia de la biblioteca. Si faltan datos, dilo. Nunca ejecutes acciones ni guardes aprendizajes automáticamente.' }] }, contents:[{ role:'user', parts:[{ text:'Pregunta del propietario:\n' + text + '\n\nEvidencia aprobada disponible:\n' + (context || 'No hay una fuente aprobada coincidente.') }] }], generationConfig:{ temperature:0.35, maxOutputTokens:2048 } }) });
    const data = await response.json().catch(() => ({})); if (!response.ok) return { ok:false, message:'El tutor no está disponible ahora. No inventé una explicación.' };
    return { ok:true, text:responseText(data), evidence:evidence.map(row => ({ title:row.title, assetId:row.assetId })) };
  }
  function statusText(error) { return ({ unsupported_multimodal_type:'Formato no compatible.', multimodal_file_too_large:'El archivo supera el límite local de 40 MB.', multimodal_asset_limit:'La biblioteca local alcanzó 80 fuentes.', multimodal_storage_unavailable:'El almacenamiento local no está disponible.', extractor_required:'Este archivo necesita un extractor autorizado.' }[error?.message] || error?.message || 'No pude procesar la fuente.'); }
  function card(asset) {
    const analysis = asset.analysis?.text ? '<details><summary>Ver borrador</summary><p>' + escapeHtml(asset.analysis.text) + '</p></details>' : '';
    const action = asset.status === 'analyzed_draft' ? '<button class="gfc-yarbi-primary" onclick="gfcYarbiMultimodalApprove(\'' + escapeHtml(asset.id) + '\')">Aprobar para tutoría</button>' : asset.status === 'approved' ? '<span class="gfc-mm-approved">✓ Aprobado</span>' : '<button class="gfc-yarbi-secondary" onclick="gfcYarbiMultimodalAnalyze(\'' + escapeHtml(asset.id) + '\')">Analizar con Yarbi</button>';
    return '<article class="gfc-mm-card"><div><b>' + escapeHtml(asset.title) + '</b><small>' + kindLabel(asset.kind) + ' · ' + statusLabel(asset.status) + ' · ' + Math.max(1, Math.round(Number(asset.bytes || 0) / 1024)) + ' KB</small></div><p>SHA-256: ' + escapeHtml(String(asset.sha256 || '').slice(0, 16)) + '…</p>' + analysis + '<div class="gfc-mm-actions">' + action + '</div></article>';
  }
  async function render() { const target = root?.document?.getElementById('gfc-mm-list'); if (!target) return; try { const rows = await list(); target.innerHTML = rows.length ? rows.map(card).join('') : '<p>Aún no hay fuentes multimodales. Puedes cargar documentos, imágenes, audios o videos.</p>'; } catch (_) { target.innerHTML = '<p>No se pudo abrir la biblioteca local.</p>'; } }
  function setStatus(message, error) { const target = root?.document?.getElementById('gfc-mm-status'); if (target) { target.textContent = message; target.style.color = error ? '#B91C1C' : '#334155'; } }
  async function importFromUi() { const input = root.document.getElementById('gfc-mm-input'); try { const rows = await importFiles(input?.files); setStatus(rows.length + ' fuente(s) guardada(s) localmente. Los archivos binarios requieren análisis explícito; nada se envió automáticamente.'); if (input) input.value = ''; await render(); } catch (error) { setStatus(statusText(error), true); } }
  async function analyzeFromUi(id) { setStatus('Analizando con el proveedor seguro…'); try { const result = await analyze(id); setStatus(result.ok ? 'Borrador listo. Revísalo antes de aprobarlo.' : (result.message || 'No se aprobó la fuente.'), !result.ok); } catch (error) { setStatus(statusText(error), true); } }
  async function approveFromUi(id) { try { await approve(id); setStatus('Fuente aprobada para tutoría. No modifica CRM ni instrucciones permanentes.'); } catch (error) { setStatus(statusText(error), true); } }
  async function askTutorFromUi() { const input = root.document.getElementById('gfc-mm-tutor-question'); const out = root.document.getElementById('gfc-mm-tutor-answer'); if (!out) return; out.textContent = 'El tutor está preparando una explicación…'; try { const result = await askTutor(input?.value || ''); out.textContent = result.ok ? result.text : (result.message || 'No pude responder sin inventar información.'); } catch (error) { out.textContent = statusText(error); } }
  function html() { return '<main class="gfc-yarbi-tool-page"><div class="gfc-yarbi-tool-card"><div class="gfc-yarbi-tool-title">📚 Conocimiento multimodal y Tutor</div><div class="gfc-yarbi-tool-copy">Carga documentos, imágenes, audios y videos para conservarlos localmente. Yarbi solo analiza una fuente cuando tú lo pides y la deja como borrador; la aprobación es obligatoria antes de usarla en tutoría. No se ejecutan acciones comerciales ni se guardan instrucciones automáticamente.</div><label class="gfc-mm-picker"><b>Seleccionar fuentes</b><input id="gfc-mm-input" type="file" multiple accept=".txt,.md,.csv,.json,.xml,.pdf,.jpg,.jpeg,.png,.webp,.heic,.mp3,.m4a,.wav,.ogg,.aac,.mp4,.mov,.webm, text/plain, application/pdf, image/*, audio/*, video/*"></label><button class="gfc-yarbi-primary" onclick="gfcYarbiMultimodalImport()">Guardar localmente</button><div id="gfc-mm-status" class="gfc-yarbi-import-summary">Sin fuentes multimodales cargadas.</div><div id="gfc-mm-list"></div><hr><div class="gfc-yarbi-tool-title">🎓 Tutor personal</div><div class="gfc-yarbi-tool-copy">Pregunta sobre una fuente aprobada o un tema general. El tutor explica con pasos, ejemplos y checks; no cambia datos ni aprende una regla sin confirmación.</div><textarea id="gfc-mm-tutor-question" rows="3" placeholder="Explícame este procedimiento paso a paso…"></textarea><button class="gfc-yarbi-primary" onclick="gfcYarbiTutorAsk()">Preguntar al tutor</button><article id="gfc-mm-tutor-answer" class="gfc-mm-tutor-answer">Aquí aparecerá la explicación.</article></div></main>'; }
  function attach() { void render(); }
  return Object.freeze({ classifyFile, normalize, sectionsFromText, searchApproved, responseText, buildAsset, importFiles, list, analyze, approve, askTutor, html, attach, render, analyzeFromUi, approveFromUi, importFromUi, askTutorFromUi, MAX_INLINE_BYTES });
}));
