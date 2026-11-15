/* Yarbi Business Knowledge Library. Local-only source review and citations. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.YarbiKnowledgeLibrary = api;
    root.gfcYarbiKnowledgeHtml = api.html;
    root.gfcYarbiKnowledgeAttach = api.attach;
    root.gfcYarbiKnowledgeImportFile = api.importFile;
    root.gfcYarbiKnowledgeImportText = api.importText;
    root.gfcYarbiKnowledgeSearch = api.searchFromUi;
    root.gfcYarbiKnowledgeSetStatus = api.setStatus;
    root.gfcYarbiKnowledgeDelete = api.remove;
    root.gfcYarbiKnowledgeAnswer = api.answer;
  }
}(typeof window === 'undefined' ? null : window, function () {
  'use strict';
  const DB_NAME = 'yarbi_knowledge_library_v1';
  const STORE = 'sources';
  const MAX_SOURCE_CHARS = 200000;
  const MAX_SOURCES = 24;
  const MAX_SECTIONS = 160;
  const textKinds = new Set(['text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/xml']);
  let dbPromise = null;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  }
  function normalized(value) {
    return String(value == null ? '' : value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-PE').replace(/[^a-z0-9ñ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function tokens(value) { return [...new Set(normalized(value).split(' ').filter(token => token.length > 1))]; }
  function cleanText(value) { return String(value == null ? '' : value).replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim(); }
  function safeTitle(value) {
    const title = cleanText(value).replace(/\s+/g, ' ').slice(0, 140);
    return title || 'Fuente sin título';
  }
  function nowId() { return 'source_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9); }
  function sourceKind(file) {
    const name = String(file?.name || '').toLowerCase();
    const type = String(file?.type || '').toLowerCase();
    if (textKinds.has(type) || /\.(txt|md|markdown|csv|json|xml)$/i.test(name)) return 'text';
    if (/\.pdf$/i.test(name) || type === 'application/pdf') return 'pdf';
    if (/\.(jpg|jpeg|png|webp|heic)$/i.test(name) || type.startsWith('image/')) return 'image';
    if (/\.(mp3|m4a|wav|ogg|aac)$/i.test(name) || type.startsWith('audio/')) return 'audio';
    if (/\.(mp4|mov|webm)$/i.test(name) || type.startsWith('video/')) return 'video';
    return 'unsupported';
  }
  function technicalReference(value, fallback) {
    const heading = cleanText(value).replace(/\s+/g, ' ').trim();
    if (/^(?:cap[ií]tulo|secci[oó]n|numeral|art[ií]culo|anexo|ntp|iso|tabla|figura)\b/i.test(heading) && heading.length <= 220) return heading;
    return fallback;
  }
  function extractSections(text) {
    const chunks = cleanText(text).split(/\n\s*\n+/).map(value => ({ raw:value, text:value.replace(/\s+/g, ' ').trim() })).filter(value => value.text);
    const sections = [];
    let activeReference = '';
    chunks.forEach(chunkValue => {
      const firstLine = String(chunkValue.raw).split(/[\n:]/)[0] || '';
      const detected = technicalReference(firstLine, '');
      if (detected) activeReference = detected;
      for (let offset = 0; offset < chunkValue.text.length && sections.length < MAX_SECTIONS; offset += 1300) {
        const value = chunkValue.text.slice(offset, offset + 1300).trim();
        if (value) sections.push({ id:'s' + (sections.length + 1), label:activeReference || ('Fragmento ' + (sections.length + 1)), text:value });
      }
    });
    return sections;
  }
  function searchSources(sources, query) {
    const terms = tokens(query);
    if (!terms.length) return [];
    const rows = [];
    (Array.isArray(sources) ? sources : []).filter(source => source && source.status === 'approved').forEach(source => {
      (Array.isArray(source.sections) ? source.sections : []).forEach(section => {
        const haystack = normalized([source.title, section.label, section.text].join(' '));
        const hits = terms.filter(term => haystack.includes(term));
        if (!hits.length) return;
        rows.push({
          sourceId:source.id,
          sourceTitle:source.title,
          sourceHash:source.sha256,
          sectionId:section.id,
          sectionLabel:section.label,
          excerpt:section.text.slice(0, 650),
          hits,
          score:hits.length * 100 + (normalized(section.text).includes(terms.join(' ')) ? 30 : 0)
        });
      });
    });
    return rows.sort((left, right) => right.score - left.score || left.sourceTitle.localeCompare(right.sourceTitle, 'es-PE')).slice(0, 12);
  }
  function requestedLibraryQuery(value) {
    const text = cleanText(value);
    const folded = normalized(text);
    if (!/\b(?:(?:mi|mis)\s+)?(?:biblioteca|fuentes?\s+guardadas?|documentos?\s+guardados?)\b/.test(folded)) return '';
    const query = text
      .replace(/^(?:por favor\s+)?(?:busca|buscar|consulta|revisa|dime|muestrame|muéstrame|que dice|qué dice)\s+(?:en\s+)?(?:(?:mi|mis)\s+)?(?:biblioteca|fuentes?|documentos?)(?:\s+(?:guardadas?|guardados?))?(?:\s+(?:sobre|de))?\s*/i, '')
      .replace(/^(?:segun|según)\s+(?:(?:mi|mis)\s+)?(?:biblioteca|fuentes?|documentos?)(?:\s+(?:guardadas?|guardados?))?\s*,?\s*(?:¿?qué\s+dice\s+)?(?:sobre|de)?\s*/i, '')
      .trim();
    return tokens(query).length ? query : '';
  }
  function answerFromResults(query, results) {
    const rows = Array.isArray(results) ? results.slice(0, 3) : [];
    if (!rows.length) {
      return '## 📚 Biblioteca local\n\nNo encontré una cita aprobada sobre **' + cleanText(query) + '**. No inventaré una norma, una página ni una conclusión documental. Puedes revisar o aprobar una fuente en **Funciones de Yarbi → Conocimiento**.';
    }
    return '## 📚 Respuesta respaldada por tu biblioteca\n\nBusqué coincidencias literales aprobadas sobre **' + cleanText(query) + '**. No son una interpretación automática, una norma inventada ni una fuente externa.\n\n' + rows.map(row =>
      '### ' + cleanText(row.sourceTitle) + '\n\n**Referencia:** ' + cleanText(row.sectionLabel) + '\n\n> ' + cleanText(row.excerpt) + '\n\n**En palabras sencillas:** la fuente exige exactamente lo indicado en la cita. Para interpretar cómo aplicarlo a un caso técnico concreto, usa **“Explícame con mi tutor…”**; Yarbi conservará esta misma referencia y no añadirá requisitos que el documento no respalde.\n\n_Fuente aprobada · coincidencias: ' + (Array.isArray(row.hits) ? row.hits.join(', ') : '') + ' · SHA-256 ' + cleanText(String(row.sourceHash || '').slice(0, 12)) + '…_'
    ).join('\n\n');
  }
  async function sha256(text) {
    if (!root?.crypto?.subtle || typeof TextEncoder === 'undefined') throw new Error('hashing_unavailable');
    const bytes = new TextEncoder().encode(text);
    const digest = await root.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  async function createTextSource(input) {
    const text = cleanText(input?.text);
    if (!text) throw new Error('source_text_required');
    if (text.length > MAX_SOURCE_CHARS) throw new Error('source_too_large');
    const sections = extractSections(text);
    if (!sections.length) throw new Error('source_text_required');
    return {
      id:nowId(), title:safeTitle(input?.title), kind:'text', mime:String(input?.mime || 'text/plain').slice(0, 100),
      status:'draft', sha256:await sha256(text), charCount:text.length, sectionCount:sections.length, sections,
      originalHandling:'not_copied', createdAt:Date.now(), updatedAt:Date.now(), approvedAt:null
    };
  }
  function openDb() {
    if (dbPromise) return dbPromise;
    if (!root?.indexedDB) return Promise.reject(new Error('knowledge_storage_unavailable'));
    dbPromise = new Promise((resolve, reject) => {
      const request = root.indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath:'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('knowledge_storage_unavailable'));
    });
    return dbPromise;
  }
  async function transaction(mode, callback) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      let value;
      Promise.resolve(callback(store)).then(result => { value = result; }).catch(error => { try { tx.abort(); } catch (_) {} reject(error); });
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error || new Error('knowledge_storage_failed'));
      tx.onabort = () => reject(tx.error || new Error('knowledge_storage_aborted'));
    });
  }
  function requestValue(request) {
    return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error || new Error('knowledge_storage_failed')); });
  }
  async function list() {
    const rows = await transaction('readonly', store => requestValue(store.getAll()));
    return (Array.isArray(rows) ? rows : []).sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
  }
  async function save(source) {
    const rows = await list();
    if (rows.length >= MAX_SOURCES) throw new Error('source_limit_reached');
    await transaction('readwrite', store => { store.put(source); });
    return source;
  }
  async function changeStatus(id, status) {
    const next = String(status || '') === 'approved' ? 'approved' : 'draft';
    return transaction('readwrite', async store => {
      const source = await requestValue(store.get(String(id || '')));
      if (!source) throw new Error('source_not_found');
      source.status = next;
      source.updatedAt = Date.now();
      source.approvedAt = next === 'approved' ? source.approvedAt || source.updatedAt : null;
      store.put(source);
      return source;
    });
  }
  async function deleteSource(id) { return transaction('readwrite', store => { store.delete(String(id || '')); return true; }); }
  function statusCopy(code) {
    return ({ source_text_required:'Escribe o selecciona una fuente de texto.', source_too_large:'La fuente supera el límite local de 200 000 caracteres.', source_limit_reached:'La biblioteca local ya tiene 24 fuentes. Revisa o elimina una antes de añadir otra.', hashing_unavailable:'Este dispositivo no ofrece SHA-256 local; la fuente no se guardó.', knowledge_storage_unavailable:'El almacenamiento local no está disponible.', source_not_found:'La fuente ya no está disponible.' })[code] || 'No pude guardar la fuente local.';
  }
  function sourceCard(source) {
    const approved = source.status === 'approved';
    return '<article class="gfc-knowledge-source"><div><b>' + esc(source.title) + '</b><small>' + (approved ? '✓ Aprobada para consultas locales' : 'Borrador: requiere aprobación explícita') + ' · SHA-256 ' + esc(String(source.sha256 || '').slice(0, 12)) + '…</small></div>' +
      '<p>' + esc(String(source.sectionCount || 0)) + ' fragmentos · ' + esc(String(source.charCount || 0)) + ' caracteres · original no copiado</p><div class="gfc-knowledge-actions">' +
      (approved ? '<button onclick="gfcYarbiKnowledgeSetStatus(\'' + esc(source.id) + '\',\'draft\')">Quitar aprobación</button>' : '<button class="primary" onclick="gfcYarbiKnowledgeSetStatus(\'' + esc(source.id) + '\',\'approved\')">Aprobar para consultas</button>') +
      '<button class="danger" onclick="gfcYarbiKnowledgeDelete(\'' + esc(source.id) + '\')">Eliminar copia local</button></div></article>';
  }
  function html() {
    return '<main class="gfc-yarbi-tool-page"><div class="gfc-yarbi-tool-card gfc-knowledge-page"><div class="gfc-yarbi-tool-title">Biblioteca de conocimiento</div><div class="gfc-yarbi-tool-copy">Yarbi conserva aquí texto de trabajo con SHA-256 y citas locales. Nada se envía a proveedores. El archivo original no se copia al servidor; PDF, imagen, audio y video requieren un extractor autorizado antes de usarse.</div>' +
      '<div class="gfc-knowledge-import"><label><b>Fuente de texto</b><input id="gfc-knowledge-file" type="file" accept=".txt,.md,.markdown,.csv,.json,.xml,text/plain,text/markdown,text/csv,application/json,application/xml"></label><input id="gfc-knowledge-title" maxlength="140" placeholder="Título de la fuente (opcional)"><textarea id="gfc-knowledge-text" rows="7" maxlength="200000" placeholder="O pega aquí una instrucción, procedimiento o extracto documental. Revisa el contenido antes de aprobarlo."></textarea><div><button class="gfc-yarbi-primary" onclick="gfcYarbiKnowledgeImportFile()">Agregar archivo de texto</button><button class="gfc-yarbi-secondary" onclick="gfcYarbiKnowledgeImportText()">Guardar texto pegado</button></div><small id="gfc-knowledge-status">Solo las fuentes aprobadas aparecen en la búsqueda local. Una cita muestra la fuente y el fragmento; Yarbi no inventa páginas ni artículos.</small></div>' +
      '<div class="gfc-knowledge-search"><input id="gfc-knowledge-query" maxlength="240" placeholder="Buscar en fuentes aprobadas"><button class="gfc-yarbi-secondary" onclick="gfcYarbiKnowledgeSearch()">Buscar citas</button></div><div id="gfc-knowledge-results"></div><h3>Fuentes locales</h3><div id="gfc-knowledge-list"><p>Cargando biblioteca local…</p></div></div></main>';
  }
  function setUiStatus(message, error) {
    const target = root?.document?.getElementById('gfc-knowledge-status');
    if (!target) return;
    target.textContent = String(message || '');
    target.style.color = error ? '#B91C1C' : '#166534';
  }
  async function renderList() {
    const target = root?.document?.getElementById('gfc-knowledge-list');
    if (!target) return [];
    try {
      const rows = await list();
      target.innerHTML = rows.length ? rows.map(sourceCard).join('') : '<p>Aún no hay fuentes locales. Puedes empezar con un TXT, Markdown, CSV, JSON, XML o texto pegado.</p>';
      return rows;
    } catch (_) { target.innerHTML = '<p>La biblioteca local no está disponible en este dispositivo.</p>'; return []; }
  }
  async function importText() {
    const title = root.document.getElementById('gfc-knowledge-title')?.value || 'Texto pegado';
    const text = root.document.getElementById('gfc-knowledge-text')?.value || '';
    try {
      const source = await createTextSource({ title, text, mime:'text/plain' });
      await save(source);
      root.document.getElementById('gfc-knowledge-text').value = '';
      setUiStatus('Fuente guardada como borrador local. Revísala y apruébala cuando corresponda.');
      await renderList();
    } catch (error) { setUiStatus(statusCopy(error?.message), true); }
  }
  async function importFile() {
    const file = root.document.getElementById('gfc-knowledge-file')?.files?.[0];
    if (!file) { setUiStatus('Selecciona un archivo de texto primero.', true); return; }
    if (sourceKind(file) !== 'text') { setUiStatus('Este formato todavía no se procesa localmente. El archivo no fue enviado ni guardado. PDF, imágenes, audio y video requieren un extractor autorizado.', true); return; }
    try {
      if (Number(file.size || 0) > MAX_SOURCE_CHARS * 2) throw new Error('source_too_large');
      const source = await createTextSource({ title:root.document.getElementById('gfc-knowledge-title')?.value || file.name, text:await file.text(), mime:file.type || 'text/plain' });
      await save(source);
      root.document.getElementById('gfc-knowledge-file').value = '';
      setUiStatus('Archivo de texto leído localmente y guardado como borrador. El original no se copió a ningún servicio.');
      await renderList();
    } catch (error) { setUiStatus(statusCopy(error?.message), true); }
  }
  async function setStatus(id, status) {
    try {
      await changeStatus(id, status);
      setUiStatus(status === 'approved' ? 'Fuente aprobada para búsquedas locales con cita.' : 'La fuente volvió a borrador y ya no se usará en búsquedas.');
      await renderList();
      await searchFromUi();
    } catch (error) { setUiStatus(statusCopy(error?.message), true); }
  }
  async function remove(id) {
    if (!root.confirm('Se eliminará la copia de trabajo local y sus fragmentos. El archivo original no se toca. ¿Continuar?')) return;
    try { await deleteSource(id); setUiStatus('Copia local eliminada.'); await renderList(); await searchFromUi(); }
    catch (error) { setUiStatus(statusCopy(error?.message), true); }
  }
  async function searchFromUi() {
    const target = root?.document?.getElementById('gfc-knowledge-results');
    if (!target) return [];
    const query = root.document.getElementById('gfc-knowledge-query')?.value || '';
    if (!tokens(query).length) { target.innerHTML = ''; return []; }
    try {
      const results = searchSources(await list(), query);
      target.innerHTML = results.length ? '<h3>Citas encontradas</h3>' + results.map(result => '<article class="gfc-knowledge-citation"><b>' + esc(result.sourceTitle) + ' · ' + esc(result.sectionLabel) + '</b><p>“' + esc(result.excerpt) + '”</p><small>Coincidencias: ' + esc(result.hits.join(', ')) + ' · SHA-256 ' + esc(String(result.sourceHash || '').slice(0, 12)) + '…</small></article>').join('') : '<p>No hay citas aprobadas que respalden esa búsqueda. Yarbi no completará los vacíos con una respuesta documental inventada.</p>';
      return results;
    } catch (_) { target.innerHTML = '<p>No pude consultar la biblioteca local.</p>'; return []; }
  }
  async function answer(value) {
    const query = requestedLibraryQuery(value);
    if (!query) {
      const askedForLibrary = /\b(?:(?:mi|mis)\s+)?(?:biblioteca|fuentes?\s+guardadas?|documentos?\s+guardados?)\b/.test(normalized(value));
      return askedForLibrary ? { handled:true, reply:'## 📚 Biblioteca local\n\nDime qué tema quieres buscar en tus fuentes aprobadas. Por ejemplo: **“Busca en mi biblioteca el procedimiento de visitas”**.' } : { handled:false };
    }
    try {
      return { handled:true, reply:answerFromResults(query, searchSources(await list(), query)) };
    } catch (_) {
      return { handled:true, reply:'## 📚 Biblioteca local\n\nNo puedo abrir la biblioteca local en este dispositivo. No consulté ningún servicio externo ni inventé una respuesta documental.' };
    }
  }
  function attach() {
    renderList();
    const query = root?.document?.getElementById('gfc-knowledge-query');
    query?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); searchFromUi(); } });
  }
  return Object.freeze({ normalize:normalized, extractSections, searchSources, requestedLibraryQuery, answerFromResults, createTextSource, html, attach, importText, importFile, setStatus, remove, searchFromUi, answer, list });
}));
