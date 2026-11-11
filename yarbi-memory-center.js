(function () {
  'use strict';

  const BACKEND = window.gfcRuntimeApiOrigin() + '';
  const TIMELINE_KEY = 'gfc_yarbi_chat_timeline_v1';
  const TIMELINE_OUTBOX_KEY = 'gfc_yarbi_chat_outbox_v1';
  const IMPORT_STATE_KEY = 'gfc_yarbi_mass_import_v2';
  const TRAINING_HISTORY_KEY = 'gfc_yarbi_client_simulator_v1';
  const TRAINING_OUTBOX_KEY = 'gfc_yarbi_client_simulator_outbox_v1';
  const TRAINING_ROLE_KEY = 'gfc_yarbi_client_simulator_role_v1';
  const TRAINING_CHAT_KEY = 'gfc_yarbi_client_simulator_chat_v2';
  const TRAINING_PENDING_INSTRUCTION_KEY = 'gfc_yarbi_client_simulator_pending_instruction_v1';
  const INTERACTION_MODE_KEY = 'gfc_yarbi_interaction_mode_v1';
  const AUTONOMY_KEY = 'gfc_yarbi_autonomy_v1';
  const ACTIVE_CONVERSATION_KEY = 'gfc_yarbi_active_conversation_v1';
  const CONVERSATION_VIEW_KEY = 'gfc_yarbi_conversation_view_v1';
  const CONVERSATION_DRAFT_KEY = 'gfc_yarbi_conversation_drafts_v1';
  const DEFAULT_CONVERSATION_ID = 'default';
  const MAX_TRAINING_EXAMPLES = 80;
  const MAX_LOCAL_MESSAGES = 600;
  const LEARNING_INTENTS = ['cotizacion','ubicacion','agenda','reprogramacion','pago','postventa','consulta_general'];

  function interactionMode() {
    return localStorage.getItem(INTERACTION_MODE_KEY) === 'training' ? 'training' : 'normal';
  }
  window.gfcGetYarbiInteractionMode = interactionMode;
  window.gfcIsYarbiTrainingMode = function() { return interactionMode() === 'training'; };
  window.gfcYarbiTrainingLiveContext = function() {
    const activeExamples = trainingHistory().filter(item => item.active !== false).slice(-12);
    // Conserva qué ejemplos entraron realmente al contexto Live para medir su
    // uso, no solo su creación.
    window._gfcYarbiTrainingLiveExampleIds = activeExamples.map(item => String(item.id)).filter(Boolean);
    const examples = activeExamples.map(item => ({ client:item.client, response:item.response, rule:item.learning?.rule || '' }));
    const instructions = typeof gfcOwnerInstructionVisibleList === 'function'
      ? gfcOwnerInstructionVisibleList().filter(item => item && item.active !== false).slice(0,20).map(item => item.instruction)
      : [];
    return 'INSTRUCCIONES PERMANENTES ACTIVAS: ' + JSON.stringify(instructions).slice(0,5000) +
      '. EJEMPLOS APROBADOS DE ENTRENAMIENTO: ' + JSON.stringify(examples).slice(0,7000);
  };

  function esc(value) {
    if (typeof window.gfcEscHtml === 'function') return window.gfcEscHtml(String(value == null ? '' : value));
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
  }
  // El endpoint histórico de preferencias almacena un timeline plano: no tiene
  // conversation_id. Por eso solo puede transportar la conversación heredada
  // `default`. Las conversaciones creadas en el nuevo historial permanecen
  // deliberadamente locales hasta contar con un contrato remoto versionado.
  // Nunca se reutiliza el token legado del navegador para sincronizarlas.
  function remoteTimelineEnabled() {
    return typeof window.gfcRuntimeRemoteEnabled === 'function' && window.gfcRuntimeRemoteEnabled() === true;
  }
  async function ownerSessionToken() {
    if (!remoteTimelineEnabled() || typeof window.gfcAccountFreshAccessToken !== 'function') return '';
    try {
      const value = await window.gfcAccountFreshAccessToken();
      return typeof value === 'string' && value.trim() ? value.trim() : '';
    } catch (_) { return ''; }
  }
  function isLegacyRemoteTimelineItem(item) {
    return safeConversationId(item?.conversation_id || item?.conversationId) === DEFAULT_CONVERSATION_ID;
  }
  function readJson(key, fallback) {
    try { const value = JSON.parse(localStorage.getItem(key) || 'null'); return value == null ? fallback : value; } catch (_) { return fallback; }
  }
  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (_) { return false; }
  }
  function makeId(prefix, seed) {
    let hash = 2166136261;
    const source = String(seed || (Date.now() + ':' + Math.random()));
    for (let i = 0; i < source.length; i += 1) { hash ^= source.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return prefix + '_' + (hash >>> 0).toString(36);
  }
  function safeConversationId(value) {
    const id = typeof value === 'string' ? value.trim() : '';
    return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(id) ? id : DEFAULT_CONVERSATION_ID;
  }
  function activeConversationId() {
    return safeConversationId(localStorage.getItem(ACTIVE_CONVERSATION_KEY));
  }
  window.gfcYarbiActiveConversationId = activeConversationId;
  function setActiveConversationId(value) {
    const id = safeConversationId(value);
    localStorage.setItem(ACTIVE_CONVERSATION_KEY, id);
    // El contexto breve que usa el cerebro debe cambiar junto con la pantalla.
    // Así una nueva conversación no hereda referencias de la anterior.
    if (typeof window.gfcLoadCopilotHistory === 'function') window._gfcCopilotHistory = window.gfcLoadCopilotHistory();
    return id;
  }
  function newConversationId() {
    return 'conversation_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
  }
  function conversationViewMap() {
    const saved = readJson(CONVERSATION_VIEW_KEY, {});
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  }
  function conversationScrollTop(id) {
    const top = Number(conversationViewMap()[safeConversationId(id)]?.scrollTop);
    return Number.isFinite(top) && top >= 0 ? top : null;
  }
  function saveConversationScrollTop(id, scrollTop) {
    const conversationId = safeConversationId(id);
    const top = Number(scrollTop);
    if (!Number.isFinite(top) || top < 0) return;
    const next = conversationViewMap();
    next[conversationId] = { scrollTop:Math.round(top), updatedAt:Date.now() };
    const trimmed = Object.entries(next).sort((left, right) => Number(right[1]?.updatedAt || 0) - Number(left[1]?.updatedAt || 0)).slice(0, 60);
    writeJson(CONVERSATION_VIEW_KEY, Object.fromEntries(trimmed));
  }
  function forgetConversationView(id) {
    const next = conversationViewMap();
    delete next[safeConversationId(id)];
    writeJson(CONVERSATION_VIEW_KEY, next);
  }
  function conversationDraftMap() {
    const saved = readJson(CONVERSATION_DRAFT_KEY, {});
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  }
  function conversationDraft(id) {
    const saved = conversationDraftMap()[safeConversationId(id)];
    return typeof saved?.text === 'string' ? saved.text : '';
  }
  function saveConversationDraft(id, text) {
    const conversationId = safeConversationId(id);
    const value = String(text || '').slice(0, 8000);
    const next = conversationDraftMap();
    if (value.trim()) next[conversationId] = { text:value, updatedAt:Date.now() };
    else delete next[conversationId];
    const trimmed = Object.entries(next).sort((left, right) => Number(right[1]?.updatedAt || 0) - Number(left[1]?.updatedAt || 0)).slice(0, 60);
    return writeJson(CONVERSATION_DRAFT_KEY, Object.fromEntries(trimmed));
  }
  function forgetConversationDraft(id) {
    const next = conversationDraftMap();
    delete next[safeConversationId(id)];
    writeJson(CONVERSATION_DRAFT_KEY, next);
  }
  function autonomyConfig() {
    const saved = readJson(AUTONOMY_KEY, {});
    const requested = String(saved?.mode || 'observe');
    const mode = ['observe','suggest','approval'].includes(requested) ? requested : 'observe';
    return { mode, emergencyStop:true, updatedAt:Number(saved?.updatedAt || 0) || null };
  }
  function activeOwnerInstructionCount() {
    try {
      const list = typeof gfcOwnerInstructionVisibleList === 'function' ? gfcOwnerInstructionVisibleList() : [];
      return Array.isArray(list) ? list.filter(item => item && item.active !== false).length : 0;
    } catch (_) { return 0; }
  }
  function learningSnapshot(styleCountOverride) {
    const examples = trainingHistory().filter(item => item.active !== false);
    const tested = examples.filter(item => item.tested);
    const passed = tested.filter(item => item.testPassed === true).length;
    const failed = tested.filter(item => item.testPassed === false).length;
    const intents = new Set(examples.map(item => item.learning?.intent).filter(value => LEARNING_INTENTS.includes(value)));
    const imported = readJson(IMPORT_STATE_KEY, {});
    const outgoing = Math.max(0, Number(imported?.outgoing || 0));
    const incoming = Math.max(0, Number(imported?.incoming || 0));
    const unresolved = Math.max(0, Number(imported?.unresolvedConversations || 0));
    const styles = Math.max(0, Number(styleCountOverride ?? window._gfcYarbiLearningStyleCount ?? 0));
    const instructions = activeOwnerInstructionCount();
    const components = {
      coverage:Math.round(Math.min(1, intents.size / LEARNING_INTENTS.length) * 25),
      verification:Math.round(Math.min(1, passed / 8) * 30),
      evidence:Math.round(Math.min(1, outgoing / 100) * 20),
      style:Math.round(Math.min(1, styles / 10) * 15),
      instructions:Math.round(Math.min(1, instructions / 8) * 10)
    };
    const penalty = Math.min(25, failed * 5 + unresolved * 2);
    const score = Math.max(0, Math.min(100, Object.values(components).reduce((sum,value) => sum + value, 0) - penalty));
    const pilotEligible = examples.length >= 10 && passed >= 6 && intents.size >= 5 && outgoing >= 40 && styles >= 5 && failed === 0 && unresolved === 0;
    const autoEligible = pilotEligible && examples.length >= 20 && passed >= 12 && intents.size === LEARNING_INTENTS.length && outgoing >= 100;
    const level = score < 40 ? 'Iniciando' : score < 70 ? 'Aprendiendo' : score < 85 ? 'Listo para sugerir' : score < 95 ? 'Aprobación rápida' : 'Candidato a piloto';
    return { score, level, examples:examples.length, tested:tested.length, passed, failed, intents:intents.size, outgoing, incoming, unresolved, styles, instructions, components, pilotEligible, autoEligible, lastImport:Number(imported?.at || 0) || null };
  }
  function learningChipHtml() {
    const metrics = learningSnapshot();
    const mode = autonomyConfig().mode;
    const label = mode === 'approval' ? 'Aprobación rápida' : mode === 'suggest' ? 'Solo sugerencias' : 'Observación';
    return '<button id="gfc-yarbi-learning-chip" class="gfc-yarbi-learning-chip" onclick="gfcOpenCopilotModal(\'learning\')"><span>🧠 Aprendizaje <b>' + metrics.score + '%</b></span><small>' + esc(metrics.level) + ' · ' + esc(label) + '</small></button>';
  }
  window.gfcShowInstructionSavedChip = function(record, cloud, updated) {
    const target = interactionMode() === 'training'
      ? document.getElementById('gfc-yarbi-training-chat')
      : document.getElementById('gfc-copilot-chat-messages');
    if (!target || !record) return false;
    target.querySelectorAll('.gfc-yarbi-instruction-chip.is-current').forEach(node => node.classList.remove('is-current'));
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'gfc-yarbi-instruction-chip is-current';
    chip.innerHTML = '<span>🧠</span><b>' + esc(updated ? 'Patrón actualizado' : 'Instrucción guardada') + '</b><small>' +
      esc(record.name || 'Estilo de Yarbi') + ' · ' + (cloud ? 'local + Supabase' : 'local · sincronización pendiente') + '</small>';
    chip.addEventListener('click', () => window.gfcOpenCopilotModal?.('ordenes'));
    target.appendChild(chip);
    target.scrollTop = target.scrollHeight;
    return true;
  };
  async function refreshLearningEvidence() {
    try {
      const styles = typeof gfcYarbiLocalRows === 'function' ? await gfcYarbiLocalRows('reply_style').catch(() => []) : [];
      window._gfcYarbiLearningStyleCount = Array.isArray(styles) ? styles.filter(item => item && item.active !== false).length : 0;
    } catch (_) { window._gfcYarbiLearningStyleCount = Number(window._gfcYarbiLearningStyleCount || 0); }
    const chip = document.getElementById('gfc-yarbi-learning-chip');
    if (chip) chip.outerHTML = learningChipHtml();
    if (window._gfcYarbiCurrentTab === 'learning') {
      const page = document.getElementById('gfc-yarbi-learning-page');
      if (page) page.outerHTML = learningHtml();
    }
    return learningSnapshot();
  }
  function normalizeTimelineItem(item) {
    const role = item && (item.role === 'user' ? 'user' : (item.role === 'assistant' || item.role === 'model' ? 'assistant' : ''));
    const text = String(item?.text || item?.parts?.[0]?.text || '').trim();
    if (!role || !text) return null;
    const at = Number(item.at || item.message_at || Date.now());
    return {
      id: String(item.id || makeId('yt', role + ':' + at + ':' + text)),
      role, text: text.slice(0, 8000),
      at: Number.isFinite(at) ? at : Date.now(),
      channel: String(item.channel || 'chat').slice(0, 30),
      conversation_id:safeConversationId(item.conversation_id || item.conversationId || activeConversationId())
    };
  }
  let conversationStoreReady = null;
  let unsubscribeConversationStore = null;
  function storageError(code) {
    return Object.assign(new Error(code), { code });
  }
  async function conversationStore() {
    if (!window.YarbiConversationStore) throw storageError('storage_unavailable');
    if (!conversationStoreReady) {
      conversationStoreReady = window.YarbiConversationStore.initialize({ timelineKey:TIMELINE_KEY, outboxKey:TIMELINE_OUTBOX_KEY });
    }
    const initialized = await conversationStoreReady;
    if (!initialized?.ok) throw storageError(initialized?.code || 'storage_initialization_failed');
    return window.YarbiConversationStore;
  }
  async function loadTimeline(conversationId) {
    const store = await conversationStore();
    return (await store.listTimeline(conversationId || activeConversationId())).map(normalizeTimelineItem).filter(Boolean).sort((a,b) => a.at - b.at).slice(-MAX_LOCAL_MESSAGES);
  }
  async function importTimeline(items) {
    const store = await conversationStore();
    const imported = [];
    for (const candidate of (Array.isArray(items) ? items : [])) {
      const item = normalizeTimelineItem({ ...candidate, conversation_id:candidate?.conversation_id || candidate?.conversationId || activeConversationId() });
      if (!item) continue;
      const result = await store.persist(item);
      if (!result.ok && result.code !== 'identity_conflict') throw storageError(result.code || 'storage_import_failed');
      if (result.ok) imported.push(result.item);
    }
    return imported;
  }
  async function postTimeline(items) {
    const outgoing = (Array.isArray(items) ? items : []).filter(isLegacyRemoteTimelineItem);
    if (!outgoing.length) return false;
    const accessToken = await ownerSessionToken();
    if (!accessToken) return false;
    const response = await fetch(BACKEND + '/api/assistant/preferences?action=conversation', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', Authorization:'Bearer ' + accessToken },
      body:JSON.stringify({ messages:outgoing })
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return true;
  }
  async function flushTimelineOutbox() {
    if (!remoteTimelineEnabled()) return;
    const store = await conversationStore();
    const queue = await store.listOutbox();
    if (!queue.length) return;
    const batch = queue.filter(row => row?.item && isLegacyRemoteTimelineItem(row.item)).slice(0, 100);
    if (!batch.length) return;
    try {
      const sent = await postTimeline(batch.map(row => row.item));
      if (sent) await store.acknowledgeOutbox(batch.map(row => row.id));
    }
    catch (_) {}
  }
  async function syncTimelineFromCloud() {
    // Evita una lectura/escritura plana al abrir una conversación nueva: no
    // existe forma segura de reconstruir su partición desde el endpoint legado.
    if (activeConversationId() !== DEFAULT_CONVERSATION_ID) return loadTimeline();
    const accessToken = await ownerSessionToken();
    if (!accessToken) return loadTimeline();
    try {
      await flushTimelineOutbox();
      const response = await fetch(BACKEND + '/api/assistant/preferences?action=conversation&limit=500', { headers:{ Authorization:'Bearer ' + accessToken }, cache:'no-store' });
      if (!response.ok) return loadTimeline();
      const data = await response.json().catch(() => ({}));
      // El contrato remoto legado es plano: una fila sin conversation_id se
      // conserva en el historial anterior, nunca se inserta en la conversación
      // local actualmente abierta por accidente.
      const cloud = Array.isArray(data.messages) ? data.messages.map(item => normalizeTimelineItem({ ...item, conversation_id:item?.conversation_id || item?.conversationId || DEFAULT_CONVERSATION_ID })).filter(Boolean) : [];
      const store = await conversationStore();
      await store.mergeCloud(cloud);
      return loadTimeline();
    } catch (_) { return loadTimeline(); }
  }
  let lastTimelinePersistence = Object.freeze({ outcome:'idle' });
  function setTimelinePersistence(outcome, id) {
    lastTimelinePersistence = Object.freeze({ outcome, id:id || null });
    return lastTimelinePersistence;
  }
  function timelineImmutableMatch(left, right) {
    return !!left && !!right && left.id === right.id && left.role === right.role
      && left.text === right.text && left.channel === right.channel && left.conversation_id === right.conversation_id;
  }
  async function persistTimelineMessage(role, text, at, channel, id, conversationId) {
    if (typeof id !== 'undefined' && (typeof id !== 'string' || !id.trim())) {
      setTimelinePersistence('identity_invalid');
      return null;
    }
    const explicitId = typeof id === 'string' ? id.trim() : '';
    const normalized = normalizeTimelineItem({ id:explicitId || undefined, role, text, at:at || Date.now(), channel:channel || 'chat', conversation_id:conversationId || activeConversationId() });
    if (!normalized) { setTimelinePersistence('content_invalid'); return null; }
    try {
      const store = await conversationStore();
      const result = await store.persist(normalized);
      if (!result.ok) { setTimelinePersistence(result.code || 'storage_write_failed', normalized.id); return null; }
      const saved = normalizeTimelineItem(result.item);
      if (!timelineImmutableMatch(saved, normalized)) { setTimelinePersistence('storage_readback_failed', normalized.id); return null; }
      setTimelinePersistence(result.code, saved.id);
      if (result.code === 'persisted' && isLegacyRemoteTimelineItem(saved)) {
        postTimeline([saved]).then(() => store.acknowledgeOutbox([saved.id])).catch(() => {});
      }
      return saved;
    } catch (error) {
      setTimelinePersistence(error?.code || 'storage_unavailable', normalized.id);
      return null;
    }
  }
  function dayKey(ms) {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone:'America/Lima', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date(ms)); }
    catch (_) { return new Date(ms).toISOString().slice(0,10); }
  }
  function dayLabel(ms) {
    try { return new Intl.DateTimeFormat('es-PE', { timeZone:'America/Lima', weekday:'short', day:'numeric', month:'short', year:'numeric' }).format(new Date(ms)); }
    catch (_) { return new Date(ms).toLocaleDateString('es-PE'); }
  }
  function timeLabel(ms) {
    try { return new Intl.DateTimeFormat('es-PE', { timeZone:'America/Lima', hour:'2-digit', minute:'2-digit', hour12:true }).format(new Date(ms)); }
    catch (_) { return new Date(ms).toLocaleTimeString('es-PE', { hour:'2-digit', minute:'2-digit' }); }
  }
  let renderedDay = '';
  function boardPayload(text) {
    const raw = String(text || '');
    const prefix = raw.startsWith('[YARBI_BOARD_V2]') ? '[YARBI_BOARD_V2]' : '[YARBI_BOARD_V1]';
    if (!raw.startsWith(prefix)) return null;
    try {
      const value = JSON.parse(raw.slice(prefix.length));
      return value && typeof value === 'object' ? value : null;
    } catch (_) { return null; }
  }
  function boardLine(icon, title, detail, tone) {
    const line = document.createElement('div');
    line.className = 'gfc-yarbi-board-line ' + (tone || 'info');
    const badge = document.createElement('div');
    badge.className = 'gfc-yarbi-board-icon';
    badge.textContent = icon || '•';
    const content = document.createElement('div');
    content.className = 'gfc-yarbi-board-line-copy';
    const strong = document.createElement('b');
    strong.textContent = title || 'Pendiente';
    const small = document.createElement('span');
    small.textContent = detail || '';
    content.append(strong, small);
    line.append(badge, content);
    return line;
  }
  function renderBoardBody(body, payload) {
    body.className += ' gfc-yarbi-board';
    const hero = document.createElement('div');
    hero.className = 'gfc-yarbi-board-hero';
    const title = document.createElement('b');
    title.textContent = payload.title || 'Tablero de Yarbi';
    const subtitle = document.createElement('span');
    subtitle.textContent = payload.subtitle || 'Información verificada en la copia local';
    hero.append(title, subtitle);
    body.appendChild(hero);
    const stats = Array.isArray(payload.stats) ? payload.stats : [];
    if (stats.length) {
      const grid = document.createElement('div');
      grid.className = 'gfc-yarbi-board-stats';
      stats.slice(0,3).forEach(stat => {
        const card = document.createElement('div');
        card.className = 'gfc-yarbi-board-stat ' + (stat.tone || 'info');
        const icon = document.createElement('span'); icon.textContent = stat.icon || '•';
        const copy = document.createElement('div');
        const value = document.createElement('b'); value.textContent = String(stat.value ?? 0);
        const label = document.createElement('small'); label.textContent = stat.label || '';
        copy.append(value,label); card.append(icon,copy); grid.appendChild(card);
      });
      body.appendChild(grid);
    }
    const groups = Array.isArray(payload.groups) ? payload.groups : [];
    groups.forEach(group => {
      const section = document.createElement('section');
      section.className = 'gfc-yarbi-board-section';
      const heading = document.createElement('div');
      heading.className = 'gfc-yarbi-board-heading';
      const headingText = document.createElement('b');
      headingText.textContent = (group.icon || '📌') + ' ' + (group.title || 'Resumen');
      const count = document.createElement('span');
      count.textContent = String((group.items || []).length);
      heading.append(headingText, count);
      section.appendChild(heading);
      const items = Array.isArray(group.items) ? group.items : [];
      if (!items.length) section.appendChild(boardLine('✓', group.empty || 'Sin pendientes', '', 'done'));
      items.forEach(item => {
        const line = boardLine(item.icon || group.icon || '•', item.title, item.detail, item.tone || group.tone);
        const copy = line.querySelector('.gfc-yarbi-board-line-copy');
        if (item.recommendation) {
          const recommendation = document.createElement('em');
          recommendation.textContent = item.recommendation;
          copy?.appendChild(recommendation);
        }
        const actions = Array.isArray(item.actions) ? item.actions : [];
        if (item.client && actions.length) {
          const controls = document.createElement('div');
          controls.className = 'gfc-yarbi-board-actions';
          actions.forEach(action => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = action.label || action.id;
            if (action.primary) button.classList.add('primary');
            button.addEventListener('click', event => { event.stopPropagation(); if (typeof window.gfcYarbiBoardAction === 'function') window.gfcYarbiBoardAction(item, action.id); });
            controls.appendChild(button);
          });
          copy?.appendChild(controls);
        } else if (item.client) {
          line.classList.add('actionable');
          line.setAttribute('role','button');
          line.tabIndex = 0;
          const open = () => typeof window.gfcSendCopilotChatMessage === 'function' && window.gfcSendCopilotChatMessage('Qué fue de ' + item.client);
          line.addEventListener('click', open);
          line.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') open(); });
          const hint = document.createElement('em');
          hint.textContent = 'Toca para consultar';
          copy?.appendChild(hint);
        }
        section.appendChild(line);
      });
      body.appendChild(section);
    });
    if (payload.footer) {
      const footer = document.createElement('div');
      footer.className = 'gfc-yarbi-board-footer';
      footer.textContent = payload.footer;
      body.appendChild(footer);
    }
  }
  function renderTimelineItem(item) {
    const box = document.getElementById('gfc-copilot-chat-messages');
    if (!box || !item) return;
    const shouldFollow = chatIsNearBottom(box);
    const key = dayKey(item.at);
    if (key !== renderedDay) {
      const divider = document.createElement('div');
      divider.className = 'gfc-yarbi-day';
      divider.textContent = dayLabel(item.at);
      box.appendChild(divider);
      renderedDay = key;
    }
    const wrap = document.createElement('div');
    wrap.className = 'gfc-yarbi-message ' + item.role;
    wrap.dataset.messageId = item.id;
    const label = document.createElement('div');
    label.className = 'gfc-yarbi-message-label';
    label.textContent = item.role === 'user' ? 'Tú' : 'Yarbi';
    const body = document.createElement('div');
    body.className = 'gfc-yarbi-message-body';
    const dashboard = item.role === 'assistant' ? boardPayload(item.text) : null;
    if (!dashboard && window.YarbiConversationRenderer && typeof window.YarbiConversationRenderer.appendMessage === 'function') {
      const rendered = window.YarbiConversationRenderer.appendMessage(box, { role:item.role, text:item.text, status:'complete' });
      if (rendered.ok && rendered.element) {
        rendered.element.classList.add('gfc-yarbi-message');
        rendered.element.dataset.messageId = item.id;
        const time = document.createElement('div');
        time.className = 'gfc-yarbi-message-time';
        time.textContent = timeLabel(item.at);
        rendered.element.appendChild(time);
        return rendered;
      }
    }
    if (dashboard) {
      wrap.classList.add('board-message');
      renderBoardBody(body, dashboard);
    } else body.textContent = item.text;
    const time = document.createElement('div');
    time.className = 'gfc-yarbi-message-time';
    time.textContent = timeLabel(item.at);
    wrap.append(label, body, time);
    box.appendChild(wrap);
    if (shouldFollow) box.scrollTop = box.scrollHeight;
  }

  // La transcripcion Live se pinta como un borrador visual y se persiste una
  // sola vez cuando Gemini cierra el turno. De esta forma el usuario ve cada
  // palabra al llegar sin llenar Supabase/localStorage con fragmentos.
  const liveTranscriptDrafts = new Map();
  const finalizedLiveTranscriptKeys = new Map();
  function liveIdentityComponent(value) {
    // La marca de tipo evita confundir un valor ausente, null o la cadena
    // literal "undefined". Codificamos unidades UTF-16 en hexadecimal para
    // que la clave sea reversible, segura como atributo DOM y no pierda
    // espacios, Unicode, mayúsculas ni separadores internos.
    if (typeof value === 'undefined') return 'u';
    if (value === null) return 'n';
    const type = typeof value;
    if (type === 'number' && (!Number.isFinite(value) || !Number.isSafeInteger(value))) return null;
    if (!['string', 'number', 'boolean', 'bigint'].includes(type)) return null;
    const raw = type === 'string' ? value : String(value);
    let hex = '';
    for (let index = 0; index < raw.length; index += 1) hex += raw.charCodeAt(index).toString(16).padStart(4, '0');
    const prefix = type === 'string' ? 's' : type === 'number' ? 'd' : type === 'boolean' ? 'b' : 'g';
    return prefix + raw.length.toString(36) + '_' + hex;
  }
  function liveIdentityValue(options, name) {
    return options && Object.prototype.hasOwnProperty.call(options, name) ? options[name] : undefined;
  }
  function liveIdentityOptions(options) {
    if (options && Object.prototype.hasOwnProperty.call(options, 'liveSessionId')) return options;
    const sessionId = window._gfcLiveSession?.liveSessionId;
    return typeof sessionId === 'undefined' ? (options || {}) : { ...(options || {}), liveSessionId:sessionId };
  }
  function liveIdentityTuple(role, turnId, options) {
    if (role !== 'user' && role !== 'assistant') return null;
    const safeRole = liveIdentityComponent(role);
    const session = liveIdentityComponent(liveIdentityValue(options, 'liveSessionId'));
    const turn = liveIdentityComponent(turnId);
    if (!safeRole || !session || !turn) return null;
    return 'r' + safeRole + '_s' + session + '_t' + turn;
  }
  function liveTranscriptKey(role, turnId, options) {
    const tuple = liveIdentityTuple(role, turnId, options);
    return tuple ? 'live-draft-v2_' + tuple : null;
  }
  function liveFinalizationKey(role, turnId, options) {
    const tuple = liveIdentityTuple(role, turnId, options);
    return tuple ? 'live-final-v2_' + tuple : null;
  }
  function liveTranscriptItemId(role, turnId, options) {
    // No hay límite propio para id en el almacenamiento local ni en el
    // atributo data-* usado aquí. Por eso no se recortan componentes: si el
    // navegador no puede persistir una entrada excepcionalmente grande, la
    // finalización queda pendiente de recuperación, sin degradarla a otro id.
    const tuple = liveIdentityTuple(role, turnId, options);
    return tuple ? 'yl_v2_' + tuple : null;
  }
  function chatIsNearBottom(box) {
    return !box || (box.scrollHeight - box.scrollTop - box.clientHeight) < 110;
  }
  function pruneFinalizedLiveKeys() {
    if (finalizedLiveTranscriptKeys.size <= 80) return;
    [...finalizedLiveTranscriptKeys.keys()].slice(0, finalizedLiveTranscriptKeys.size - 60).forEach(key => finalizedLiveTranscriptKeys.delete(key));
  }
  function ensureLiveTranscriptDraft(role, turnId, placeholder, options) {
    const training = interactionMode() === 'training';
    const box = training ? document.getElementById('gfc-yarbi-training-chat') : document.getElementById('gfc-copilot-chat-messages');
    if (!box) return null;
    const key = liveTranscriptKey(role, turnId, liveIdentityOptions(options));
    if (!key) return null;
    let draft = liveTranscriptDrafts.get(key);
    if (draft?.wrap?.isConnected) return draft;
    const shouldScroll = chatIsNearBottom(box);
    const today = dayKey(Date.now());
    if (!training && today !== renderedDay) {
      const divider = document.createElement('div');
      divider.className = 'gfc-yarbi-day';
      divider.textContent = dayLabel(Date.now());
      box.appendChild(divider);
      renderedDay = today;
    }
    const wrap = document.createElement('div');
    wrap.className = 'gfc-yarbi-message ' + (role === 'user' ? 'user' : 'assistant') + ' is-live';
    wrap.dataset.liveDraftKey = key;
    const label = document.createElement('div');
    label.className = 'gfc-yarbi-message-label';
    label.textContent = role === 'user' ? 'Tú · hablando' : 'Yarbi · respondiendo';
    const body = document.createElement('div');
    body.className = 'gfc-yarbi-message-body';
    body.textContent = String(placeholder || (role === 'user' ? 'Escuchando…' : 'Preparando respuesta…'));
    const time = document.createElement('div');
    time.className = 'gfc-yarbi-message-time';
    time.textContent = 'ahora · en vivo';
    wrap.append(label, body, time);
    box.appendChild(wrap);
    draft = { key, role:role === 'user' ? 'user' : 'assistant', turnId:String(turnId ?? ''), wrap, label, body, time, text:'' };
    liveTranscriptDrafts.set(key, draft);
    if (shouldScroll) box.scrollTop = box.scrollHeight;
    return draft;
  }
  window.gfcBeginLiveTranscriptDraft = function(role, turnId, placeholder, options) {
    return ensureLiveTranscriptDraft(role, turnId, placeholder, options);
  };
  window.gfcUpdateLiveTranscriptDraft = function(role, text, turnId, options) {
    const value = String(text || '').trim();
    const draft = ensureLiveTranscriptDraft(role, turnId, value || undefined, options);
    if (!draft || !value) return false;
    const box = draft.wrap.parentElement;
    const shouldScroll = chatIsNearBottom(box);
    draft.text = value;
    draft.body.textContent = value;
    if (shouldScroll && box) box.scrollTop = box.scrollHeight;
    return true;
  };
  window.gfcFinalizeLiveTranscriptDraft = async function(role, text, turnId, options) {
    const value = String(text || '').trim();
    const opts = liveIdentityOptions(options);
    const draftKey = liveTranscriptKey(role, turnId, opts);
    if (!draftKey) return false;
    const draft = liveTranscriptDrafts.get(draftKey);
    if (!value) {
      if (draft?.wrap?.isConnected) draft.wrap.remove();
      liveTranscriptDrafts.delete(draftKey);
      return false;
    }
    const finalizationKey = liveFinalizationKey(role, turnId, opts);
    if (!finalizationKey) return false;
    if (finalizedLiveTranscriptKeys.has(finalizationKey)) return true;
    const itemId = liveTranscriptItemId(role, turnId, opts);
    if (!itemId) return false;
    const item = opts.persist === false
      ? normalizeTimelineItem({ id:itemId || undefined, role, text:value, at:Date.now(), channel:opts.channel || 'voice' })
      : await persistTimelineMessage(role, value, Date.now(), opts.channel || 'voice', itemId || undefined);
    if (!item) return false;
    const training = interactionMode() === 'training';
    const box = training ? document.getElementById('gfc-yarbi-training-chat') : document.getElementById('gfc-copilot-chat-messages');
    if (!training) {
      // El borrador Live nunca se convierte directamente en un mensaje final del
      // chat normal: confirmamos primero la representación del mensaje persistido
      // con el renderer canónico y recién entonces retiramos el borrador.
      let rendered = !!box?.querySelector('[data-message-id="' + item.id + '"]');
      if (!rendered && box) {
        try { renderTimelineItem(item); } catch (_) {}
        rendered = !!box.querySelector('[data-message-id="' + item.id + '"]');
      }
      // Si la persistencia funcionó pero la presentación no, dejamos el
      // borrador y permitimos un callback posterior; nunca confirmamos una
      // finalización invisible como si hubiera terminado correctamente.
      if (!rendered) return false;
      if (draft?.wrap?.isConnected) draft.wrap.remove();
    } else if (draft?.wrap?.isConnected) {
      // El simulador de entrenamiento conserva su superficie independiente;
      // el historial conversacional normal siempre usa el renderer canónico.
      draft.wrap.classList.remove('is-live');
      draft.wrap.removeAttribute('data-live-draft-key');
      draft.wrap.dataset.messageId = item.id;
      draft.label.textContent = role === 'user' ? 'Tú' : 'Yarbi';
      draft.body.textContent = value;
      draft.time.textContent = timeLabel(item.at);
    } else {
      if (box && !box.querySelector('[data-message-id="' + item.id + '"]')) renderTimelineItem(item);
    }
    liveTranscriptDrafts.delete(draftKey);
    finalizedLiveTranscriptKeys.set(finalizationKey, item.id);
    pruneFinalizedLiveKeys();
    if (box && chatIsNearBottom(box)) box.scrollTop = box.scrollHeight;
    return true;
  };
  window.gfcDiscardLiveTranscriptDraft = function(turnId, role, options) {
    const identityOptions = liveIdentityOptions(options);
    const roles = role ? [role] : ['user', 'assistant'];
    roles.forEach(candidateRole => {
      const key = liveTranscriptKey(candidateRole, turnId, identityOptions);
      if (!key) return;
      const draft = liveTranscriptDrafts.get(key);
      if (!draft) return;
      if (draft?.wrap?.isConnected) draft.wrap.remove();
      liveTranscriptDrafts.delete(key);
    });
  };

  window.gfcAppendCopilotTimelineMessage = async function (role, text, at, options) {
    if (typeof text !== 'string' || !text.trim()) return { handled:true, result:{ ok:false, code:'content_empty' } };
    const opts = options || {};
    const item = opts.persist === false
      ? normalizeTimelineItem({ id:opts.id, role, text, at:at || opts.at || Date.now(), channel:opts.channel || 'chat', conversation_id:opts.conversationId || opts.conversation_id || activeConversationId() })
      : await persistTimelineMessage(role, text, at || opts.at, opts.channel, opts.id, opts.conversationId || opts.conversation_id);
    if (!item) return { handled:true, result:{ ok:false, code:'timeline_item_invalid' } };
    const box = document.getElementById('gfc-copilot-chat-messages');
    if (!box) return { handled:false };
    if ([...box.querySelectorAll('[data-message-id]')].some(node => node.dataset.messageId === item.id)) return { handled:true, result:{ ok:true, duplicate:true } };
    const rendered = renderTimelineItem(item);
    return { handled:true, result:{ ok:true, timelineId:item.id, rendered:!!rendered } };
  };
  async function refreshConversationTimelineRenderer() {
    const box = document.getElementById('gfc-copilot-chat-messages');
    if (!box || box.dataset.gfcRestored !== '1') return;
    let timeline;
    try { timeline = await loadTimeline(); } catch (_) { return; }
    timeline.forEach(item => {
      if (!box.querySelector('[data-message-id="' + item.id + '"]')) renderTimelineItem(item);
    });
  }
  function restoreConversationScroll(box) {
    const saved = conversationScrollTop(activeConversationId());
    box.scrollTop = saved === null ? box.scrollHeight : Math.min(saved, Math.max(0, box.scrollHeight - box.clientHeight));
  }
  function watchConversationScroll(box) {
    if (!box || box.dataset.gfcConversationScrollBound === '1') return;
    box.dataset.gfcConversationScrollBound = '1';
    box.addEventListener('scroll', () => saveConversationScrollTop(activeConversationId(), box.scrollTop), { passive:true });
  }
  function installConversationStoreSubscription() {
    if (unsubscribeConversationStore) return;
    conversationStore().then(store => {
      if (unsubscribeConversationStore) return;
      unsubscribeConversationStore = store.subscribe(() => { void refreshConversationTimelineRenderer(); });
    }).catch(() => {});
  }
  window.gfcRestoreCopilotChat = async function () {
    const box = document.getElementById('gfc-copilot-chat-messages');
    if (!box || box.dataset.gfcRestored === '1') return;
    box.dataset.gfcRestored = '1';
    let timeline;
    try { timeline = await loadTimeline(); }
    catch (_) { box.dataset.gfcRestored = '0'; return; }
    installConversationStoreSubscription();
    // El antiguo localStorage solo se importa una vez, dentro del historial
    // heredado. Una conversación nueva debe empezar realmente vacía.
    if (!timeline.length && activeConversationId() === DEFAULT_CONVERSATION_ID) {
      const migrated = [];
      try {
        (typeof gfcLoadCopilotHistory === 'function' ? gfcLoadCopilotHistory() : []).forEach((item, i) => migrated.push(normalizeTimelineItem({ role:item.role === 'user' ? 'user' : 'assistant', text:item.parts?.[0]?.text, at:Date.now() - (40-i)*1000, channel:'migrated' })));
        const live = typeof gfcLoadLiveMemory === 'function' ? gfcLoadLiveMemory() : { turns:[] };
        (live.turns || []).slice(-20).forEach((turn, i) => {
          const base = Number(turn.at || turn.createdAt || Date.now() - (20-i)*60000);
          if (turn.input) migrated.push(normalizeTimelineItem({ role:'user', text:turn.input, at:base, channel:'voice' }));
          if (turn.output) migrated.push(normalizeTimelineItem({ role:'assistant', text:turn.output, at:base+1, channel:'voice' }));
        });
      } catch (_) {}
      try {
        await importTimeline(migrated.filter(Boolean));
        timeline = await loadTimeline();
      } catch (_) { box.dataset.gfcRestored = '0'; return; }
    }
    renderedDay = '';
    timeline.forEach(renderTimelineItem);
    restoreConversationScroll(box);
    watchConversationScroll(box);
    syncTimelineFromCloud().then(list => {
      if (!document.getElementById('gfc-copilot-chat-messages')) return;
      if (list.length !== timeline.length) {
        box.innerHTML = ''; renderedDay = ''; list.forEach(renderTimelineItem); restoreConversationScroll(box);
      }
    }).catch(() => {});
  };

  function conversationDateLabel(value) {
    try { return new Intl.DateTimeFormat('es-PE', { timeZone:'America/Lima', day:'numeric', month:'short' }).format(new Date(value)); }
    catch (_) { return ''; }
  }
  function conversationHistoryHtml() {
    return '<main class="gfc-yarbi-tool-page"><section class="gfc-yarbi-tool-card">' +
      '<div class="gfc-yarbi-tool-title">Conversaciones</div>' +
      '<div class="gfc-yarbi-tool-copy">Tu historial permanece en este dispositivo. Abrir o crear una conversación no envía mensajes ni modifica datos comerciales.</div>' +
      '<div class="gfc-yarbi-conversation-actions"><button class="gfc-yarbi-primary" onclick="gfcStartNewYarbiConversation()">＋ Nueva conversación</button><input id="gfc-yarbi-conversation-search" type="search" placeholder="Buscar en tus conversaciones" oninput="gfcRenderYarbiConversationHistory(this.value)"></div>' +
      '<div id="gfc-yarbi-conversation-history" class="gfc-yarbi-conversation-history" aria-live="polite">Cargando conversaciones…</div>' +
      '</section></main>';
  }
  window.gfcRenderYarbiConversationHistory = async function(query) {
    const target = document.getElementById('gfc-yarbi-conversation-history');
    if (!target) return;
    target.textContent = 'Cargando conversaciones…';
    try {
      const store = await conversationStore();
      const conversations = await store.searchConversations(query || '');
      const active = activeConversationId();
      if (!conversations.length) {
        target.innerHTML = '<p class="gfc-yarbi-empty-copy">No hay conversaciones que coincidan. Puedes empezar una nueva.</p>';
        return;
      }
      target.innerHTML = conversations.slice(0, 80).map(item => {
        const id = safeConversationId(item.id);
        const current = id === active;
        const detail = (Number(item.messageCount) || 0) + ' mensaje' + ((Number(item.messageCount) || 0) === 1 ? '' : 's') + ' · ' + conversationDateLabel(item.lastMessageAt || item.updatedAt);
        return '<article class="gfc-yarbi-conversation-row' + (current ? ' active' : '') + '"><button type="button" class="gfc-yarbi-conversation-open" onclick="gfcOpenYarbiConversation(\'' + id + '\')"><span><b>' + esc(item.title || 'Nueva conversación') + '</b><small>' + esc(detail) + '</small></span><em>' + (current ? 'Abierta' : 'Abrir') + '</em></button><span class="gfc-yarbi-conversation-controls"><button type="button" aria-label="Exportar como imagen" onclick="gfcExportYarbiConversationImage(\'' + id + '\')">▧</button><button type="button" aria-label="Editar título" onclick="gfcRenameYarbiConversation(\'' + id + '\')">✎</button><button type="button" aria-label="Eliminar conversación" onclick="gfcDeleteYarbiConversation(\'' + id + '\')">⌫</button></span></article>';
      }).join('');
    } catch (_) {
      target.innerHTML = '<p class="gfc-yarbi-empty-copy">El historial local no está disponible ahora. Tus conversaciones existentes no se han borrado.</p>';
    }
  };
  window.gfcOpenYarbiConversation = async function(conversationId) {
    const id = safeConversationId(conversationId);
    try {
      const store = await conversationStore();
      const known = (await store.listConversations()).some(item => item.id === id);
      if (!known) { if (typeof toast === 'function') toast('Esa conversación ya no está disponible en esta copia local.', 'warning'); return false; }
      setActiveConversationId(id);
      window.gfcOpenCopilotModal('chat');
      return true;
    } catch (_) {
      if (typeof toast === 'function') toast('No pude abrir la conversación local.', 'warning');
      return false;
    }
  };
  window.gfcRenameYarbiConversation = async function(conversationId) {
    const id = safeConversationId(conversationId);
    try {
      const store = await conversationStore();
      const current = (await store.listConversations()).find(item => item.id === id);
      if (!current) return false;
      const next = prompt('Nombre de la conversación:', current.title || 'Nueva conversación');
      if (next === null) return false;
      const result = await store.renameConversation(id, next);
      if (!result.ok) { if (typeof toast === 'function') toast('El título no se pudo guardar.', 'warning'); return false; }
      await window.gfcRenderYarbiConversationHistory(document.getElementById('gfc-yarbi-conversation-search')?.value || '');
      return true;
    } catch (_) {
      if (typeof toast === 'function') toast('No pude editar el título local.', 'warning');
      return false;
    }
  };
  window.gfcDeleteYarbiConversation = async function(conversationId) {
    const id = safeConversationId(conversationId);
    if (!confirm('¿Eliminar esta conversación de este dispositivo? Esta acción no cambia clientes, agenda, memoria empresarial ni mensajes enviados.')) return false;
    try {
      const store = await conversationStore();
      const result = await store.deleteConversation(id);
      if (!result.ok) { if (typeof toast === 'function') toast('No pude eliminar esa conversación local.', 'warning'); return false; }
      forgetConversationView(id);
      forgetConversationDraft(id);
      if (activeConversationId() === id) return window.gfcStartNewYarbiConversation();
      await window.gfcRenderYarbiConversationHistory(document.getElementById('gfc-yarbi-conversation-search')?.value || '');
      if (typeof toast === 'function') toast('Conversación eliminada de este dispositivo.', 'success');
      return true;
    } catch (_) {
      if (typeof toast === 'function') toast('No pude eliminar esa conversación local.', 'warning');
      return false;
    }
  };
  function conversationExportFileName(title) {
    const normalized = String(title || 'conversacion-yarbi')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 54);
    return (normalized || 'conversacion-yarbi') + '.jpg';
  }
  function conversationExportDate(value) {
    try {
      return new Intl.DateTimeFormat('es-PE', {
        timeZone:'America/Lima', day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'
      }).format(new Date(value));
    } catch (_) { return ''; }
  }
  function wrapConversationExportText(context, text, maxWidth) {
    const lines = [];
    String(text || '').replace(/\r/g, '').split('\n').forEach(paragraph => {
      const words = paragraph.split(/\s+/).filter(Boolean);
      if (!words.length) { lines.push(''); return; }
      let line = '';
      words.forEach(word => {
        const proposal = line ? line + ' ' + word : word;
        if (line && context.measureText(proposal).width > maxWidth) { lines.push(line); line = word; }
        else line = proposal;
      });
      if (line) lines.push(line);
    });
    return lines.length ? lines : [''];
  }
  function drawConversationExportCard(context, x, y, width, height) {
    context.beginPath();
    if (typeof context.roundRect === 'function') context.roundRect(x, y, width, height, 22);
    else context.rect(x, y, width, height);
  }
  window.gfcExportYarbiConversationImage = async function(conversationId) {
    const id = safeConversationId(conversationId || activeConversationId());
    try {
      const store = await conversationStore();
      const conversation = (await store.listConversations()).find(item => item.id === id);
      const timeline = await store.listTimeline(id);
      if (!conversation) throw storageError('conversation_not_found');
      if (!timeline.length) { if (typeof toast === 'function') toast('Esta conversación todavía no tiene mensajes para exportar.', 'warning'); return false; }
      if (!document.createElement || !URL?.createObjectURL) throw storageError('image_export_unavailable');
      const canvas = document.createElement('canvas');
      const context = canvas.getContext?.('2d');
      if (!context || typeof canvas.toBlob !== 'function') throw storageError('image_export_unavailable');
      // La imagen no se sube. El límite solo protege al dispositivo: la conversación completa queda intacta en IndexedDB.
      const visible = timeline.slice(-100).map(item => ({
        ...item,
        text:String(item.text || '').slice(0, 1400) + (String(item.text || '').length > 1400 ? '…' : '')
      }));
      const width = 1200;
      const padding = 64;
      const contentWidth = width - padding * 2;
      const prepared = visible.map(item => {
        context.font = '400 29px system-ui, -apple-system, Segoe UI, sans-serif';
        const lines = wrapConversationExportText(context, item.text, contentWidth - 54);
        return { item, lines, height:76 + lines.length * 41 };
      });
      const contentHeight = prepared.reduce((total, entry) => total + entry.height + 22, 0);
      const note = timeline.length > visible.length ? 'Incluye los últimos ' + visible.length + ' mensajes de esta conversación.' : 'Exportación local: no se envió información a ningún servicio.';
      const height = Math.max(460, Math.min(16384, 210 + contentHeight + 116));
      canvas.width = width;
      canvas.height = height;
      context.fillStyle = '#f8fafc';
      context.fillRect(0, 0, width, height);
      context.fillStyle = '#0f172a';
      context.font = '700 42px system-ui, -apple-system, Segoe UI, sans-serif';
      context.fillText(String(conversation.title || 'Conversación con Yarbi').slice(0, 74), padding, 76);
      context.fillStyle = '#64748b';
      context.font = '500 22px system-ui, -apple-system, Segoe UI, sans-serif';
      context.fillText('Yarbi · historial local · ' + conversationExportDate(Date.now()), padding, 116);
      let y = 158;
      prepared.forEach(({ item, lines, height:cardHeight }) => {
        if (y + cardHeight > height - 78) return;
        const isUser = item.role === 'user';
        context.fillStyle = isUser ? '#e0f2fe' : '#ffffff';
        context.strokeStyle = isUser ? '#7dd3fc' : '#e2e8f0';
        context.lineWidth = 2;
        drawConversationExportCard(context, padding, y, contentWidth, cardHeight);
        context.fill(); context.stroke();
        context.fillStyle = isUser ? '#0369a1' : '#0f766e';
        context.font = '700 21px system-ui, -apple-system, Segoe UI, sans-serif';
        context.fillText(isUser ? 'Tú' : 'Yarbi', padding + 28, y + 35);
        context.fillStyle = '#0f172a';
        context.font = '400 29px system-ui, -apple-system, Segoe UI, sans-serif';
        lines.forEach((line, index) => context.fillText(line, padding + 28, y + 76 + index * 41));
        y += cardHeight + 22;
      });
      context.fillStyle = '#64748b';
      context.font = '500 19px system-ui, -apple-system, Segoe UI, sans-serif';
      context.fillText(note, padding, height - 36);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
      if (!blob) throw storageError('image_export_failed');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = conversationExportFileName(conversation.title); link.style.display = 'none';
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (typeof toast === 'function') toast('Imagen de conversación guardada en este dispositivo.', 'success');
      return true;
    } catch (_) {
      if (typeof toast === 'function') toast('No pude crear la imagen local de esta conversación.', 'warning');
      return false;
    }
  };
  window.gfcStartNewYarbiConversation = async function() {
    try {
      const store = await conversationStore();
      const id = newConversationId();
      const result = await store.createConversation({ id, title:'Nueva conversación' });
      if (!result?.ok) throw storageError(result?.code || 'conversation_creation_failed');
      setActiveConversationId(result.conversation.id);
      window.gfcToggleYarbiMainMenu(false);
      window.gfcOpenCopilotModal('chat');
      window.setTimeout(() => {
        if (activeConversationId() !== result.conversation.id) return;
        window.gfcAppendCopilotTimelineMessage('assistant', 'Hola, estoy listo para ayudarte. ¿Qué quieres revisar?', Date.now(), { channel:'session', conversationId:result.conversation.id });
      }, 0);
      return true;
    } catch (_) {
      if (typeof toast === 'function') toast('No pude crear una conversación local segura.', 'warning');
      return false;
    }
  };

  function activeMode() { return typeof gfcGetActiveYarbiMode === 'function' ? gfcGetActiveYarbiMode() : { id:'copilot', label:'Copiloto', voice:'Kore', icon:'🤖' }; }
  function allModes() {
    try { return typeof GFC_YARBI_MODE_CONFIG !== 'undefined' ? Object.values(GFC_YARBI_MODE_CONFIG) : [activeMode()]; }
    catch (_) { return [activeMode()]; }
  }
  function headerHtml(title, tab) {
    const mode = activeMode();
    const sectionStatus = tab === 'chat'
      ? (interactionMode() === 'training' ? '● Entrenamiento seguro' : '● Verificando…')
      : (tab === 'ordenes' ? '● Instrucciones disponibles' : '● Herramientas de Yarbi');
    return '<header class="gfc-yarbi-header">' +
      '<button class="gfc-yarbi-back" onclick="gfcHandleYarbiBack()" aria-label="Volver">‹</button>' +
      '<div class="gfc-yarbi-brand"><div class="gfc-yarbi-avatar" aria-hidden="true">Y</div><div style="min-width:0"><div class="gfc-yarbi-brand-title">' + esc(title || 'Yarbi') + '</div><div class="gfc-yarbi-online" id="gfc-yarbi-header-status">' + sectionStatus + '</div></div></div>' +
      '<button class="gfc-yarbi-mode-pill" id="gfc-yarbi-mode-chip" onclick="gfcToggleYarbiModeMenu()">' + esc(mode.label + ' · ' + mode.voice) + '</button>' +
      '<button class="gfc-yarbi-icon-btn" onclick="gfcToggleYarbiMainMenu()" aria-label="Menú">⋮</button>' +
      '<div id="gfc-yarbi-mode-menu" class="gfc-yarbi-popover gfc-yarbi-hidden">' +
        allModes().map(m => '<button onclick="gfcSetYarbiMode(\'' + m.id + '\');gfcToggleYarbiModeMenu(false)">' + esc(m.icon + ' ' + m.label + ' · ' + m.voice) + '</button>').join('') +
      '</div>' +
      '<div id="gfc-yarbi-main-menu" class="gfc-yarbi-popover gfc-yarbi-hidden">' +
        '<button onclick="gfcOpenCopilotModal(\'conversations\')">💬 Historial de conversaciones</button>' +
        '<button onclick="gfcStartNewYarbiConversation()">＋ Nueva conversación</button>' +
        '<button onclick="gfcExportYarbiConversationImage()">▧ Guardar conversación como imagen</button>' +
        '<button onclick="gfcOpenCopilotModal(\'learning\')">📊 Aprendizaje y autonomía</button>' +
        '<button onclick="gfcOpenCopilotModal(\'tools\')">🧠 Memoria y aprendizaje</button>' +
        '<button onclick="gfcOpenCopilotModal(\'status\')">✅ Estado y diagnóstico</button>' +
        '<button onclick="gfcConfirmRestartYarbiConversation()">↻ Reiniciar conversación</button>' +
      '</div></header>';
  }
  window.gfcToggleYarbiModeMenu = function(force) {
    const target = document.getElementById('gfc-yarbi-mode-menu');
    const other = document.getElementById('gfc-yarbi-main-menu');
    if (other) other.classList.add('gfc-yarbi-hidden');
    if (!target) return;
    const show = force === undefined ? target.classList.contains('gfc-yarbi-hidden') : !!force;
    target.classList.toggle('gfc-yarbi-hidden', !show);
  };
  window.gfcToggleYarbiMainMenu = function(force) {
    const target = document.getElementById('gfc-yarbi-main-menu');
    const other = document.getElementById('gfc-yarbi-mode-menu');
    if (other) other.classList.add('gfc-yarbi-hidden');
    if (!target) return;
    const show = force === undefined ? target.classList.contains('gfc-yarbi-hidden') : !!force;
    target.classList.toggle('gfc-yarbi-hidden', !show);
  };
  window.gfcCloseYarbiScreen = function() {
    window._gfcYarbiCurrentTab = '';
    window._gfcYarbiViewGeneration = Number(window._gfcYarbiViewGeneration || 0) + 1;
    document.body.classList.remove('gfc-yarbi-screen');
    if (typeof closeModal === 'function') closeModal();
  };
  window.gfcHandleYarbiBack = function() {
    if (!document.body.classList.contains('gfc-yarbi-screen')) return false;
    const tab = String(window._gfcYarbiCurrentTab || 'chat');
    if (tab === 'masivo' || tab === 'memoria' || tab === 'knowledge' || tab === 'ads' || tab === 'ordenes' || tab === 'practice' || tab === 'learning') {
      window.gfcOpenCopilotModal('tools');
      return true;
    }
    if (tab === 'tools' || tab === 'status') {
      window.gfcOpenCopilotModal('chat');
      return true;
    }
    window.gfcCloseYarbiScreen();
    return true;
  };
  window.gfcConfirmRestartYarbiConversation = async function() {
    if (!confirm('Se abrirá una conversación nueva. Las conversaciones anteriores, clientes, WhatsApp, agenda e instrucciones se conservan. ¿Continuar?')) return;
    if (typeof gfcYarbiConversationFocusClear === 'function') gfcYarbiConversationFocusClear('restart-conversation');
    await window.gfcStartNewYarbiConversation();
  };

  function chatHtml() {
    const training = interactionMode() === 'training';
    const proactive = typeof gfcProactiveAlertStripHtml === 'function' ? gfcProactiveAlertStripHtml() : '';
    const switcher = '<div class="gfc-yarbi-interaction-switch" role="tablist" aria-label="Tipo de conversación">' +
      '<button class="' + (!training ? 'active' : '') + '" onclick="gfcSetYarbiInteractionMode(\'normal\')">💬 Trabajo real</button>' +
      '<button class="training ' + (training ? 'active' : '') + '" onclick="gfcSetYarbiInteractionMode(\'training\')">🎭 Entrenamiento</button></div>';
    const trainingTools = training ?
      '<div class="gfc-yarbi-training-unified-banner"><b>🔒 Entrenamiento seguro</b><span>Usa la misma voz Live, pero no envía WhatsApp ni modifica clientes, agenda o dinero.</span></div>' +
      '<div class="gfc-yarbi-training-quick"><button onclick="gfcYarbiUnifiedQuick(\'¿Cómo responderías a un cliente que pide precio?\')">Pedir una respuesta</button><button onclick="gfcYarbiUnifiedQuick(\'Deberías responder más corto y natural\')">Corregir a Yarbi</button><button onclick="gfcYarbiUnifiedQuick(\'Guarda eso como instrucción\')">Guardar aprendizaje</button></div>' : '';
    const quickReads = training ? '' : '<div class="gfc-yarbi-quick-reads" aria-label="Consultas rápidas"><button type="button" onclick="gfcYarbiAskQuickRead(\'¿Qué tengo hoy?\')">📅 Hoy</button><button type="button" onclick="gfcYarbiAskQuickRead(\'¿Qué visitas siguen pendientes?\')">📍 Pendientes</button><button type="button" onclick="gfcYarbiAskQuickRead(\'¿Qué clientes tengo que llamar?\')">👥 Clientes</button><button type="button" onclick="gfcYarbiAskQuickRead(\'¿Cuánto hemos cobrado este mes?\')">💰 Cobros</button></div>';
    const conversation = training
      ? '<main id="gfc-yarbi-training-chat" class="gfc-yarbi-chat gfc-yarbi-training-chat gfc-yarbi-training-unified"></main>'
      : '<main id="gfc-copilot-chat-messages" class="gfc-yarbi-chat"></main>';
    const hiddenTrainingFields = training ? '<div class="gfc-yarbi-training-support" hidden><textarea id="gfc-yarbi-training-input"></textarea><textarea id="gfc-yarbi-training-client"></textarea><textarea id="gfc-yarbi-training-response"></textarea><textarea id="gfc-yarbi-training-correction"></textarea><div id="gfc-yarbi-training-status"></div><div id="gfc-yarbi-training-evidence"></div><div id="gfc-yarbi-training-learning"></div><div id="gfc-yarbi-training-tip"><span></span></div></div>' : '';
    return switcher + (training ? trainingTools : learningChipHtml() + '<div class="gfc-yarbi-alert">' + proactive + '</div>' + quickReads) +
      '<div id="gfc-yarbi-conversation-focus" class="gfc-yarbi-focus" hidden></div>' + conversation + hiddenTrainingFields +
      '<footer class="gfc-yarbi-composer-wrap">' +
        '<div class="gfc-yarbi-live-state"><span id="gfc-live-status">Gemini Live listo.</span><span id="gfc-ai-process-status">' + (training ? 'Práctica separada de tus datos reales.' : 'Verificando memoria…') + '</span><button id="gfc-ai-process-btn" hidden></button></div>' +
        '<div class="gfc-yarbi-composer"><textarea id="gfc-copilot-input-text" rows="1" enterkeyhint="send" autocapitalize="sentences" aria-label="Mensaje para Yarbi" placeholder="' + (training ? 'Habla como cliente, corrige o enseña a Yarbi' : 'Escribe un mensaje…') + '" onkeydown="gfcHandleYarbiComposerKeydown(event)" oninput="gfcSaveYarbiConversationDraft(this.value);gfcResizeYarbiComposer(this)"></textarea>' +
        '<button id="gfc-mic-input-btn" class="gfc-yarbi-live-btn" data-live-phase="off" onclick="gfcStartCopilotVoiceInput()" aria-label="Activar conversación por voz"><span class="gfc-live-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><span class="gfc-live-button-label">Live</span></button>' +
        '<button class="gfc-yarbi-send-btn" onclick="gfcSendYarbiUnifiedMessage()">➤</button></div>' +
      '</footer>';
  }
  function hubHtml() {
    return '<main class="gfc-yarbi-tool-page"><div class="gfc-yarbi-tool-card"><div class="gfc-yarbi-tool-title">Memoria y aprendizaje</div><div class="gfc-yarbi-tool-copy">Aquí administras las fuentes que Yarbi usa detrás del chat. Nada de esto ocupa la conversación principal.</div>' +
      '<div class="gfc-yarbi-grid">' +
      '<button class="gfc-yarbi-hub-button" onclick="gfcOpenCopilotModal(\'masivo\')">📦<b>Importar chats</b><span>Aprender tu forma de responder desde TXT o ZIP.</span></button>' +
      '<button class="gfc-yarbi-hub-button" onclick="gfcOpenCopilotModal(\'knowledge\')">📚<b>Conocimiento</b><span>Fuentes locales, revisión explícita y citas verificables.</span></button>' +
      '<button class="gfc-yarbi-hub-button" onclick="gfcOpenCopilotModal(\'ads\')">📣<b>Meta Ads</b><span>Métricas locales aprobadas, leads y ROAS sin conectar campañas.</span></button>' +
      '<button class="gfc-yarbi-hub-button" onclick="gfcOpenCopilotModal(\'memoria\')">📷<b>Fotos y videos</b><span>Biblioteca privada solo en tu celular.</span></button>' +
      '<button class="gfc-yarbi-hub-button" onclick="gfcOpenCopilotModal(\'ordenes\')">📜<b>Instrucciones</b><span>Reglas permanentes visibles, editables y sincronizadas.</span></button>' +
      '<button class="gfc-yarbi-hub-button" onclick="gfcSetYarbiInteractionMode(\'training\')">🎭<b>Entrenamiento</b><span>Entra al mismo chat de Yarbi, con voz Live y sin tocar datos reales.</span></button>' +
      '<button class="gfc-yarbi-hub-button" onclick="gfcOpenCopilotModal(\'learning\')">📊<b>Progreso y autonomía</b><span>Evidencia de aprendizaje y niveles seguros de respuesta.</span></button>' +
      '<button class="gfc-yarbi-hub-button" onclick="gfcOpenCopilotModal(\'status\')">✅<b>Estado</b><span>Procesamiento, memoria local y diagnóstico técnico.</span></button>' +
      '</div></div></main>';
  }

  function learningRequirement(ok, text) {
    return '<li class="' + (ok ? 'done' : 'pending') + '">' + (ok ? '✓ ' : '○ ') + esc(text) + '</li>';
  }
  function learningBar(label, value, max) {
    const safeMax = Math.max(1, Number(max) || 1);
    const percent = Math.max(0, Math.min(100, Math.round((Number(value) || 0) / safeMax * 100)));
    return '<div class="gfc-yarbi-learning-row"><div><b>' + esc(label) + '</b><span>' + Number(value || 0) + ' / ' + safeMax + '</span></div><div class="gfc-yarbi-learning-bar"><i style="width:' + percent + '%"></i></div></div>';
  }
  function learningHtml() {
    const metrics = learningSnapshot();
    const autonomy = autonomyConfig();
    const lastImport = metrics.lastImport ? new Intl.DateTimeFormat('es-PE', { timeZone:'America/Lima', dateStyle:'medium', timeStyle:'short' }).format(new Date(metrics.lastImport)) : 'Todavía no hay una importación confirmada';
    return '<main id="gfc-yarbi-learning-page" class="gfc-yarbi-tool-page">' +
      '<div class="gfc-yarbi-tool-card"><div class="gfc-yarbi-learning-score"><div><strong>' + metrics.score + '%</strong><span>' + esc(metrics.level) + '</span></div><p>Este porcentaje sale de evidencia real: ejemplos, pruebas, cobertura de casos, mensajes tuyos importados, patrones e instrucciones. No mide “inteligencia” inventada.</p></div>' +
      '<div class="gfc-yarbi-tool-title">Qué aprendió Yarbi</div>' +
      learningBar('Casos cubiertos', metrics.intents, LEARNING_INTENTS.length) +
      learningBar('Pruebas aprobadas', metrics.passed, 8) +
      learningBar('Respuestas tuyas analizadas', metrics.outgoing, 100) +
      learningBar('Patrones de estilo activos', metrics.styles, 10) +
      learningBar('Instrucciones activas', metrics.instructions, 8) +
      '<div class="gfc-yarbi-learning-evidence"><b>Evidencia disponible</b><span>' + metrics.examples + ' ejemplo(s) aprobados · ' + metrics.tested + ' probado(s) · ' + metrics.incoming + ' mensaje(s) de clientes</span><span>' + esc(lastImport) + '</span>' + (metrics.failed ? '<em>⚠ ' + metrics.failed + ' prueba(s) requieren corrección.</em>' : '') + (metrics.unresolved ? '<em>⚠ ' + metrics.unresolved + ' chat(s) sin identidad verificable.</em>' : '') + '</div></div>' +
      '<div class="gfc-yarbi-tool-card"><div class="gfc-yarbi-tool-title">Nivel de autonomía</div><div class="gfc-yarbi-tool-copy">Cambiar este nivel no autoriza envíos automáticos. En esta versión Yarbi solo puede observar, sugerir o dejar una respuesta lista para tu aprobación.</div>' +
      '<div class="gfc-yarbi-autonomy-list">' +
        '<button class="' + (autonomy.mode === 'observe' ? 'active' : '') + '" onclick="gfcYarbiSetAutonomyMode(\'observe\')"><b>1 · Observación</b><span>Aprende y detecta oportunidades; no redacta por iniciativa propia.</span></button>' +
        '<button class="' + (autonomy.mode === 'suggest' ? 'active' : '') + '" onclick="gfcYarbiSetAutonomyMode(\'suggest\')"><b>2 · Solo sugerencias</b><span>Propone respuestas y seguimientos; tú decides qué hacer.</span></button>' +
        '<button class="' + (autonomy.mode === 'approval' ? 'active' : '') + '" onclick="gfcYarbiSetAutonomyMode(\'approval\')"><b>3 · Aprobación rápida</b><span>Deja el mensaje listo, pero nada sale sin tu confirmación.</span></button>' +
        '<button class="locked" onclick="gfcYarbiExplainLockedAutonomy(\'pilot\')"><b>🔒 4 · Piloto controlado</b><span>Solo para pocos clientes y horarios definidos, después de superar pruebas.</span></button>' +
        '<button class="locked" onclick="gfcYarbiExplainLockedAutonomy(\'auto\')"><b>🔒 5 · Responder por mí</b><span>Desactivado. Requerirá reglas de Meta, exclusiones, freno inmediato y derivación humana.</span></button>' +
      '</div>' +
      '<ul class="gfc-yarbi-learning-checklist">' +
        learningRequirement(metrics.examples >= 10, '10 ejemplos aprobados (' + metrics.examples + ')') +
        learningRequirement(metrics.passed >= 6, '6 pruebas diferentes aprobadas (' + metrics.passed + ')') +
        learningRequirement(metrics.intents >= 5, '5 tipos de consulta cubiertos (' + metrics.intents + ')') +
        learningRequirement(metrics.outgoing >= 40, '40 respuestas tuyas analizadas (' + metrics.outgoing + ')') +
        learningRequirement(metrics.styles >= 5, '5 patrones de estilo activos (' + metrics.styles + ')') +
        learningRequirement(metrics.failed === 0, 'Ninguna prueba fallida (' + metrics.failed + ')') +
        learningRequirement(metrics.unresolved === 0, 'Todos los chats con identidad verificable (' + metrics.unresolved + ' pendientes)') +
      '</ul>' +
      '<div class="gfc-yarbi-safety">🛑 Freno de emergencia siempre activo. Fuera de la ventana permitida por WhatsApp se usarán únicamente plantillas aprobadas; los casos sensibles pasarán a una persona.</div>' +
      '<div class="gfc-yarbi-training-actions"><button class="gfc-yarbi-primary" onclick="gfcOpenCopilotModal(\'practice\')">Probar respuestas</button><button class="gfc-yarbi-secondary" onclick="gfcOpenCopilotModal(\'masivo\')">Importar conversación</button></div></div></main>';
  }
  window.gfcYarbiSetAutonomyMode = function(mode) {
    const safe = ['observe','suggest','approval'].includes(String(mode)) ? String(mode) : 'observe';
    writeJson(AUTONOMY_KEY, { mode:safe, emergencyStop:true, updatedAt:Date.now() });
    if (typeof gfcAccountSettingsSync === 'function' && typeof gfcAccountAccessToken === 'function' && gfcAccountAccessToken()) Promise.resolve(gfcAccountSettingsSync()).catch(() => {});
    if (typeof toast === 'function') toast(safe === 'approval' ? 'Aprobación rápida activa. Ningún mensaje se enviará sin tu confirmación.' : safe === 'suggest' ? 'Yarbi propondrá respuestas, sin enviarlas.' : 'Yarbi quedó en modo observación.', 'success');
    window.gfcOpenCopilotModal('learning');
  };
  window.gfcYarbiExplainLockedAutonomy = function(level) {
    const metrics = learningSnapshot();
    const target = level === 'auto' ? 'Responder por mí' : 'Piloto controlado';
    const reason = metrics.pilotEligible ? 'La evidencia mínima está completa, pero todavía falta ejecutar y aprobar una prueba real controlada antes de desbloquearlo.' : 'Aún faltan requisitos de aprendizaje y pruebas visibles en esta pantalla.';
    if (typeof toast === 'function') toast(target + ' sigue bloqueado. ' + reason, 'warning');
  };

  function trainingNormalizeText(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9ñ\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function trainingIntent(text) {
    const value = trainingNormalizeText(text);
    if (/precio|cuanto|cotiz|presupuesto/.test(value)) return 'cotizacion';
    if (/ubicacion|direccion|maps|donde/.test(value)) return 'ubicacion';
    if (/visita|venir|agenda|cita|disponib/.test(value)) return 'agenda';
    if (/cancel|reprogram|viaje|otro dia/.test(value)) return 'reprogramacion';
    if (/pago|yape|transfer|efectivo|cobro/.test(value)) return 'pago';
    if (/garantia|reclamo|problema|falla/.test(value)) return 'postventa';
    return 'consulta_general';
  }
  function trainingService(text) {
    const value = trainingNormalizeText(text);
    if (/modific/.test(value)) return 'modificacion';
    if (/punto adicional|punto de gas/.test(value)) return 'punto_adicional';
    if (/gasfiter/.test(value)) return 'gasfiteria';
    if (/instalac|construccion/.test(value)) return 'instalacion';
    if (/reparac/.test(value)) return 'reparacion';
    return 'general';
  }
  function trainingNormalizeItem(value) {
    if (!value || typeof value !== 'object') return null;
    const client = String(value.client || value.client_message || '').trim();
    const response = String(value.response || value.approved_response || '').trim();
    if (!client || !response) return null;
    const learning = value.learning && typeof value.learning === 'object' ? value.learning : {};
    const intent = String(learning.intent || value.intent || trainingIntent(client)).slice(0,60);
    const service = String(learning.service || value.service || trainingService(client)).slice(0,60);
    const rule = String(learning.rule || value.rule || ('Responder a una consulta de ' + intent + ' siguiendo el ejemplo aprobado por Omar.')).trim().slice(0,1000);
    const id = String(value.id || makeId('practice', intent + ':' + service + ':' + rule));
    return {
      ...value,
      id,
      client:client.slice(0,1000),
      originalResponse:String(value.originalResponse || value.original_response || response).trim().slice(0,1600),
      response:response.slice(0,1600),
      correction:String(value.correction || '').trim().slice(0,1200),
      learning:{
        kind:String(learning.kind || value.kind || 'example').slice(0,40),
        name:String(learning.name || value.name || ('Respuesta para ' + intent)).trim().slice(0,80),
        rule,
        intent,
        service,
        scope:'whatsapp'
      },
      active:value.active !== false,
      localStatus:'saved',
      cloudStatus:String(value.cloudStatus || value.cloud_status || 'pending'),
      instructionStatus:String(value.instructionStatus || value.instruction_status || 'pending'),
      tested:Boolean(value.tested),
      testPassed:value.testPassed === true ? true : (value.testPassed === false ? false : null),
      testMessage:String(value.testMessage || '').slice(0,1000),
      testResponse:String(value.testResponse || '').slice(0,1600),
      usageCount:Math.max(0, Number(value.usageCount || value.usage_count || 0)),
      lastUsedAt:Number(value.lastUsedAt || value.last_used_at || 0) || null,
      at:Number(value.at || value.created_at || Date.now()) || Date.now(),
      updatedAt:Number(value.updatedAt || value.updated_at || Date.now()) || Date.now(),
      version:Math.max(1, Number(value.version || 1))
    };
  }
  function trainingHistory() {
    const list = readJson(TRAINING_HISTORY_KEY, []);
    return (Array.isArray(list) ? list : []).map(trainingNormalizeItem).filter(Boolean).sort((a,b) => a.at - b.at).slice(-MAX_TRAINING_EXAMPLES);
  }
  function trainingSaveHistory(list) {
    const safe = (Array.isArray(list) ? list : []).map(trainingNormalizeItem).filter(Boolean).sort((a,b) => a.at - b.at).slice(-MAX_TRAINING_EXAMPLES);
    writeJson(TRAINING_HISTORY_KEY, safe);
    return safe;
  }
  function trainingRole() {
    return localStorage.getItem(TRAINING_ROLE_KEY) === 'trainer' ? 'trainer' : 'client';
  }
  function trainingSetStatus(text, tone) {
    const target = document.getElementById('gfc-yarbi-training-status');
    if (!target) return;
    target.textContent = text;
    target.dataset.tone = tone || 'info';
  }
  function trainingVoiceSetState(state, label) {
    const button = document.getElementById('gfc-yarbi-training-voice');
    if (!button) return;
    const safe = ['idle','listening','processing','speaking'].includes(state) ? state : 'idle';
    button.dataset.state = safe;
    button.setAttribute('aria-pressed', safe === 'listening' ? 'true' : 'false');
    const text = button.querySelector('.label');
    if (text) text.textContent = label || ({ idle:'Hablar', listening:'Te escucho', processing:'Pensando', speaking:'Yarbi habla' }[safe]);
  }
  function trainingSpeakText(text) {
    const clean = String(text || '').trim();
    if (!clean || window._gfcYarbiCurrentTab !== 'practice') return;
    trainingVoiceSetState('speaking','Yarbi habla');
    if (typeof gfcSpeakText === 'function') gfcSpeakText(clean);
    window.clearTimeout(window._gfcYarbiTrainingSpeakTimer);
    const duration = Math.max(1200, Math.min(9000, 650 + clean.length * 48));
    window._gfcYarbiTrainingSpeakTimer = window.setTimeout(() => trainingVoiceSetState('idle','Hablar'), duration);
  }
  function trainingImprovementHint(client, response) {
    const value = trainingNormalizeText(client + ' ' + response);
    if (/\b(?:visita|visitar|ir a ver|agendar)\b/.test(value)) return 'Comprueba que la respuesta pida solo el siguiente dato útil: distrito, ubicación o fecha y hora.';
    if (/\b(?:precio|cuanto cuesta|costo|cotiza)\b/.test(value)) return 'Evita cerrar un precio sin conocer el trabajo; una foto o video puede mejorar la cotización.';
    if (/\b(?:ubicacion|direccion|maps|donde queda)\b/.test(value)) return 'Distingue siempre distrito de enlace de Maps y no inventes ninguno.';
    if (/\b(?:no responde|seguimiento|cotice|cotizacion enviada)\b/.test(value)) return 'Conviene un seguimiento corto, útil y sin presión.';
    return 'Revisa que sea natural, breve y que solicite un solo dato por turno.';
  }
  function trainingShowImprovement(client, response) {
    const target = document.getElementById('gfc-yarbi-training-tip');
    if (!target) return;
    target.hidden = false;
    const copy = target.querySelector('span');
    if (copy) copy.textContent = trainingImprovementHint(client, response);
  }
  function trainingBadges(item) {
    const cloud = item.cloudStatus === 'synced' ? '☁️ Supabase' : (item.cloudStatus === 'error' ? '⚠️ Supabase pendiente' : '⏳ Sincronizando');
    const test = item.tested ? (item.testPassed ? '🧪 Comprobado' : '🧪 Requiere ajuste') : '🧪 Sin probar';
    return '<div class="gfc-yarbi-training-badges"><span>📱 Local</span><span>' + esc(cloud) + '</span><span>' + (item.active ? '✅ Activo' : '⏸ Pausado') + '</span><span>' + esc(test) + '</span><span>Usado ' + Number(item.usageCount || 0) + ' vez/veces</span></div>';
  }
  function trainingExampleHtml(item) {
    return '<div class="gfc-yarbi-training-example" data-training-id="' + esc(item.id) + '">' +
      '<div class="gfc-yarbi-training-example-head"><b>' + esc(item.learning.name) + '</b><small>' + esc(item.learning.intent + ' · ' + item.learning.service) + '</small></div>' +
      '<div><b>Regla aprendida:</b> ' + esc(item.learning.rule) + '</div>' +
      '<details><summary>Ver ejemplo aprobado</summary><div style="margin-top:6px"><b>Cliente:</b> ' + esc(item.client) + '<br><b>Yarbi:</b> ' + esc(item.response) + '</div></details>' +
      trainingBadges(item) +
      '<div class="gfc-yarbi-training-actions"><button class="gfc-yarbi-secondary" onclick="gfcYarbiTrainingStartTest(\'' + esc(item.id) + '\')">Probar</button><button class="gfc-yarbi-secondary" onclick="gfcYarbiTrainingToggle(\'' + esc(item.id) + '\')">' + (item.active ? 'Pausar' : 'Activar') + '</button><button class="gfc-yarbi-secondary" onclick="gfcYarbiTrainingDelete(\'' + esc(item.id) + '\')">Eliminar</button></div>' +
      '</div>';
  }
  function trainingChatHistory() {
    const list = readJson(TRAINING_CHAT_KEY, []);
    if (Array.isArray(list) && list.length) return list.slice(-80);
    return [{ id:makeId('practice_chat','welcome'), role:'yarbi', text:'Practiquemos como si yo atendiera a un cliente. Escribe una consulta, corrígeme con naturalidad o pregúntame cómo respondería. Nada se enviará por WhatsApp.', at:Date.now() }];
  }
  function trainingChatSave(list) {
    const safe = (Array.isArray(list) ? list : []).slice(-80).map(item => ({
      id:String(item.id || makeId('practice_chat',Date.now() + ':' + Math.random())),
      role:['client','owner','yarbi','system'].includes(item.role) ? item.role : 'system',
      text:String(item.text || '').slice(0,2400), at:Number(item.at || Date.now()),
      kind:String(item.kind || ''), learning:item.learning && typeof item.learning === 'object' ? item.learning : null
    }));
    writeJson(TRAINING_CHAT_KEY, safe);
    return safe;
  }
  function trainingChatPush(role, text, meta) {
    if (!String(text || '').trim()) return null;
    const item = { id:makeId('practice_chat',Date.now() + ':' + Math.random()), role, text:String(text).trim(), at:Date.now(), ...(meta || {}) };
    trainingChatSave([...trainingChatHistory(), item]);
    trainingChatRender();
    if (role === 'yarbi' && meta?.silentVoice !== true) trainingSpeakText(item.text);
    return item;
  }
  function trainingChatTime(at) {
    try { return new Intl.DateTimeFormat('es-PE',{ hour:'numeric', minute:'2-digit', hour12:true, timeZone:'America/Lima' }).format(new Date(at)); }
    catch (_) { return ''; }
  }
  function trainingChatRender() {
    const target = document.getElementById('gfc-yarbi-training-chat');
    if (!target) return;
    target.innerHTML = trainingChatHistory().map(item => {
      const label = item.role === 'client' ? 'Cliente simulado' : item.role === 'owner' ? 'Tú · corrección' : item.role === 'yarbi' ? 'Yarbi' : 'Entrenamiento';
      const learning = item.kind === 'learning' && item.learning ? '<div class="gfc-yarbi-training-inline-card"><b>🧠 Esto aprenderá Yarbi</b><span>' + esc(item.learning.name || 'Regla aprobada') + '</span><p>' + esc(item.learning.rule || item.text) + '</p><small>WhatsApp · ' + esc(item.learning.intent || 'general') + ' · ' + esc(item.learning.service || 'general') + '</small><div class="gfc-yarbi-training-actions"><button class="gfc-yarbi-primary" onclick="gfcYarbiTrainingSaveExample()">Aprobar y guardar</button><button class="gfc-yarbi-secondary" onclick="document.getElementById(\'gfc-yarbi-training-input\').focus()">Seguir corrigiendo</button></div></div>' : '';
      return '<article class="gfc-yarbi-training-bubble ' + esc(item.role) + '"><b>' + esc(label) + '</b><div>' + esc(item.text).replace(/\n/g,'<br>') + '</div>' + learning + '<time>' + esc(trainingChatTime(item.at)) + '</time></article>';
    }).join('');
    target.scrollTop = target.scrollHeight;
  }
  async function trainingContextSnapshot() {
    const cached = window._gfcYarbiTrainingContextCache;
    if (cached && Date.now() - Number(cached.at || 0) < 5 * 60 * 1000) return cached;
    // La nube actualiza primero cuando está disponible; si falla, la práctica
    // continúa con la copia local sin bloquear al usuario.
    if (typeof gfcLoadOwnerInstructions === 'function') await gfcLoadOwnerInstructions().catch(() => null);
    const instructions = typeof gfcOwnerInstructionVisibleList === 'function' ? gfcOwnerInstructionVisibleList().filter(item => item.active !== false).slice(0,20) : [];
    const styles = typeof gfcYarbiLocalRows === 'function' ? await gfcYarbiLocalRows('reply_style').catch(() => []) : [];
    const next = { instructions, styles:(Array.isArray(styles) ? styles : []).slice(0,12), at:Date.now() };
    window._gfcYarbiTrainingContextCache = next;
    return next;
  }
  function trainingMessageKind(text) {
    const value = trainingNormalizeText(text);
    const saveCommand = /^(?:si\s*)?(?:guarda(?:lo|la|r)?|guardalo|guardala|gusrda|guerda|gurda|aprende(?:lo|la)?|aprendelo|aprendela|memoriza(?:lo|la)?|aprobar y guardar)\b/.test(value);
    if (saveCommand && /\b(?:instruccion|regla|aprendizaje|permanente)\b/.test(value)) return 'save_instruction';
    if (saveCommand) return 'save';
    if (/\b(?:como le responderias|que le responderias|como responderias|que responderias|que sugieres|como harias seguimiento|explicame por que)\b/.test(value)) return 'coaching';
    if (window._gfcYarbiTrainingDraft && /\b(?:deberias|yo responderia|mejor dile|no digas|corrige|esta muy|es muy|hazla|hazlo|usa menos|usa mas|primero pide|responde asi|cambialo)\b/.test(value)) return 'correction';
    if (/\b(?:debes|deberias|quiero que|prefiero que|a partir de ahora|de ahora en adelante|siempre)\b[\s\S]{0,500}\b(?:presentarte|presentarse|presentes|saludar|saludes|responder|respondas|decir|digas|pedir|pidas|usar|uses|escribir|escribas)\b/.test(value)) return 'instruction';
    if (/^(?:yarbi\s+)?(?:presentate|saluda|responde|contesta|pide)\b/.test(value)) return 'instruction';
    if (/\b(?:us(?:a|e|es)|utiliz(?:a|e|es)|incluy(?:e|a|as)|agreg(?:a|ue|ues)|pon(?:ga|gas)?|no\s+(?:l(?:eer|ea|eas|eyera)|pronunci(?:ar|e|es)|dig(?:a|as)))\b[\s\S]{0,120}\b(?:emoji|emoticone?s?|tono|estilo|voz|respuesta|saludo|cordial|natural|breve|corto)\b/.test(value)) return 'instruction';
    return 'client';
  }

  function trainingDirectStyleInstruction(text) {
    const value = trainingNormalizeText(text);
    return /\b(?:us(?:a|e|es)|utiliz(?:a|e|es)|incluy(?:e|a|as)|agreg(?:a|ue|ues)|pon(?:ga|gas)?|debes|deberias|quiero que|prefiero que|no\s+(?:l(?:eer|ea|eas|eyera)|pronunci(?:ar|e|es)|dig(?:a|as)))\b[\s\S]{0,140}\b(?:emoji|emoticone?s?|tono|estilo|voz|respuesta|saludo|cordial|natural|breve|corto)\b/.test(value);
  }
  window.gfcIsYarbiTrainingInstruction = function(text) {
    const kind = trainingMessageKind(text);
    return kind === 'instruction' || kind === 'save_instruction';
  };

  function trainingPendingInstruction(value) {
    if (value === undefined) return readJson(TRAINING_PENDING_INSTRUCTION_KEY, null);
    if (!value) {
      try { localStorage.removeItem(TRAINING_PENDING_INSTRUCTION_KEY); } catch (_) {}
      window._gfcYarbiTrainingPendingInstruction = null;
      return null;
    }
    const record = {
      instruction:String(value.instruction || '').trim().replace(/\s+/g,' ').slice(0,1000),
      name:String(value.name || '').trim().slice(0,80),
      at:Number(value.at || Date.now())
    };
    writeJson(TRAINING_PENDING_INSTRUCTION_KEY, record);
    window._gfcYarbiTrainingPendingInstruction = record;
    return record;
  }

  function trainingInstructionFromText(text) {
    const source = String(text || '').trim().replace(/\s+/g,' ');
    if (!source) return '';
    const direct = source.match(/(?:instrucci[oó]n|regla|aprendizaje)(?:\s+permanente)?\s*(?::|-|que\b)?\s+(.+)$/i);
    if (direct && direct[1] && !/^(?:esto|eso|lo anterior|la anterior|(?:y\s+)?aprendizaje)$/i.test(direct[1].trim())) return direct[1].trim().slice(0,1000);
    if (/\b(?:debes|deber[ií]as|quiero que|prefiero que|a partir de ahora|de ahora en adelante|siempre)\b/i.test(source) && /\b(?:presentarte|presentarse|presentes|saludar|saludes|responder|respondas|decir|digas|pedir|pidas|usar|uses|escribir|escribas)\b/i.test(source)) return source.slice(0,1000);
    if (/^(?:yarbi\s+)?(?:pres[eé]ntate|saluda|responde|contesta|pide)\b/i.test(source)) return source.slice(0,1000);
    if (/\b(?:us(?:a|e|es)|utiliz(?:a|e|es)|incluy(?:e|a|as)|agreg(?:a|ue|ues)|pon(?:ga|gas)?|no\s+(?:l(?:eer|ea|eas|eyera)|pronunci(?:ar|e|es)|dig(?:a|as)))\b[\s\S]{0,120}\b(?:emoji|emoticone?s?|tono|estilo|voz|respuesta|saludo|cordial|natural|breve|corto)\b/i.test(source)) return source.slice(0,1000);
    return '';
  }

  function trainingRecoverDraftForSave() {
    if (window._gfcYarbiTrainingDraft?.learning?.rule) return window._gfcYarbiTrainingDraft;
    const history = trainingChatHistory();
    const learningIndex = history.map(item => item?.kind === 'learning' && item?.learning?.rule).lastIndexOf(true);
    if (learningIndex < 0) return null;
    const learningMessage = history[learningIndex];
    const client = [...history.slice(0,learningIndex)].reverse().find(item => item.role === 'client' && item.text)?.text || '';
    const response = [...history.slice(0,learningIndex)].reverse().find(item => item.role === 'yarbi' && item.text)?.text || '';
    const correction = [...history.slice(0,learningIndex)].reverse().find(item => item.role === 'owner' && item.text)?.text || '';
    if (!client || !response) return null;
    window._gfcYarbiTrainingDraft = { client, response, originalResponse:response, correction, learning:learningMessage.learning };
    return window._gfcYarbiTrainingDraft;
  }

  async function trainingSavePermanentInstruction(instruction, suggestedName) {
    const clean = String(instruction || '').trim().replace(/\s+/g,' ').slice(0,1000);
    if (clean.length < 8) throw new Error('La instrucción no tiene suficiente detalle');
    const list = typeof gfcOwnerInstructionVisibleList === 'function' ? gfcOwnerInstructionVisibleList() : [];
    const normalized = trainingNormalizeText(clean);
    const category = typeof gfcOwnerInstructionStyleCategory === 'function' ? (gfcOwnerInstructionStyleCategory(clean) || 'reply_training') : 'reply_training';
    const duplicate = (Array.isArray(list) ? list : []).find(item => trainingNormalizeText(item.instruction) === normalized || (category !== 'reply_training' && item.category === category));
    const record = {
      ...(duplicate || {}),
      id:duplicate?.id || makeId('instr_practice', normalized),
      name:String(suggestedName || duplicate?.name || (typeof gfcOwnerInstructionName === 'function' ? gfcOwnerInstructionName(clean) : 'Presentación y respuesta')).slice(0,80),
      instruction:clean,
      category, scope:category === 'voice_emoji_reading' ? 'all' : 'whatsapp', active:true, updatedAt:Date.now()
    };
    if (typeof gfcOwnerInstructionAddToCache !== 'function') throw new Error('El guardado local de instrucciones no está disponible');
    if (category !== 'reply_training' && typeof gfcOwnerInstructionSetCachedList === 'function') {
      gfcOwnerInstructionSetCachedList([record, ...(Array.isArray(list) ? list : []).filter(item => item.id !== record.id && item.category !== category && item.instruction !== record.instruction)]);
    } else gfcOwnerInstructionAddToCache(record);
    window._gfcYarbiTrainingContextCache = null;
    let cloud = false;
    try {
      if (typeof gfcOwnerInstructionSync !== 'function') throw new Error('Sincronización no disponible');
      const result = await gfcOwnerInstructionSync(record);
      cloud = result?.ok === true && result?.source === 'supabase';
      if (!cloud) throw new Error('Supabase no confirmó la instrucción');
    } catch (error) {
      if (typeof gfcOwnerInstructionQueue === 'function') gfcOwnerInstructionQueue(record);
    }
    trainingPendingInstruction(null);
    return { record, cloud, updated:!!duplicate };
  }

  async function trainingHandleInstructionCommand(text, saveNow) {
    trainingChatPush('owner',text);
    const explicit = trainingInstructionFromText(text);
    const pending = trainingPendingInstruction();
    const draft = trainingRecoverDraftForSave();
    if (saveNow && !explicit && !pending?.instruction && draft?.learning?.rule) return window.gfcYarbiTrainingSaveExample();
    const instruction = explicit || pending?.instruction || '';
    if (!instruction) {
      trainingSetStatus('Necesito la instrucción completa para no guardar una regla equivocada.', 'warning');
      return trainingChatPush('yarbi','Entiendo que quieres guardarla, pero “eso” no señala una instrucción clara. Dímela completa, por ejemplo: “Preséntate diciendo: Buenas tardes, ¿en qué servicio puedo ayudarle?”.');
    }
    if (!saveNow) {
      const record = trainingPendingInstruction({ instruction, name:typeof gfcOwnerInstructionName === 'function' ? gfcOwnerInstructionName(instruction) : 'Presentación y respuesta' });
      trainingSetStatus('Instrucción entendida. Di “guarda eso como instrucción” para activarla.', 'warning');
      return trainingChatPush('yarbi','Entendí esta instrucción: “' + record.instruction + '”. Aún no la guardé. Dime “guarda eso como instrucción” para activarla en futuras conversaciones.');
    }
    trainingSetStatus('Guardando la instrucción en el celular y verificando Supabase…', 'processing');
    try {
      const result = await trainingSavePermanentInstruction(instruction, pending?.name || 'Presentación y respuesta');
      trainingSetStatus(result.cloud ? '✅ Instrucción activa y verificada en Supabase.' : '📱 Instrucción activa localmente; Supabase queda en cola.', result.cloud ? 'success' : 'warning');
      trainingChatPush('yarbi','✅ Instrucción guardada: “' + result.record.name + '”. Ya está activa para futuras respuestas' + (result.cloud ? ' y verificada en Supabase.' : ' en este celular; la copia de Supabase se reintentará.') );
      window.setTimeout(() => window.gfcShowInstructionSavedChip?.(result.record, result.cloud, result.updated), 0);
      refreshLearningEvidence().catch(() => {});
      return { ok:true, local:true, cloud:result.cloud, id:result.record.id };
    } catch (error) {
      trainingSetStatus('No pude guardar la instrucción: ' + (error?.message || 'revisa la configuración'), 'error');
      return trainingChatPush('yarbi','No voy a decir que la guardé porque el almacenamiento no la confirmó. ' + (error?.message || 'Revisa la configuración e inténtalo nuevamente.'));
    }
  }
  function trainingHtml() {
    // El chat unico reemplaza los botones "Hablo como cliente" / "Estoy corrigiendo".
    // El papel seleccionado manda ahora por deteccion explicita del texto, sin ejecutar acciones.
    const recent = trainingHistory().slice().reverse();
    return '<main class="gfc-yarbi-training-page"><div class="gfc-yarbi-training-compact"><span>🔒 Práctica privada · no envía WhatsApp · agente automático desactivado</span><button onclick="gfcYarbiTrainingToggleSaved()">🧠 ' + recent.length + ' guardados</button></div>' +
      '<div id="gfc-yarbi-training-chat" class="gfc-yarbi-training-chat"></div>' +
      '<div id="gfc-yarbi-training-tip" class="gfc-yarbi-training-tip" hidden><b>💡 Mejora sugerida</b><span></span><button onclick="gfcYarbiTrainingAskImprovement()">Analizar</button></div>' +
      '<div class="gfc-yarbi-training-quick"><button onclick="gfcYarbiTrainingQuick(\'Hazla más corta y directa.\')">Más corto</button><button onclick="gfcYarbiTrainingQuick(\'Usa menos emojis.\')">Menos emojis</button><button onclick="gfcYarbiTrainingQuick(\'No des precios sin revisar el trabajo.\')">No dar precio</button><button onclick="gfcYarbiTrainingQuick(\'Primero pide un video del trabajo.\')">Pedir video</button></div>' +
      '<div id="gfc-yarbi-training-status" class="gfc-yarbi-training-status" data-tone="info">Habla o escribe como cliente; también puedes corregir y enseñar.</div>' +
      '<div class="gfc-yarbi-training-composer"><textarea id="gfc-yarbi-training-input" rows="1" placeholder="Mensaje de cliente o corrección para Yarbi"></textarea><button id="gfc-yarbi-training-voice" class="voice" data-state="idle" onclick="gfcYarbiTrainingListen()" aria-label="Hablar con Yarbi" aria-pressed="false"><span class="wave"><i></i><i></i><i></i></span><span class="label">Hablar</span></button><button id="gfc-yarbi-training-generate" class="send" onclick="gfcYarbiTrainingSend()" aria-label="Enviar">➤</button></div>' +
      '<div class="gfc-yarbi-hidden"><textarea id="gfc-yarbi-training-client"></textarea><textarea id="gfc-yarbi-training-response"></textarea><textarea id="gfc-yarbi-training-correction"></textarea><button id="gfc-yarbi-training-correct"></button><button id="gfc-training-role-client"></button><button id="gfc-training-role-trainer"></button><div id="gfc-yarbi-training-role-help"></div></div>' +
      '<div id="gfc-yarbi-training-evidence" class="gfc-yarbi-training-evidence" hidden></div><div id="gfc-yarbi-training-learning" class="gfc-yarbi-training-learning" hidden></div>' +
      '<aside id="gfc-yarbi-training-saved-panel" class="gfc-yarbi-training-saved-panel" hidden><div class="gfc-yarbi-training-saved-head"><b>Aprendizajes guardados (' + recent.length + ')</b><button onclick="gfcYarbiTrainingToggleSaved(false)">✕</button></div><div id="gfc-yarbi-training-list">' + (recent.length ? recent.map(trainingExampleHtml).join('') : 'Todavía no hay aprendizajes aprobados.') + '</div></aside></main>';
  }

  window.gfcYarbiTrainingToggleSaved = function(force) {
    const panel = document.getElementById('gfc-yarbi-training-saved-panel');
    if (!panel) return;
    panel.hidden = force === undefined ? !panel.hidden : !force;
  };
  window.gfcYarbiTrainingAskImprovement = function() {
    const draft = window._gfcYarbiTrainingDraft;
    if (!draft?.client || !draft?.response) return trainingSetStatus('Primero practica una respuesta.', 'warning');
    const question = 'Analiza esta práctica y propón una mejora concreta sin ejecutar acciones. Cliente: “' + draft.client + '”. Respuesta de Yarbi: “' + draft.response + '”.';
    trainingChatPush('owner','¿Cómo mejorarías esta respuesta?');
    return trainingCoach(question);
  };

  async function trainingCoach(text) {
    trainingSetStatus('Pensando una recomendación breve…', 'processing');
    try {
      const context = await trainingContextSnapshot();
      const system = 'Eres el entrenador comercial de Yarbi para el negocio de Omar. Responde en español peruano natural. Explica brevemente cómo conviene responder el mensaje o situación planteada y ofrece un ejemplo listo para copiar. No ejecutes acciones, no envíes WhatsApp, no inventes precios, fechas ni datos de clientes. Usa solo reglas de estilo relevantes. INSTRUCCIONES: ' + JSON.stringify(context.instructions.map(item => item.instruction)).slice(0,5000) + '. ESTILO: ' + JSON.stringify(context.styles).slice(0,3500);
      const result = await gfcCallGeminiAPI('backend',{ system_instruction:{ parts:[{ text:system }] }, contents:[{ role:'user', parts:[{ text }] }] });
      if (!result?.ok || !result.text) throw new Error(result?.message || 'No se pudo generar la recomendación');
      trainingChatPush('yarbi',String(result.text).trim());
      trainingSetStatus('Sugerencia lista. Puedes seguir conversando o corregirme.', 'success');
    } catch (error) {
      trainingVoiceSetState('idle','Hablar');
      trainingSetStatus('No pude responder la práctica: ' + (error?.message || 'revisa la conexión'), 'error');
    }
  }
  window.gfcYarbiTrainingSend = async function(promptText) {
    const input = document.getElementById('gfc-yarbi-training-input');
    const text = String(promptText || input?.value || '').trim();
    if (!text) return;
    if (input) { input.value=''; input.focus(); }
    trainingVoiceSetState('processing','Pensando');
    const kind = trainingMessageKind(text);
    if (kind === 'save_instruction') return trainingHandleInstructionCommand(text, true);
    if (kind === 'instruction') return trainingHandleInstructionCommand(text, trainingDirectStyleInstruction(text));
    if (kind === 'save') {
      trainingChatPush('owner',text);
      if (!trainingRecoverDraftForSave()?.learning) return trainingChatPush('yarbi','Todavía no hay una corrección preparada para guardar. Dime la regla completa o escribe “guarda como instrucción: …”.');
      return window.gfcYarbiTrainingSaveExample();
    }
    if (kind === 'coaching') { trainingChatPush('owner',text); return trainingCoach(text); }
    if (kind === 'correction') {
      trainingChatPush('owner',text);
      const field = document.getElementById('gfc-yarbi-training-correction');
      if (field) field.value=text;
      return window.gfcYarbiTrainingApplyCorrection();
    }
    trainingChatPush('client',text);
    const field = document.getElementById('gfc-yarbi-training-client');
    if (field) field.value=text;
    return window.gfcYarbiTrainingGenerate();
  };

  window.gfcYarbiUnifiedQuick = function(text) {
    const field = document.getElementById('gfc-copilot-input-text');
    if (field) { field.value = String(text || ''); window.gfcSaveYarbiConversationDraft(field.value); window.gfcResizeYarbiComposer(field); field.focus(); }
  };
  window.gfcYarbiAskQuickRead = function(text) {
    const value = String(text || '').trim();
    if (!value) return false;
    const field = document.getElementById('gfc-copilot-input-text');
    if (field) { field.value = value; window.gfcSaveYarbiConversationDraft(value); window.gfcResizeYarbiComposer(field); }
    if (typeof window.gfcSendCopilotChatMessage === 'function') return window.gfcSendCopilotChatMessage(value);
    return false;
  };

  window.gfcSaveYarbiConversationDraft = function(text) {
    if (interactionMode() !== 'normal') return false;
    return saveConversationDraft(activeConversationId(), text);
  };
  window.gfcClearYarbiConversationDraft = function(conversationId) {
    if (interactionMode() !== 'normal') return false;
    forgetConversationDraft(conversationId || activeConversationId());
    return true;
  };
  function restoreYarbiConversationDraft() {
    if (interactionMode() !== 'normal') return;
    const input = document.getElementById('gfc-copilot-input-text');
    if (!input) return;
    input.value = conversationDraft(activeConversationId());
    window.gfcResizeYarbiComposer(input);
  }

  window.gfcResizeYarbiComposer = function(field) {
    const input = field || document.getElementById('gfc-copilot-input-text');
    if (!input || String(input.tagName || '').toLowerCase() !== 'textarea') return;
    input.style.setProperty('height', 'auto', 'important');
    input.style.setProperty('height', Math.min(Math.max(input.scrollHeight, 46), 132) + 'px', 'important');
    input.classList.toggle('is-multiline', input.scrollHeight > 50);
  };
  window.gfcHandleYarbiComposerKeydown = function(event) {
    if (!event || event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    window.gfcSendYarbiUnifiedMessage();
  };

  window.gfcSendYarbiUnifiedMessage = async function(promptText) {
    if (interactionMode() !== 'training') return typeof gfcSendCopilotChatMessage === 'function' ? gfcSendCopilotChatMessage(promptText) : undefined;
    const input = document.getElementById('gfc-copilot-input-text');
    const text = String(promptText || input?.value || '').trim();
    if (!text) return;
    if (input) { input.value = ''; window.gfcClearYarbiConversationDraft(); window.gfcResizeYarbiComposer(input); input.focus(); }
    const session = window._gfcLiveSession || {};
    if (session.active && session.liveReady && session.trainingMode && session.socket?.readyState === WebSocket.OPEN) {
      if (typeof gfcLiveAdvanceTurn === 'function') gfcLiveAdvanceTurn(session, 'training-text');
      session.inputBuffer = text;
      session.transcript = text;
      session.socket.send(JSON.stringify({ clientContent:{ turns:[{ role:'user', parts:[{ text }] }], turnComplete:true } }));
      session.liveAwaitingResponse = true;
      if (typeof gfcLiveSetTurnState === 'function' && typeof GFC_LIVE_TURN_STATES !== 'undefined') gfcLiveSetTurnState(session, GFC_LIVE_TURN_STATES.WAITING_RESPONSE, 'training-text-sent');
      if (typeof gfcLiveSetUi === 'function') gfcLiveSetUi(true, 'Entrenamiento · Yarbi está pensando…', 'processing');
      return;
    }
    return window.gfcYarbiTrainingSend(text);
  };

  window.gfcHandleYarbiTrainingLiveTurn = async function(input, output) {
    const text = String(input || '').trim();
    const answer = String(output || '').trim();
    if (!text && !answer) return;
    const kind = trainingMessageKind(text);
    if (kind === 'save_instruction') return trainingHandleInstructionCommand(text, true);
    if (kind === 'instruction') return trainingHandleInstructionCommand(text, trainingDirectStyleInstruction(text));
    if (kind === 'save') {
      trainingChatPush('owner', text, { silentVoice:true });
      if (trainingRecoverDraftForSave()?.learning) return window.gfcYarbiTrainingSaveExample();
      return trainingChatPush('yarbi', 'Todavía no hay una corrección preparada para guardar. Enséñame primero cómo debería responder.', { silentVoice:true });
    }
    if (kind === 'correction') {
      trainingChatPush('owner', text, { silentVoice:true });
      if (answer) trainingChatPush('yarbi', answer, { silentVoice:true });
      const correctionField = document.getElementById('gfc-yarbi-training-correction');
      if (correctionField) correctionField.value = text;
      if (window._gfcYarbiTrainingDraft) window._gfcYarbiTrainingDraft.correction = text;
      return window.gfcYarbiTrainingApplyCorrection();
    }
    trainingChatPush(kind === 'coaching' ? 'owner' : 'client', text, { silentVoice:true });
    if (answer) trainingChatPush('yarbi', answer, { silentVoice:true });
    if (kind === 'client' && text && answer) {
      const clientField = document.getElementById('gfc-yarbi-training-client');
      const responseField = document.getElementById('gfc-yarbi-training-response');
      if (clientField) clientField.value = text;
      if (responseField) responseField.value = answer;
      window._gfcYarbiTrainingDraft = { client:text, response:answer, originalResponse:answer, correction:'', learning:null };
      void trainingMarkUsed(window._gfcYarbiTrainingLiveExampleIds || [], 'live-context');
    }
  };

  window.gfcSetYarbiInteractionMode = function(mode) {
    const next = mode === 'training' ? 'training' : 'normal';
    if (interactionMode() === next && window._gfcYarbiCurrentTab === 'chat') return;
    if ((window._gfcLiveSession?.active || window._gfcLiveSession?.connecting) && typeof gfcStopGeminiLive === 'function') gfcStopGeminiLive();
    localStorage.setItem(INTERACTION_MODE_KEY, next);
    window.gfcOpenCopilotModal('chat');
    if (typeof toast === 'function') toast(next === 'training' ? 'Entrenamiento seguro activo. Live no puede ejecutar acciones reales.' : 'Trabajo real activo.', 'success');
  };

  window.gfcYarbiTrainingSetRole = function(role) {
    const next = role === 'trainer' ? 'trainer' : 'client';
    localStorage.setItem(TRAINING_ROLE_KEY, next);
    document.getElementById('gfc-training-role-client')?.classList.toggle('active', next === 'client');
    document.getElementById('gfc-training-role-trainer')?.classList.toggle('active', next === 'trainer');
    const help = document.getElementById('gfc-yarbi-training-role-help');
    if (help) help.textContent = next === 'client' ? 'Verde: lo que digas será el mensaje del cliente.' : 'Morado: lo que digas será una corrección para Yarbi.';
    trainingSetStatus(next === 'client' ? '🎭 Ahora hablas como cliente.' : '🧑‍🏫 Ahora estás corrigiendo a Yarbi.', next);
  };
  window.gfcYarbiTrainingQuick = function(text) {
    const field = document.getElementById('gfc-yarbi-training-input');
    if (field) field.value = String(text || '');
    field?.focus();
  };
  window.gfcYarbiTrainingListen = function() {
    const field = document.getElementById('gfc-yarbi-training-input');
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!field || !SpeechRecognition) {
      trainingSetStatus('El reconocimiento local no está disponible. Puedes escribir para continuar.', 'error');
      return;
    }
    try {
      if (window._gfcYarbiTrainingRecognition) {
        window._gfcYarbiTrainingVoiceCancelled = true;
        try { window._gfcYarbiTrainingRecognition.stop(); } catch (_) {}
        trainingVoiceSetState('idle','Hablar');
        trainingSetStatus('Escucha detenida. Puedes editar el texto o volver a hablar.', 'info');
        return;
      }
      if (window.speechSynthesis) try { window.speechSynthesis.cancel(); } catch (_) {}
      const recognition = new SpeechRecognition();
      window._gfcYarbiTrainingRecognition = recognition;
      window._gfcYarbiTrainingVoiceCancelled = false;
      window._gfcYarbiTrainingVoiceTranscript = '';
      field.value = '';
      recognition.lang = 'es-PE';
      recognition.interimResults = true;
      recognition.continuous = false;
      recognition.onstart = () => {
        trainingVoiceSetState('listening','Te escucho');
        trainingSetStatus('🔴 Te escucho. Habla como cliente o corrige a Yarbi.', 'client');
      };
      recognition.onresult = event => {
        let transcript = '';
        for (let i = 0; i < event.results.length; i += 1) transcript += (event.results[i][0]?.transcript || '') + ' ';
        if (transcript.trim()) {
          window._gfcYarbiTrainingVoiceTranscript = transcript.trim();
          field.value = transcript.trim();
        }
      };
      recognition.onerror = event => {
        window._gfcYarbiTrainingVoiceCancelled = true;
        trainingVoiceSetState('idle','Hablar');
        trainingSetStatus(event?.error === 'no-speech' ? 'No detecté voz. Pulsa Hablar e inténtalo nuevamente.' : 'No pude escuchar. También puedes escribir.', 'error');
      };
      recognition.onend = () => {
        window._gfcYarbiTrainingRecognition = null;
        const captured = String(window._gfcYarbiTrainingVoiceTranscript || field.value || '').trim();
        const shouldSend = !window._gfcYarbiTrainingVoiceCancelled && captured.length > 1;
        window._gfcYarbiTrainingVoiceTranscript = '';
        if (!shouldSend) {
          trainingVoiceSetState('idle','Hablar');
          if (!captured) trainingSetStatus('No se detectó voz.', 'warning');
          return;
        }
        trainingVoiceSetState('processing','Pensando');
        trainingSetStatus('Entendí: “' + captured.slice(0,120) + (captured.length > 120 ? '…' : '') + '”. Procesando…', 'processing');
        window.setTimeout(() => window.gfcYarbiTrainingSend(), 60);
      };
      recognition.start();
    } catch (_) {
      window._gfcYarbiTrainingRecognition = null;
      trainingVoiceSetState('idle','Hablar');
      trainingSetStatus('No pude activar el micrófono de práctica.', 'error');
    }
  };

  function trainingTokens(value) {
    const stop = new Set(['hola','buenas','quiero','quisiera','necesito','para','como','con','que','una','uno','los','las','del','por','favor','cliente']);
    return new Set(trainingNormalizeText(value).split(' ').filter(word => word.length > 2 && !stop.has(word)));
  }
  function trainingRelevantExamples(client) {
    const tokens = trainingTokens(client);
    const intent = trainingIntent(client);
    const service = trainingService(client);
    return trainingHistory().filter(item => item.active).map(item => {
      const itemTokens = trainingTokens(item.client + ' ' + item.learning.rule);
      let score = item.learning.intent === intent ? 5 : 0;
      if (service !== 'general' && item.learning.service === service) score += 4;
      tokens.forEach(word => { if (itemTokens.has(word)) score += 1; });
      return { item, score };
    }).filter(entry => entry.score > 0).sort((a,b) => b.score - a.score || b.item.updatedAt - a.item.updatedAt).slice(0,3).map(entry => entry.item);
  }
  function trainingUpdateItems(ids, update) {
    const selected = new Set((ids || []).map(String));
    const next = trainingHistory().map(item => selected.has(String(item.id)) ? trainingNormalizeItem({ ...item, ...update(item), updatedAt:Date.now() }) : item);
    return trainingSaveHistory(next);
  }
  function trainingRenderEvidence(data) {
    const target = document.getElementById('gfc-yarbi-training-evidence');
    if (!target) return;
    const examples = Array.isArray(data?.examples) ? data.examples : [];
    target.hidden = false;
    target.innerHTML = '<b>¿Qué recibió Yarbi para responder?</b><br>' +
      Number(data?.instructions || 0) + ' instrucción(es), ' + Number(data?.styles || 0) + ' patrón(es) de estilo y ' + examples.length + ' ejemplo(s) relacionado(s).' +
      (examples.length ? '<br><b>Ejemplos consultados:</b> ' + examples.map(item => esc(item.learning.name)).join(', ') : '') +
      '<br><small>Esto muestra el contexto entregado al modelo; no inventa una explicación posterior.</small>';
  }
  window.gfcYarbiTrainingGenerate = async function() {
    const client = String(document.getElementById('gfc-yarbi-training-client')?.value || '').trim();
    const responseField = document.getElementById('gfc-yarbi-training-response');
    const button = document.getElementById('gfc-yarbi-training-generate');
    if (client.length < 3) { trainingSetStatus('Escribe o dicta primero el mensaje del cliente.', 'error'); return; }
    if (button) button.disabled = true;
    trainingSetStatus('Preparando una respuesta sin ejecutar acciones…', 'processing');
    try {
      const context = await trainingContextSnapshot();
      const instructions = context.instructions;
      const styles = context.styles;
      const examples = trainingRelevantExamples(client);
      const system = 'MODO CLIENTE SIMULADO SEGURO. Responde como el negocio de Omar, técnico de servicios de gas natural en Lima, con español peruano natural, breve y profesional. no agendes, no modifiques datos, no uses herramientas. No afirmes que enviaste, agendaste, guardaste, editaste ni borraste nada. No inventes precio, fecha, garantía, disponibilidad, dirección ni identidad. Si falta información, pide un solo dato útil. Aplica únicamente reglas relevantes; nunca copies datos concretos de otro cliente. INSTRUCCIONES ACTIVAS: ' + JSON.stringify(instructions.map(item => item.instruction)).slice(0,6500) + '. PATRONES DE ESTILO: ' + JSON.stringify(styles.slice(0,12)).slice(0,4500) + '. EJEMPLOS APROBADOS RELACIONADOS: ' + JSON.stringify(examples.map(item => ({ client:item.client, response:item.response, rule:item.learning.rule }))).slice(0,6000);
      const result = await gfcCallGeminiAPI('backend', { system_instruction:{ parts:[{ text:system }] }, contents:[{ role:'user', parts:[{ text:client }] }] });
      if (!result?.ok || !result.text) throw new Error(result?.message || 'No se pudo generar la respuesta');
      const response = String(result.text).trim();
      if (responseField) responseField.value = response;
      trainingChatPush('yarbi',response);
      window._gfcYarbiTrainingDraft = { client, originalResponse:response, response, correction:'', learning:null, evidenceIds:examples.map(item => item.id), isTestId:String(window._gfcYarbiTrainingTestId || '') };
      trainingShowImprovement(client,response);
      if (examples.length) void trainingMarkUsed(examples.map(item => item.id), 'simulator-generate');
      trainingRenderEvidence({ instructions:instructions.length, styles:Math.min(styles.length,12), examples });
      trainingSetStatus('Respuesta lista. Puedes corregirme con naturalidad o escribir “guárdalo” si ya existe una regla preparada.', 'trainer');
      if (window._gfcYarbiTrainingTestId) {
        const testBox = document.getElementById('gfc-yarbi-training-learning');
        if (testBox) {
          testBox.hidden = false;
          testBox.innerHTML = '<b>Comprobación pendiente</b><br>¿La respuesta aplicó correctamente el aprendizaje seleccionado?<div class="gfc-yarbi-training-actions"><button class="gfc-yarbi-primary" onclick="gfcYarbiTrainingMarkTest(true)">✅ Sí lo aplicó</button><button class="gfc-yarbi-secondary" onclick="gfcYarbiTrainingMarkTest(false)">❌ Necesita ajuste</button></div>';
        }
      }
    } catch (error) {
      trainingVoiceSetState('idle','Hablar');
      trainingSetStatus('No se pudo generar la práctica: ' + (error?.message || 'revisa la conexión'), 'error');
    } finally { if (button) button.disabled = false; }
  };

  function trainingParseJson(text) {
    const raw = String(text || '').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
    try { return JSON.parse(raw); } catch (_) {}
    const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) try { return JSON.parse(raw.slice(start,end+1)); } catch (_) {}
    return null;
  }
  window.gfcYarbiTrainingApplyCorrection = async function() {
    const draft = window._gfcYarbiTrainingDraft;
    const client = String(document.getElementById('gfc-yarbi-training-client')?.value || '').trim();
    const current = String(document.getElementById('gfc-yarbi-training-response')?.value || '').trim();
    const correction = String(document.getElementById('gfc-yarbi-training-correction')?.value || '').trim();
    const button = document.getElementById('gfc-yarbi-training-correct');
    if (!client || !current) return trainingSetStatus('Primero genera o escribe una respuesta.', 'error');
    if (correction.length < 3) return trainingSetStatus('Dime qué deseas corregir.', 'error');
    if (button) button.disabled = true;
    trainingSetStatus('Aplicando tu corrección sin ejecutar acciones…', 'processing');
    try {
      const system = 'Eres el editor de entrenamiento de Yarbi. El dueño corrige una respuesta simulada de WhatsApp. Devuelve SOLO JSON válido con esta forma: {"revised_response":"respuesta completa corregida","learning":{"kind":"style|rule|process|example","name":"nombre corto","rule":"regla general sin datos particulares","intent":"cotizacion|ubicacion|agenda|reprogramacion|pago|postventa|consulta_general","service":"modificacion|punto_adicional|gasfiteria|instalacion|reparacion|general","scope":"whatsapp"}}. No conviertas nombres, teléfonos, precios, fechas o ubicaciones del caso en reglas generales. No inventes información. La respuesta revisada debe poder enviarse al cliente y la regla debe describir exactamente la corrección del dueño.';
      const payload = 'MENSAJE DEL CLIENTE:\n' + client + '\n\nRESPUESTA ACTUAL:\n' + current + '\n\nCORRECCIÓN DEL DUEÑO:\n' + correction;
      const result = await gfcCallGeminiAPI('backend', { system_instruction:{ parts:[{ text:system }] }, contents:[{ role:'user', parts:[{ text:payload }] }] });
      const parsed = result?.ok ? trainingParseJson(result.text) : null;
      if (!parsed?.revised_response || !parsed?.learning?.rule) throw new Error(result?.message || 'La corrección no quedó estructurada');
      const revised = String(parsed.revised_response).trim().slice(0,1600);
      const learning = {
        kind:String(parsed.learning.kind || 'rule').slice(0,40),
        name:String(parsed.learning.name || 'Corrección aprobada').trim().slice(0,80),
        rule:String(parsed.learning.rule).trim().slice(0,1000),
        intent:String(parsed.learning.intent || trainingIntent(client)).slice(0,60),
        service:String(parsed.learning.service || trainingService(client)).slice(0,60),
        scope:'whatsapp'
      };
      const responseField = document.getElementById('gfc-yarbi-training-response');
      if (responseField) responseField.value = revised;
      window._gfcYarbiTrainingDraft = { ...(draft || {}), client, originalResponse:draft?.originalResponse || current, response:revised, correction, learning };
      trainingChatPush('yarbi',revised);
      trainingShowImprovement(client,revised);
      window.gfcYarbiTrainingPrepareLearning();
      trainingSetStatus('Corrección aplicada. Revisa exactamente qué aprenderá Yarbi antes de guardarlo.', 'trainer');
    } catch (error) {
      trainingVoiceSetState('idle','Hablar');
      trainingSetStatus('No pude convertir esa corrección en una regla verificable: ' + (error?.message || 'intenta nuevamente'), 'error');
    } finally { if (button) button.disabled = false; }
  };
  window.gfcYarbiTrainingPrepareLearning = function() {
    const client = String(document.getElementById('gfc-yarbi-training-client')?.value || '').trim();
    const response = String(document.getElementById('gfc-yarbi-training-response')?.value || '').trim();
    const correction = String(document.getElementById('gfc-yarbi-training-correction')?.value || '').trim();
    if (!client || response.length < 5) return trainingSetStatus('Completa el mensaje y tu respuesta correcta.', 'error');
    const draft = window._gfcYarbiTrainingDraft || {};
    const learning = draft.learning || {
      kind:'example',
      name:('Ejemplo de ' + trainingIntent(client)).slice(0,80),
      rule:('Ante una consulta de ' + trainingIntent(client) + (trainingService(client) !== 'general' ? ' sobre ' + trainingService(client) : '') + ', responder siguiendo el ejemplo aprobado por Omar sin copiar datos particulares de otros clientes.').slice(0,1000),
      intent:trainingIntent(client), service:trainingService(client), scope:'whatsapp'
    };
    window._gfcYarbiTrainingDraft = { ...draft, client, response, correction, learning, originalResponse:draft.originalResponse || response };
    const messages = trainingChatHistory();
    if (!messages.some(item => item.kind === 'learning' && item.learning?.rule === learning.rule && Number(item.at || 0) > Date.now() - 15000)) {
      trainingChatPush('system','Revisa esta regla antes de activarla.',{ kind:'learning', learning });
    }
    const target = document.getElementById('gfc-yarbi-training-learning');
    if (target) {
      target.hidden = false;
      target.innerHTML = '<b>Esto aprenderá Yarbi</b><br><span class="gfc-yarbi-training-learning-name">' + esc(learning.name) + '</span><br>' + esc(learning.rule) + '<br><small>Aplicación: WhatsApp · ' + esc(learning.intent) + ' · ' + esc(learning.service) + '</small><div class="gfc-yarbi-training-actions"><button class="gfc-yarbi-primary" onclick="gfcYarbiTrainingSaveExample()">✅ Aprobar y guardar</button><button class="gfc-yarbi-secondary" onclick="gfcYarbiTrainingSetRole(\'trainer\')">Seguir corrigiendo</button></div>';
    }
    trainingSetStatus('Aún no se guardó. Aprueba el resumen si refleja exactamente tu regla.', 'warning');
  };

  function trainingRenderList() {
    const target = document.getElementById('gfc-yarbi-training-list');
    if (!target) return;
    const recent = trainingHistory().slice().reverse();
    target.classList.toggle('gfc-yarbi-tool-copy', !recent.length);
    target.innerHTML = recent.length ? recent.map(trainingExampleHtml).join('') : 'Todavía no hay aprendizajes aprobados.';
  }

  async function trainingPullCloud() {
    if (!token()) return { ok:false, reason:'token_missing' };
    const response = await fetch(BACKEND + '/api/assistant/preferences?action=training', { headers:{ 'X-Assistant-Token':token() }, cache:'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok !== true || !Array.isArray(data.examples)) throw new Error(data.error || 'No se pudieron leer los aprendizajes de Supabase');
    const local = trainingHistory();
    const merged = new Map(data.examples.map(value => {
      const item = trainingNormalizeItem({ ...value, cloudStatus:'synced' });
      return item ? [String(item.id), item] : null;
    }).filter(Boolean));
    local.forEach(item => {
      const remote = merged.get(String(item.id));
      const keepLocal = item.cloudStatus !== 'synced' || !remote || Number(item.version || 1) > Number(remote.version || 1) || Number(item.updatedAt || 0) > Number(remote.updatedAt || 0);
      if (keepLocal) merged.set(String(item.id), item);
    });
    trainingSaveHistory(Array.from(merged.values()));
    return { ok:true, count:data.examples.length };
  }

  async function trainingFlushOutbox() {
    if (!token() || !navigator.onLine) return { synced:0, pending:readJson(TRAINING_OUTBOX_KEY, []).length };
    const queue = readJson(TRAINING_OUTBOX_KEY, []);
    if (!Array.isArray(queue) || !queue.length) return { synced:0, pending:0 };
    const remaining = [];
    let synced = 0;
    for (const raw of queue.slice(0, MAX_TRAINING_EXAMPLES)) {
      const item = trainingNormalizeItem(raw);
      if (!item) continue;
      try {
        await trainingSyncItem(item);
        if (!(await trainingVerifyItem(item.id))) throw new Error('readback_failed');
        trainingUpdateItems([item.id], () => ({ cloudStatus:'synced' }));
        synced += 1;
      } catch (_) { remaining.push(item); }
    }
    writeJson(TRAINING_OUTBOX_KEY, remaining);
    return { synced, pending:remaining.length };
  }

  async function trainingHydrate(viewGeneration) {
    try {
      await trainingPullCloud();
      await trainingFlushOutbox();
      if (window._gfcYarbiCurrentTab === 'practice' && viewGeneration === window._gfcYarbiViewGeneration) trainingRenderList();
    } catch (error) {
      if (window._gfcYarbiCurrentTab === 'practice' && viewGeneration === window._gfcYarbiViewGeneration) trainingSetStatus('📱 Aprendizajes locales disponibles. Supabase queda pendiente: ' + (error?.message || 'sin conexión'), 'warning');
    }
  }

  async function trainingSyncItem(item) {
    const response = await fetch(BACKEND + '/api/assistant/preferences?action=training', {
      method:'POST', headers:{ 'Content-Type':'application/json', 'X-Assistant-Token':token() },
      body:JSON.stringify({ operation:'upsert', confirm:true, example:item })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok !== true || data.source !== 'supabase') throw new Error(data.error || 'Supabase no confirmó el aprendizaje estructurado');
    return data;
  }
  async function trainingMarkUsed(ids, source) {
    const selected = [...new Set((Array.isArray(ids) ? ids : []).map(value => String(value || '')).filter(Boolean))].slice(0,12);
    if (!selected.length) return [];
    const now = Date.now();
    // No contamos frases parciales ni reconexiones como usos nuevos del mismo
    // ejemplo dentro de un mismo turno Live.
    const candidates = trainingHistory()
      .filter(item => selected.includes(String(item.id)) && item.active !== false)
      .filter(item => now - Number(item.lastUsedAt || 0) > 4500);
    if (!candidates.length) return [];
    const updated = trainingUpdateItems(candidates.map(item => item.id), item => ({
      usageCount:Number(item.usageCount || 0) + 1,
      lastUsedAt:now,
      cloudStatus:'pending'
    })).filter(item => candidates.some(candidate => String(candidate.id) === String(item.id)));
    window._gfcYarbiTrainingLastUsage = { at:now, source:String(source || 'training'), ids:updated.map(item => item.id) };
    const results = await Promise.allSettled(updated.map(async item => {
      await trainingSyncItem(item);
      return item.id;
    }));
    const synced = new Set(results.filter(result => result.status === 'fulfilled').map(result => String(result.value)));
    const failed = updated.filter(item => !synced.has(String(item.id)));
    if (synced.size) trainingUpdateItems([...synced], () => ({ cloudStatus:'synced' }));
    failed.forEach(trainingQueueItem);
    if (failed.length && typeof gfcChatDiag === 'function') gfcChatDiag('training-usage-sync-pending', { source:String(source || ''), count:failed.length });
    return updated;
  }
  async function trainingVerifyItem(id) {
    const response = await fetch(BACKEND + '/api/assistant/preferences?action=training&id=' + encodeURIComponent(id), { headers:{ 'X-Assistant-Token':token() }, cache:'no-store' });
    const data = await response.json().catch(() => ({}));
    return response.ok && data.ok === true && Array.isArray(data.examples) && data.examples.some(item => String(item.id) === String(id));
  }
  function trainingQueueItem(item) {
    const queue = readJson(TRAINING_OUTBOX_KEY, []);
    const next = [item, ...(Array.isArray(queue) ? queue : []).filter(old => String(old.id) !== String(item.id))].slice(0,MAX_TRAINING_EXAMPLES);
    writeJson(TRAINING_OUTBOX_KEY, next);
  }
  async function trainingSyncInstruction(item) {
    const instructionText = ('REGLA APROBADA POR OMAR PARA WHATSAPP [' + item.learning.intent + '/' + item.learning.service + ']: ' + item.learning.rule + ' Ejemplo aprobado: Cliente: “' + item.client + '” Respuesta: “' + item.response + '”. No copies datos particulares a otros clientes.').slice(0,1900);
    const record = { id:'instr_practice_' + item.id, name:item.learning.name, instruction:instructionText, category:'reply_training', scope:'whatsapp', active:item.active !== false, updatedAt:Date.now() };
    if (typeof gfcOwnerInstructionAddToCache === 'function') gfcOwnerInstructionAddToCache(record);
    if (typeof gfcOwnerInstructionSync !== 'function') throw new Error('Sincronización de instrucciones no disponible');
    const result = await gfcOwnerInstructionSync(record);
    if (!result || result.ok !== true || result.source !== 'supabase') throw new Error('Supabase no confirmó la instrucción');
    return true;
  }
  window.gfcYarbiTrainingSaveExample = async function() {
    const draft = window._gfcYarbiTrainingDraft;
    if (!draft?.client || !draft?.response || !draft?.learning?.rule) return window.gfcYarbiTrainingPrepareLearning();
    const key = trainingNormalizeText(draft.learning.intent + '|' + draft.learning.service + '|' + draft.learning.rule);
    const current = trainingHistory();
    const duplicate = current.find(old => trainingNormalizeText(old.learning.intent + '|' + old.learning.service + '|' + old.learning.rule) === key);
    const now = Date.now();
    const item = trainingNormalizeItem({
      ...(duplicate || {}),
      id:duplicate?.id || makeId('practice', key),
      client:draft.client,
      originalResponse:draft.originalResponse || draft.response,
      response:draft.response,
      correction:draft.correction || '',
      learning:draft.learning,
      active:true,
      cloudStatus:'pending',
      instructionStatus:'pending',
      tested:duplicate?.tested || false,
      testPassed:duplicate?.testPassed ?? null,
      usageCount:duplicate?.usageCount || 0,
      at:duplicate?.at || now,
      updatedAt:now,
      version:Number(duplicate?.version || 0) + 1
    });
    trainingSaveHistory([...current.filter(old => old.id !== item.id), item]);
    trainingQueueItem(item);
    trainingSetStatus('✅ Aprendido en el celular. Sincronizando Supabase en segundo plano…', 'success');
    trainingChatPush('yarbi','Entendido. Aprendí: “' + item.learning.rule + '”. Ya está activo en este celular; comprobaré la copia de Supabase en segundo plano.');
    const target = document.getElementById('gfc-yarbi-training-learning');
    if (target) target.innerHTML = '<b>Aprendizaje guardado</b><br>' + esc(item.learning.rule) + '<div class="gfc-yarbi-training-actions"><button class="gfc-yarbi-primary" onclick="gfcYarbiTrainingStartTest(\'' + esc(item.id) + '\')">🧪 Probar con otra frase</button><button class="gfc-yarbi-secondary" onclick="gfcYarbiTrainingContinueClient()">Continuar como cliente</button></div>';
    void (async () => {
      let instructionStatus = 'error', cloudStatus = 'error';
      try { await trainingSyncInstruction(item); instructionStatus = 'synced'; }
      catch (_) { if (typeof gfcOwnerInstructionQueue === 'function') gfcOwnerInstructionQueue({ id:'instr_practice_' + item.id, name:item.learning.name, instruction:item.learning.rule, category:'reply_training', scope:'whatsapp', active:true }); }
      try { await trainingSyncItem(item); if (await trainingVerifyItem(item.id)) cloudStatus = 'synced'; }
      catch (_) { trainingQueueItem(item); }
      trainingUpdateItems([item.id], () => ({ cloudStatus, instructionStatus }));
      refreshLearningEvidence().catch(() => {});
      if (cloudStatus === 'synced' && instructionStatus === 'synced') {
        writeJson(TRAINING_OUTBOX_KEY, readJson(TRAINING_OUTBOX_KEY, []).filter(old => String(old.id) !== String(item.id)));
        trainingSetStatus('✅ Aprendido y verificado en Supabase. Ya puede influir en futuras respuestas relacionadas.', 'success');
      } else if (instructionStatus === 'synced') {
        trainingSetStatus('✅ Regla activa. La ficha estructurada sigue en cola de sincronización.', 'warning');
      } else {
        trainingSetStatus('📱 Regla activa localmente. Supabase sigue pendiente y se reintentará.', 'warning');
      }
      trainingRenderList();
    })();
    return { ok:true, local:true, id:item.id };
  };
  window.gfcYarbiTrainingContinueClient = function() {
    window._gfcYarbiTrainingTestId = '';
    window._gfcYarbiTrainingDraft = null;
    ['gfc-yarbi-training-client','gfc-yarbi-training-response','gfc-yarbi-training-correction'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
    document.getElementById('gfc-yarbi-training-evidence')?.setAttribute('hidden','');
    document.getElementById('gfc-yarbi-training-learning')?.setAttribute('hidden','');
    const input = document.getElementById('gfc-yarbi-training-input');
    if (input) { input.value=''; input.focus(); }
    trainingSetStatus('Continúa escribiendo como cliente, corrigiendo o pidiendo consejo.', 'client');
  };
  window.gfcYarbiTrainingStartTest = function(id) {
    const item = trainingHistory().find(value => String(value.id) === String(id));
    if (!item) return;
    window.gfcYarbiTrainingContinueClient();
    window._gfcYarbiTrainingTestId = item.id;
    const field = document.getElementById('gfc-yarbi-training-input');
    if (field) { field.placeholder = 'Escribe otra manera en que un cliente podría pedir lo mismo que: ' + item.client; field.focus(); }
    trainingSetStatus('🧪 Prueba activa: usa una frase diferente. Después Yarbi te preguntará si aplicó la regla.', 'client');
  };
  window.gfcYarbiTrainingMarkTest = async function(passed) {
    const id = String(window._gfcYarbiTrainingTestId || '');
    if (!id) return;
    const testMessage = String(document.getElementById('gfc-yarbi-training-client')?.value || '').trim();
    const testResponse = String(document.getElementById('gfc-yarbi-training-response')?.value || '').trim();
    const list = trainingUpdateItems([id], () => ({ tested:true, testPassed:!!passed, testMessage, testResponse }));
    const item = list.find(value => String(value.id) === id);
    if (item) {
      try { await trainingSyncItem(item); if (await trainingVerifyItem(item.id)) trainingUpdateItems([id], () => ({ cloudStatus:'synced' })); }
      catch (_) { trainingQueueItem(item); }
    }
    trainingSetStatus(passed ? '✅ Aprendizaje comprobado con una frase diferente.' : '⚠️ La regla necesita ajuste. Corrige esta respuesta y guarda una nueva versión.', passed ? 'success' : 'warning');
    refreshLearningEvidence().catch(() => {});
    if (passed) window._gfcYarbiTrainingTestId = '';
  };
  window.gfcYarbiTrainingToggle = async function(id) {
    const list = trainingHistory();
    const item = list.find(value => String(value.id) === String(id));
    if (!item) return;
    const active = !item.active;
    const updated = trainingUpdateItems([id], () => ({ active, cloudStatus:'pending' })).find(value => String(value.id) === String(id));
    try { await trainingSyncItem(updated); trainingUpdateItems([id], () => ({ cloudStatus:'synced' })); }
    catch (_) { trainingQueueItem(updated); }
    window.gfcOpenCopilotModal('practice');
  };
  window.gfcYarbiTrainingDelete = async function(id) {
    if (!confirm('Se eliminará este aprendizaje del celular y se desactivará en Supabase. ¿Continuar?')) return;
    const item = trainingHistory().find(value => String(value.id) === String(id));
    trainingSaveHistory(trainingHistory().filter(value => String(value.id) !== String(id)));
    try {
      await fetch(BACKEND + '/api/assistant/preferences?action=training', { method:'POST', headers:{ 'Content-Type':'application/json', 'X-Assistant-Token':token() }, body:JSON.stringify({ operation:'delete', confirm:true, id }) });
    } catch (_) {}
    if (item && typeof gfcOwnerInstructionSync === 'function') {
      const instruction = typeof gfcOwnerInstructionVisibleList === 'function' ? gfcOwnerInstructionVisibleList().find(value => String(value.id) === 'instr_practice_' + id || String(value.name) === String(item.learning.name)) : null;
      if (instruction) try { await gfcOwnerInstructionSync({ ...instruction, operation:'delete' }); } catch (_) {}
    }
    window.gfcOpenCopilotModal('practice');
  };
  function importHtml() {
    return '<main class="gfc-yarbi-tool-page"><div class="gfc-yarbi-tool-card"><div class="gfc-yarbi-tool-title">Importar chats y aprender mi estilo</div>' +
      '<div class="gfc-yarbi-tool-copy">Puedes cargar una exportación TXT/ZIP o pegar una conversación completa mezclada. Yarbi separa quién escribió cada mensaje y te obliga a indicar cuál participante eres tú antes de aprender. No se suben archivos multimedia.</div>' +
      '<input id="gfc-batch-zip-input" type="file" accept=".zip,.txt,text/plain,application/zip" multiple hidden onchange="gfcBatchImportWhatsappFiles(this.files)">' +
      '<div class="gfc-yarbi-training-actions"><button class="gfc-yarbi-primary" onclick="document.getElementById(\'gfc-batch-zip-input\').click()">Seleccionar TXT o ZIP</button><button class="gfc-yarbi-secondary" onclick="document.getElementById(\'gfc-yarbi-import-paste-wrap\').classList.toggle(\'gfc-yarbi-hidden\')">Pegar conversación</button></div>' +
      '<div id="gfc-yarbi-import-paste-wrap" class="gfc-yarbi-import-paste gfc-yarbi-hidden"><label for="gfc-yarbi-import-paste">Conversación copiada de WhatsApp</label><textarea id="gfc-yarbi-import-paste" rows="9" placeholder="Puedes pegar el TXT exportado o líneas como:\nCliente: Hola, necesito una modificación\nOmar: Claro, envíame un video del trabajo"></textarea><button class="gfc-yarbi-primary" onclick="gfcParsePastedWhatsappConversation()">Analizar sin importar todavía</button><small>No pegues contraseñas ni claves. Primero verás el resumen y elegirás cuál nombre eres tú.</small></div>' +
      '<div class="gfc-yarbi-progress"><div id="gfc-yarbi-import-progress"></div></div><div id="gfc-yarbi-import-status" class="gfc-yarbi-tool-copy">Sin importación pendiente.</div><div id="gfc-yarbi-import-preview"></div></div></main>';
  }
  function mediaHtml() {
    return '<main class="gfc-yarbi-tool-page"><div class="gfc-yarbi-tool-card"><div class="gfc-yarbi-tool-title">Biblioteca local Yarbi</div>' +
      '<div class="gfc-yarbi-tool-copy">Elige una carpeta “Yarbi Multimedia”. Las fotos y videos permanecen únicamente en el celular: no se envían a Supabase. Para compartir, Android abre WhatsApp Business y tú confirmas el destinatario y el envío.</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="gfc-yarbi-primary" onclick="gfcChooseYarbiMediaFolder()">Elegir carpeta</button><button class="gfc-yarbi-secondary" onclick="gfcRefreshYarbiMediaLibrary()">Actualizar</button></div>' +
      '<div id="gfc-yarbi-media-status" class="gfc-yarbi-import-summary">Consultando carpeta local…</div><div id="gfc-yarbi-media-grid" class="gfc-yarbi-media-grid"></div></div></main>';
  }
  function ordersHtml() {
    const html = typeof gfcOwnerInstructionSettingsHtml === 'function' ? gfcOwnerInstructionSettingsHtml() : '<div>No disponible.</div>';
    return '<main class="gfc-yarbi-tool-page"><div class="gfc-yarbi-tool-card"><div class="gfc-yarbi-tool-title">Instrucciones permanentes</div>' + html + '</div></main>';
  }
  function statusHtml() {
    const report = typeof gfcVoicePipelinePanelHtml === 'function' ? gfcVoicePipelinePanelHtml() : '';
    return '<main class="gfc-yarbi-tool-page"><div class="gfc-yarbi-tool-card"><div class="gfc-yarbi-tool-title">Estado de Yarbi</div>' +
      '<div id="gfc-ai-process-status" class="gfc-yarbi-import-summary">Verificando chats, memoria local y procesos…</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button id="gfc-ai-process-btn" class="gfc-yarbi-primary" onclick="gfcProcessYarbiInformation()">Actualizar Yarbi</button><button id="gfc-reply-style-btn" class="gfc-yarbi-secondary" onclick="gfcLearnHistoricalReplyStyle()">Aprender mi estilo</button></div></div>' + report + '</main>';
  }

  function setInstructionHeaderStatus(text, color) {
    if (window._gfcYarbiCurrentTab !== 'ordenes') return;
    const header = document.getElementById('gfc-yarbi-header-status');
    if (!header) return;
    header.textContent = text;
    header.style.color = color || '#15803D';
  }
  function loadInstructionViewInBackground(viewGeneration) {
    if (typeof gfcLoadOwnerInstructions !== 'function') return;
    if (window._gfcOwnerInstructionsViewLoad) return;
    let timeoutId = 0;
    const timeout = new Promise((_, reject) => {
      timeoutId = window.setTimeout(() => reject(new Error('instruction-sync-timeout')), 6500);
    });
    const load = Promise.resolve().then(() => gfcLoadOwnerInstructions());
    window._gfcOwnerInstructionsViewLoad = Promise.race([load, timeout])
      .then(() => {
        if (viewGeneration !== window._gfcYarbiViewGeneration || window._gfcYarbiCurrentTab !== 'ordenes') return;
        refreshInstructionPage();
        setInstructionHeaderStatus('● Instrucciones sincronizadas', '#15803D');
      })
      .catch(error => {
        if (viewGeneration !== window._gfcYarbiViewGeneration || window._gfcYarbiCurrentTab !== 'ordenes') return;
        setInstructionHeaderStatus('● Copia local disponible', '#B45309');
        if (typeof gfcChatDiag === 'function') gfcChatDiag('yarbi-instructions-background-sync', { message:error?.message || String(error) });
      })
      .finally(() => {
        if (timeoutId) window.clearTimeout(timeoutId);
        window._gfcOwnerInstructionsViewLoad = null;
      });
  }

  window.gfcOpenCopilotModal = function(initialTab, suggestionId) {
    if (initialTab === 'practice') {
      localStorage.setItem(INTERACTION_MODE_KEY, 'training');
      initialTab = 'chat';
    }
    const tab = initialTab || 'chat';
    window._gfcYarbiCurrentTab = tab;
    const viewGeneration = Number(window._gfcYarbiViewGeneration || 0) + 1;
    window._gfcYarbiViewGeneration = viewGeneration;
    const suggestion = (window._gfcWhatsappSuggestions || []).find(s => String(s.id) === String(suggestionId) || String(s.id).replace(/[^a-zA-Z0-9_-]/g, '_') === String(suggestionId));
    window._gfcActiveAlertId = suggestion?.id || '';
    window._gfcActiveClientPhone = suggestion && typeof gfcExtractPhoneNumber === 'function' ? gfcExtractPhoneNumber(suggestion.phone || suggestion.title) : '';
    window._gfcActiveClientName = suggestion ? (suggestion._geminiNombre || suggestion._contactName || suggestion.title || '') : '';
    if (suggestion && typeof gfcYarbiConversationFocusSet === 'function') {
      gfcYarbiConversationFocusSet({
        client_name:window._gfcActiveClientName,
        phone:window._gfcActiveClientPhone,
        agenda_id:suggestion.agenda_id || '',
        pending_action:suggestion.action || '',
        confirmed:true
      }, 'yarbi-alert-open');
    }
    const content = document.getElementById('modal-content');
    if (!content) return;
    const title = tab === 'chat' ? 'Yarbi' : ({ conversations:'Conversaciones', tools:'Memoria y aprendizaje', masivo:'Importar chats', knowledge:'Conocimiento', memoria:'Fotos y videos', ordenes:'Instrucciones', practice:'Cliente simulado', learning:'Aprendizaje y autonomía', status:'Estado y diagnóstico' }[tab] || 'Yarbi');
    content.innerHTML = '<section class="gfc-yarbi-shell">' + headerHtml(title, tab) +
      (tab === 'chat' ? chatHtml() : tab === 'conversations' ? conversationHistoryHtml() : tab === 'tools' ? hubHtml() : tab === 'masivo' ? importHtml() : tab === 'knowledge' ? (typeof window.gfcYarbiKnowledgeHtml === 'function' ? window.gfcYarbiKnowledgeHtml() : '<main class="gfc-yarbi-tool-page"><p>La biblioteca de conocimiento no está disponible en esta copia.</p></main>') : tab === 'ads' ? (typeof window.gfcYarbiMetaAdsHtml === 'function' ? window.gfcYarbiMetaAdsHtml() : '<main class="gfc-yarbi-tool-page"><p>Meta Ads local no está disponible en esta copia.</p></main>') : tab === 'memoria' ? mediaHtml() : tab === 'ordenes' ? ordersHtml() : tab === 'practice' ? trainingHtml() : tab === 'learning' ? learningHtml() : statusHtml()) + '</section>';
    document.body.classList.add('gfc-yarbi-screen');
    document.getElementById('modal').style.display = 'flex';
    document.body.style.overflow = 'hidden';
    if (tab === 'chat') {
      if (interactionMode() === 'training') {
        trainingChatRender();
        const header = document.getElementById('gfc-yarbi-header-status');
        if (header) { header.textContent = '● Entrenamiento seguro'; header.style.color = '#6D28D9'; }
      } else {
        window.gfcRestoreCopilotChat();
        restoreYarbiConversationDraft();
      }
      if (typeof gfcRefreshYarbiConversationFocusUi === 'function') gfcRefreshYarbiConversationFocusUi();
      if (typeof gfcRefreshYarbiModeUi === 'function') gfcRefreshYarbiModeUi();
      if (interactionMode() !== 'training') {
        // La apertura del chat no compite con Live ni vuelve a descargar el
        // histórico. La rutina central espera a que el audio se estabilice y
        // después hace únicamente una sincronización incremental.
        if (typeof gfcScheduleYarbiOpenRefresh === 'function') gfcScheduleYarbiOpenRefresh();
        else setTimeout(() => {
          if (typeof gfcSyncYarbiLocalMirror !== 'function') return;
          Promise.resolve(gfcSyncYarbiLocalMirror({ reason:'yarbi-open-incremental', backfill:false }))
            .then(() => typeof gfcYarbiOfferHabitCandidate === 'function' && gfcYarbiOfferHabitCandidate())
            .catch(() => {});
        }, 1200);
      }
    }
    if (tab === 'conversations') setTimeout(() => window.gfcRenderYarbiConversationHistory(), 0);
    if (tab === 'knowledge') setTimeout(() => window.gfcYarbiKnowledgeAttach?.(), 0);
    if (tab === 'ads') setTimeout(() => window.gfcYarbiMetaAdsAttach?.(), 0);
    if (tab === 'memoria') setTimeout(() => window.gfcRefreshYarbiMediaLibrary(), 0);
    if (tab === 'ordenes') loadInstructionViewInBackground(viewGeneration);
    if (tab === 'practice') setTimeout(() => {
      if (window._gfcLiveSession?.active && typeof gfcStopGeminiLive === 'function') gfcStopGeminiLive();
      trainingChatRender();
      trainingVoiceSetState('idle','Hablar');
      const input = document.getElementById('gfc-yarbi-training-input');
      input?.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); window.gfcYarbiTrainingSend(); }
      });
      trainingHydrate(viewGeneration);
    }, 0);
    if (tab === 'chat' || tab === 'learning') setTimeout(() => refreshLearningEvidence().catch(() => {}), 0);
    if (tab === 'status') setTimeout(() => { if (typeof gfcRefreshYarbiProcessingStatus === 'function') gfcRefreshYarbiProcessingStatus({ quiet:true }); }, 0);
  };

  window.addEventListener('online', () => { trainingFlushOutbox().catch(() => {}); });

  const originalRefreshMode = window.gfcRefreshYarbiModeUi;
  window.gfcRefreshYarbiModeUi = function(message) {
    if (typeof originalRefreshMode === 'function') originalRefreshMode(message);
    const mode = activeMode();
    const chip = document.getElementById('gfc-yarbi-mode-chip');
    if (chip) chip.textContent = message || (mode.label + ' · ' + mode.voice);
  };
  const originalProcessingUi = window.gfcSetYarbiProcessingUi;
  window.gfcSetYarbiProcessingUi = function(data) {
    if (typeof originalProcessingUi === 'function') originalProcessingUi(data || {});
    const label = document.getElementById('gfc-ai-process-status');
    const header = document.getElementById('gfc-yarbi-header-status');
    if (!header) return;
    const text = String(label?.textContent || '');
    if (/al día/i.test(text)) { header.textContent = '● Al día'; header.style.color = '#15803D'; }
    else if (/pendiente|desactualizada|requieren|sin cuota|sin conexión/i.test(text)) { header.textContent = '● Revisión pendiente'; header.style.color = '#B45309'; }
    else { header.textContent = '● Actualizando'; header.style.color = '#0369A1'; }
  };

  window.gfcGetYarbiLiveVolume = function() { return 1; };
  window.gfcSetYarbiLiveVolume = function() {
    localStorage.setItem('gfc_yarbi_live_volume_v1', '1');
    const session = window._gfcLiveSession || {};
    const gain = session.liveOutputGain;
    const ctx = session.outputContext || session.audioContext;
    if (gain && ctx && ctx.state !== 'closed') gain.gain.setTargetAtTime(1, ctx.currentTime, 0.015);
  };
  window.gfcRefreshYarbiLiveVolumeUi = function() {};
  localStorage.setItem('gfc_yarbi_live_volume_v1', '1');

  function cleanWhatsAppText(value) {
    return String(value || '').replace(/[\u200e\u200f\u202a-\u202e]/g, '').replace(/\r/g, '').trim();
  }
  function normalizePerson(value) {
    return cleanWhatsAppText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9+]/g, '');
  }
  function parseWhatsAppDate(datePart, timePart) {
    const d = String(datePart || '').match(/(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})/);
    const t = cleanWhatsAppText(timePart).toLowerCase().replace(/\s/g, '');
    const tm = t.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?(a\.?m\.?|p\.?m\.?)?/);
    if (!d || !tm) return Date.now();
    let year = Number(d[3]); if (year < 100) year += 2000;
    let hour = Number(tm[1]);
    const suffix = String(tm[4] || '').replace(/\./g, '');
    if (suffix === 'pm' && hour < 12) hour += 12;
    if (suffix === 'am' && hour === 12) hour = 0;
    const iso = year + '-' + String(Number(d[2])).padStart(2,'0') + '-' + String(Number(d[1])).padStart(2,'0') + 'T' + String(hour).padStart(2,'0') + ':' + tm[2] + ':' + String(tm[3] || '00').padStart(2,'0') + '-05:00';
    const parsed = Date.parse(iso);
    return Number.isFinite(parsed) ? parsed : Date.now();
  }
  function parseWhatsAppExport(text, sourceName) {
    const messages = [];
    const participants = new Map();
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    const pattern = /^\s*\[?(\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?\s*m\.?)?)\]?\s*(?:-\s*)?([^:]{1,100}):\s?(.*)$/i;
    let current = null;
    for (const raw of lines) {
      const line = cleanWhatsAppText(raw);
      const match = line.match(pattern);
      if (match) {
        current = { timestamp:parseWhatsAppDate(match[1], match[2]), sender:cleanWhatsAppText(match[3]), text:cleanWhatsAppText(match[4]), sourceName };
        messages.push(current);
        participants.set(current.sender, (participants.get(current.sender) || 0) + 1);
      } else if (current && line) {
        current.text = (current.text + '\n' + line).trim().slice(0, 8000);
      }
    }
    return { messages:messages.filter(item => item.text && !/<Multimedia omitido>|<Media omitted>|se unió|cambió el código de seguridad/i.test(item.text)), participants };
  }
  function parseLabeledConversation(text, sourceName) {
    const messages = [];
    const participants = new Map();
    const lines = String(text || '').replace(/\r/g,'').split('\n');
    const base = Date.now() - Math.max(1, lines.length) * 1000;
    let current = null;
    for (const raw of lines) {
      const line = cleanWhatsAppText(raw);
      if (!line) continue;
      const match = line.match(/^([^:\n]{1,80}):\s*(.+)$/);
      if (match) {
        const sender = cleanWhatsAppText(match[1]);
        if (/^(http|https|nota|fecha|hora)$/i.test(sender)) {
          if (current) current.text = (current.text + '\n' + line).slice(0,8000);
          continue;
        }
        current = { timestamp:base + messages.length * 1000, sender, text:cleanWhatsAppText(match[2]), sourceName };
        messages.push(current);
        participants.set(sender, (participants.get(sender) || 0) + 1);
      } else if (current) current.text = (current.text + '\n' + line).trim().slice(0,8000);
    }
    if (participants.size < 2 || messages.length < 2) return { messages:[], participants:new Map() };
    return { messages, participants };
  }
  function parseImportConversation(text, sourceName) {
    const exported = parseWhatsAppExport(text, sourceName);
    return exported.messages.length ? exported : parseLabeledConversation(text, sourceName);
  }
  function u16(view, offset) { return view.getUint16(offset, true); }
  function u32(view, offset) { return view.getUint32(offset, true); }
  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') throw new Error('Este Android no puede descomprimir ZIP. Exporta el chat como TXT.');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function zipTextEntries(file) {
    const buffer = await file.arrayBuffer();
    const view = new DataView(buffer);
    let eocd = -1;
    for (let i = Math.max(0, buffer.byteLength - 65557); i <= buffer.byteLength - 22; i += 1) {
      if (u32(view, i) === 0x06054b50) eocd = i;
    }
    if (eocd < 0) throw new Error('ZIP inválido o protegido con contraseña.');
    const entries = [];
    const decoder = new TextDecoder('utf-8');
    let offset = u32(view, eocd + 16);
    const total = u16(view, eocd + 10);
    for (let n = 0; n < total && offset + 46 <= buffer.byteLength; n += 1) {
      if (u32(view, offset) !== 0x02014b50) break;
      const method = u16(view, offset + 10);
      const compressedSize = u32(view, offset + 20);
      const nameLen = u16(view, offset + 28);
      const extraLen = u16(view, offset + 30);
      const commentLen = u16(view, offset + 32);
      const localOffset = u32(view, offset + 42);
      const name = decoder.decode(new Uint8Array(buffer, offset + 46, nameLen));
      if (/\.txt$/i.test(name) && u32(view, localOffset) === 0x04034b50) {
        const localNameLen = u16(view, localOffset + 26);
        const localExtraLen = u16(view, localOffset + 28);
        const dataStart = localOffset + 30 + localNameLen + localExtraLen;
        const compressed = new Uint8Array(buffer, dataStart, compressedSize);
        const bytes = method === 0 ? compressed : method === 8 ? await inflateRaw(compressed) : null;
        if (bytes) entries.push({ name, text:decoder.decode(bytes) });
      }
      offset += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }
  async function readImportFiles(files) {
    const entries = [];
    for (const file of Array.from(files || [])) {
      if (/\.zip$/i.test(file.name)) entries.push(...await zipTextEntries(file));
      else if (/\.txt$/i.test(file.name) || String(file.type).includes('text')) entries.push({ name:file.name, text:await file.text() });
    }
    return entries;
  }
  function importStatus(text, percent) {
    const status = document.getElementById('gfc-yarbi-import-status');
    const bar = document.getElementById('gfc-yarbi-import-progress');
    if (status) status.textContent = text;
    if (bar) bar.style.width = Math.max(0, Math.min(100, Number(percent) || 0)) + '%';
  }
  function prepareImportEntries(entries) {
    const conversations = [];
    const totalParticipants = new Map();
    (entries || []).forEach(entry => {
      const parsed = parseImportConversation(entry.text, entry.name);
      if (!parsed.messages.length) return;
      conversations.push({ name:entry.name, messages:parsed.messages });
      parsed.participants.forEach((count, name) => totalParticipants.set(name, (totalParticipants.get(name) || 0) + count));
    });
    if (!conversations.length) throw new Error('No encontré mensajes con remitentes. Usa una exportación de WhatsApp o líneas “Nombre: mensaje”.');
    const participants = [...totalParticipants.entries()].sort((a,b) => b[1]-a[1]);
    const preferredName = String(window.state?.nombreUsuario || localStorage.getItem('fnz_nombre') || 'Omar');
    const defaultOwner = participants.find(([name]) => normalizePerson(name).includes(normalizePerson(preferredName)))?.[0] || '';
    window._gfcYarbiImportDraft = { conversations, participants, owner:defaultOwner, review:null };
    const preview = document.getElementById('gfc-yarbi-import-preview');
    if (preview) preview.innerHTML = '<div class="gfc-yarbi-import-summary"><b>Encontré ' + conversations.length + ' chat(s) y ' + conversations.reduce((sum,c) => sum+c.messages.length,0) + ' mensajes.</b><br>Indica cuál participante eres tú. Sin esta selección Yarbi no aprenderá ni importará nada.</div>' +
      '<label style="display:block;font-size:11px;font-weight:900;color:#334155;margin:10px 0 5px">Yo soy:</label><select id="gfc-yarbi-import-owner" onchange="gfcRefreshHistoricalImportReview()" style="width:100%;padding:10px;border:1px solid #CBD5E1;border-radius:10px;background:#fff"><option value="">Selecciona tu nombre…</option>' +
      participants.map(([name,count]) => '<option value="' + esc(name) + '"' + (name === defaultOwner ? ' selected' : '') + '>' + esc(name) + ' · ' + count + ' mensajes</option>').join('') + '</select>' +
      '<div id="gfc-yarbi-import-review" class="gfc-yarbi-import-summary" style="margin-top:10px"></div>' +
      '<label style="display:flex;gap:8px;align-items:flex-start;font-size:12px;color:#334155;margin-top:10px"><input id="gfc-yarbi-import-review-confirmed" type="checkbox"> <span>Entiendo que Yarbi solo importará chats que coincidan con un contacto CRM ya verificado. Las visitas, trabajos y pagos detectados quedarán como propuestas para revisar: no se modificarán automáticamente CRM, Agenda ni Movimientos.</span></label>' +
      '<button class="gfc-yarbi-primary" style="width:100%;margin-top:10px" onclick="gfcConfirmMassImport()">Importar chats verificados para revisión</button>';
    window.gfcRefreshHistoricalImportReview();
    importStatus('Revisión lista. Aún no se subió nada.', 25);
    return { conversations, participants };
  }
  function historicalImportReviewHtml(review) {
    const totals = review?.totals || {};
    const identities = totals.identity || {};
    const eventTypes = (review?.conversations || []).flatMap(item => item.event_candidates || []).reduce((counts, item) => {
      counts[item.type] = (counts[item.type] || 0) + 1;
      return counts;
    }, {});
    const labels = { service_mentioned:'servicios mencionados', visit_mentioned:'visitas mencionadas', work_completion_reported:'trabajos reportados como terminados', payment_reported:'pagos o abonos mencionados' };
    const eventText = Object.entries(eventTypes).map(([type,count]) => count + ' ' + (labels[type] || type)).join(' · ') || 'sin señales comerciales detectadas';
    return '<b>Revisión histórica antes de importar</b><br>' +
      '<span>' + Number(totals.owner_messages || 0) + ' mensajes tuyos · ' + Number(totals.reply_pairs || 0) + ' pares posibles para aprender estilo.</span><br>' +
      '<span>Identidad: ' + Number(identities.candidate_phone_match || 0) + ' con teléfono candidato · ' + Number(identities.needs_contact_match || 0) + ' sin contacto verificable · ' + Number(identities.ambiguous_participants || 0) + ' chats ambiguos.</span><br>' +
      '<span>Señales a conciliar: ' + esc(eventText) + '.</span><br><small>Estas señales no cambian estados. Un pago debe coincidir con Movimientos y una visita/trabajo requiere confirmación tuya.</small>';
  }
  window.gfcRefreshHistoricalImportReview = function() {
    const draft = window._gfcYarbiImportDraft;
    const selected = document.getElementById('gfc-yarbi-import-owner')?.value || draft?.owner || '';
    const target = document.getElementById('gfc-yarbi-import-review');
    if (!draft?.conversations?.length || !target) return null;
    if (!selected) {
      target.textContent = 'Selecciona primero cuál participante eres tú para revisar identidad y aprendizaje.';
      return null;
    }
    const reviewApi = window.gfcYarbiHistoricalLearning;
    if (!reviewApi?.reviewHistoricalConversations) {
      target.textContent = 'La revisión local del histórico no está disponible en esta copia.';
      return null;
    }
    try {
      const review = reviewApi.reviewHistoricalConversations({ conversations:draft.conversations, owner:selected });
      draft.owner = selected;
      draft.review = review;
      target.innerHTML = historicalImportReviewHtml(review);
      return review;
    } catch (error) {
      target.textContent = 'No se pudo preparar la revisión: ' + (error?.message || 'datos incompletos');
      return null;
    }
  };
  window.gfcParsePastedWhatsappConversation = function() {
    const text = String(document.getElementById('gfc-yarbi-import-paste')?.value || '').trim();
    if (text.length < 10) return importStatus('Pega primero una conversación completa.', 0);
    try { prepareImportEntries([{ name:'Conversación pegada.txt', text }]); }
    catch (error) { importStatus(error?.message || 'No pude separar la conversación.', 0); }
  };
  window.gfcBatchImportWhatsappFiles = async function(files) {
    if (!files || !files.length) return;
    importStatus('Leyendo exportaciones sin subir archivos…', 8);
    try {
      const entries = await readImportFiles(files);
      prepareImportEntries(entries);
    } catch (error) {
      importStatus(error?.message || 'No se pudo leer la exportación.', 0);
      if (typeof toast === 'function') toast(error?.message || 'No se pudo leer la exportación.', 'error');
    }
  };
  window.gfcConfirmMassImport = async function() {
    const draft = window._gfcYarbiImportDraft;
    if (!draft?.conversations?.length) return;
    const selected = document.getElementById('gfc-yarbi-import-owner')?.value || draft.owner;
    if (!selected) {
      importStatus('Selecciona cuál participante eres tú antes de importar.', 25);
      if (typeof toast === 'function') toast('Falta indicar cuál nombre eres tú.', 'warning');
      return;
    }
    if (!document.getElementById('gfc-yarbi-import-review-confirmed')?.checked) {
      importStatus('Confirma primero que revisarás las propuestas antes de cambiar datos comerciales.', 25);
      if (typeof toast === 'function') toast('Falta confirmar la revisión comercial del histórico.', 'warning');
      return;
    }
    const review = window.gfcRefreshHistoricalImportReview();
    if (!review) return;
    const ownerNorm = normalizePerson(selected);
    const batchId = 'import_' + Date.now().toString(36);
    const records = [];
    let outgoing = 0;
    let incoming = 0;
    let unresolved = 0;
    let deferred = 0;
    const phoneKey = value => String(value || '').replace(/\D/g,'').replace(/^51(?=9\d{8}$)/, '');
    const [identifiers, contacts] = typeof gfcYarbiLocalRows === 'function'
      ? await Promise.all([gfcYarbiLocalRows('identifier').catch(() => []), gfcYarbiLocalRows('contact').catch(() => [])])
      : [[], []];
    const contactById = new Map((contacts || []).map(row => [String(row.id || ''), row]));
    const contactByPhone = new Map();
    (identifiers || []).forEach(row => {
      if (String(row?.identifier_type || '') !== 'phone') return;
      const phone = phoneKey(row.normalized_value || row.identifier_value);
      const contactId = String(row.contact_id || '');
      if (phone && contactId && contactById.has(contactId) && !contactByPhone.has(phone)) contactByPhone.set(phone, contactId);
    });
    draft.conversations.forEach((conversation, conversationIndex) => {
      const conversationReview = review.conversations[conversationIndex] || {};
      const people = [...new Set(conversation.messages.map(m => m.sender))];
      const contact = conversationReview.counterparty_names?.[0] || people.find(name => normalizePerson(name) !== ownerNorm) || '';
      const phone = phoneKey(conversationReview.phone_candidate || '');
      const contactId = conversationReview.identity_state === 'candidate_phone_match' ? contactByPhone.get(phone) : '';
      if (!contactId) { unresolved += 1; deferred += 1; return; }
      const crmContact = contactById.get(contactId) || {};
      conversation.messages.forEach(message => {
        const direction = normalizePerson(message.sender) === ownerNorm ? 'outgoing' : 'incoming';
        direction === 'outgoing' ? outgoing += 1 : incoming += 1;
        const seed = conversation.name + '|' + message.timestamp + '|' + message.sender + '|' + message.text;
        records.push({
          id:'wa_hist_' + makeId('m', seed).slice(-12),
          phone,
          contact_id:contactId,
          title:crmContact.display_name || crmContact.full_name || contact || message.sender || 'Cliente histórico',
          text:message.text,
          maps_url:typeof gfcExtractMapsLink === 'function' ? (gfcExtractMapsLink(message.text) || null) : null,
          app_name:'WhatsApp Business',
          timestamp:message.timestamp,
          metadata:{
            direction,
            historical:true,
            source:'mass_import',
            import_batch_id:batchId,
            conversation_name:conversation.name,
            sender_name:message.sender,
            original_timestamp:new Date(message.timestamp).toISOString(),
            identity_state:'crm_phone_verified',
            participant_role:direction === 'outgoing' ? 'owner' : 'customer',
            historical_review_only:true
          }
        });
      });
    });
    const eventCandidates = Number(review.totals?.event_candidates || 0);
    if (!records.length) {
      writeJson(IMPORT_STATE_KEY, { batchId, imported:0, deferredConversations:deferred, outgoing, incoming, unresolvedConversations:unresolved, eventCandidates, at:Date.now(), owner:selected, status:'needs_contact_matching' });
      importStatus('No importé chats todavía: ' + deferred + ' conversación(es) requieren coincidir primero con un contacto CRM verificable. No se creó ni modificó ningún contacto.', 100);
      if (typeof toast === 'function') toast('Historial revisado. Vincula los chats con CRM antes de importarlos.', 'warning');
      return;
    }
    importStatus('Importando 0 de ' + records.length + '…', 30);
    let imported = 0;
    try {
      for (let i = 0; i < records.length; i += 50) {
        const chunk = records.slice(i, i+50);
        const response = await fetch(BACKEND + '/api/supabase-secure?action=import', {
          method:'POST',
          headers:{ 'Content-Type':'application/json', 'X-Assistant-Token':token() },
          body:JSON.stringify(chunk)
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || data.message || ('Importación HTTP ' + response.status));
        imported += chunk.length;
        importStatus('Importando ' + imported + ' de ' + records.length + '…', 30 + Math.round(imported / records.length * 55));
      }
      writeJson(IMPORT_STATE_KEY, { batchId, imported, deferredConversations:deferred, outgoing, incoming, unresolvedConversations:unresolved, eventCandidates, at:Date.now(), owner:selected, status:'imported_for_review' });
      importStatus('Importados ' + imported + ' mensajes de chats CRM verificados. Preparando la copia local…', 90);
      if (typeof gfcSyncYarbiLocalMirror === 'function') await Promise.resolve(gfcSyncYarbiLocalMirror({ reason:'mass-import', backfill:true })).catch(() => {});
      await refreshLearningEvidence().catch(() => {});
      importStatus('100% · ' + imported + ' mensajes importados para revisión. ' + eventCandidates + ' señal(es) comercial(es) quedan como propuestas; ' + deferred + ' conversación(es) siguen sin vincular a CRM. El aprendizaje de estilo requiere tu acción explícita.', 100);
      if (typeof toast === 'function') toast('Historial importado para revisión. No se cambiaron cobros, visitas ni servicios.', 'success');
    } catch (error) {
      importStatus('Se detuvo en ' + imported + ' de ' + records.length + ': ' + (error?.message || 'error desconocido'), Math.round(imported / records.length * 100));
      if (typeof toast === 'function') toast('Importación incompleta. No se reportó éxito falso.', 'error');
    }
  };

  function mediaPlugin() {
    return window.Capacitor?.Plugins?.YarbiMediaLibrary || null;
  }
  function mediaStatus(text, error) {
    const el = document.getElementById('gfc-yarbi-media-status');
    if (el) { el.textContent = text; el.style.color = error ? '#B91C1C' : '#334155'; }
  }
  window.gfcChooseYarbiMediaFolder = async function() {
    const plugin = mediaPlugin();
    if (!plugin) return mediaStatus('La biblioteca persistente está disponible en la APK Android, no en este navegador.', true);
    try {
      const result = await plugin.chooseFolder();
      mediaStatus('Carpeta autorizada: ' + (result.name || 'Yarbi Multimedia') + '. Nada se sube a Supabase.');
      await window.gfcRefreshYarbiMediaLibrary();
    } catch (error) { mediaStatus(error?.message || 'No se seleccionó una carpeta.', true); }
  };
  window.gfcRefreshYarbiMediaLibrary = async function() {
    const plugin = mediaPlugin();
    const grid = document.getElementById('gfc-yarbi-media-grid');
    if (!grid) return;
    if (!plugin) { mediaStatus('Instala esta APK en Android para elegir una carpeta local persistente.', true); grid.innerHTML = ''; return; }
    try {
      const status = await plugin.getStatus();
      if (!status.selected) { mediaStatus('Aún no elegiste la carpeta Yarbi Multimedia.'); grid.innerHTML = ''; return; }
      const result = await plugin.listMedia();
      const items = Array.isArray(result.items) ? result.items : [];
      mediaStatus((result.name || 'Yarbi Multimedia') + ' · ' + items.length + ' archivo(s) locales · 0 archivos en Supabase');
      grid.innerHTML = items.map((item,index) => '<div class="gfc-yarbi-media-item"><div class="gfc-yarbi-media-preview" id="gfc-media-preview-' + index + '">' + (item.kind === 'video' ? '🎬' : '🖼️') + '</div><div class="gfc-yarbi-media-meta"><b>' + esc(item.name) + '</b><span>' + esc(item.kind === 'video' ? 'Video' : 'Foto') + ' · ' + Math.max(1,Math.round(Number(item.size || 0)/1024)) + ' KB</span><button class="gfc-yarbi-secondary" style="width:100%;margin-top:7px" onclick="gfcShareYarbiMedia(' + index + ')">Compartir</button></div></div>').join('');
      window._gfcYarbiMediaItems = items;
      items.slice(0,20).forEach((item,index) => plugin.preview({ uri:item.uri }).then(result => {
        const target = document.getElementById('gfc-media-preview-' + index);
        if (target && result.dataUrl) { target.textContent = ''; target.style.backgroundImage = 'url("' + result.dataUrl + '")'; }
      }).catch(() => {}));
    } catch (error) { mediaStatus(error?.message || 'No se pudo leer la carpeta.', true); grid.innerHTML = ''; }
  };
  window.gfcShareYarbiMedia = async function(index) {
    const item = (window._gfcYarbiMediaItems || [])[Number(index)];
    const plugin = mediaPlugin();
    if (!item || !plugin) return;
    if (!confirm('Se abrirá WhatsApp Business con “' + item.name + '”. Tú elegirás el cliente y confirmarás el envío. ¿Continuar?')) return;
    try {
      await plugin.share({ uri:item.uri, packageName:'com.whatsapp.w4b' });
      if (typeof toast === 'function') toast('WhatsApp abierto. Revisa el destinatario antes de enviar.', 'info');
    } catch (error) { if (typeof toast === 'function') toast(error?.message || 'No se pudo abrir WhatsApp.', 'error'); }
  };
  window.gfcUploadVisualMemory = function() {
    if (typeof toast === 'function') toast('Fotos y videos ahora permanecen solo en la carpeta local Yarbi Multimedia.', 'info');
    window.gfcOpenCopilotModal('memoria');
  };

  function refreshInstructionPage() {
    if (window._gfcYarbiCurrentTab !== 'ordenes') return;
    const page = document.querySelector('.gfc-yarbi-shell > .gfc-yarbi-tool-page');
    if (page) page.outerHTML = ordersHtml();
  }
  window.gfcOwnerInstructionSaveFromSettings = function() {
    const instruction = String(document.getElementById('yarbi-instruction-text-input')?.value || '').trim().replace(/\s+/g,' ');
    if (instruction.length < 8) return typeof toast === 'function' && toast('Escribe una instrucción más clara.', 'error');
    const name = String(document.getElementById('yarbi-instruction-name-input')?.value || '').trim() || (typeof gfcOwnerInstructionName === 'function' ? gfcOwnerInstructionName(instruction) : 'Instrucción');
    const editId = String(document.getElementById('yarbi-instruction-id-input')?.value || '');
    const current = typeof gfcOwnerInstructionVisibleList === 'function' ? gfcOwnerInstructionVisibleList() : [];
    const existing = current.find(item => String(item.id || item.instruction) === editId);
    const record = { id:existing?.id || ('instr_' + Date.now()), name, instruction, scope:'all', active:true, updatedAt:Date.now() };
    if (typeof gfcOwnerInstructionSetCachedList === 'function') gfcOwnerInstructionSetCachedList([record, ...current.filter(item => item.id !== record.id && item.instruction !== record.instruction)]);
    if (typeof gfcOwnerInstructionClearSettingsForm === 'function') gfcOwnerInstructionClearSettingsForm();
    refreshInstructionPage();
    if (typeof toast === 'function') toast('Instrucción guardada localmente. Sincronizando…', 'info');
    if (typeof gfcOwnerInstructionSync === 'function') gfcOwnerInstructionSync(record).then(() => {
      if (typeof toast === 'function') toast('Instrucción sincronizada con Supabase ✓', 'success');
      refreshInstructionPage();
    }).catch(() => {
      if (typeof gfcOwnerInstructionQueue === 'function') gfcOwnerInstructionQueue(record);
      if (typeof toast === 'function') toast('Guardada localmente; Yarbi reintentará Supabase.', 'warning');
    });
  };
  window.gfcOwnerInstructionToggle = async function(index) {
    const list = typeof gfcOwnerInstructionVisibleList === 'function' ? gfcOwnerInstructionVisibleList() : [];
    const item = list[index]; if (!item) return;
    const nextActive = item.active === false;
    if (typeof gfcOwnerInstructionSetCachedList === 'function') gfcOwnerInstructionSetCachedList(list.map((value,i) => i === index ? { ...value, active:nextActive } : value));
    refreshInstructionPage();
    try {
      if (typeof gfcOwnerInstructionSync === 'function') await gfcOwnerInstructionSync({ ...item, operation:'set_active', active:nextActive });
      if (typeof toast === 'function') toast(nextActive ? 'Instrucción activada ✓' : 'Instrucción pausada ✓', 'success');
    } catch (_) {
      if (typeof gfcOwnerInstructionQueue === 'function') gfcOwnerInstructionQueue({ ...item, operation:'set_active', active:nextActive });
      if (typeof toast === 'function') toast('Cambio local; se sincronizará al recuperar conexión.', 'warning');
    }
  };
  window.gfcOwnerInstructionRemove = async function(index) {
    const list = typeof gfcOwnerInstructionVisibleList === 'function' ? gfcOwnerInstructionVisibleList() : [];
    const item = list[index]; if (!item) return;
    if (!confirm('Se eliminará esta instrucción de todos tus dispositivos. ¿Continuar?')) return;
    if (typeof gfcOwnerInstructionSetCachedList === 'function') gfcOwnerInstructionSetCachedList(list.filter((_,i) => i !== index));
    refreshInstructionPage();
    try {
      if (typeof gfcOwnerInstructionSync === 'function') await gfcOwnerInstructionSync({ ...item, operation:'delete' });
      if (typeof toast === 'function') toast('Instrucción eliminada de Supabase ✓', 'success');
    } catch (_) {
      if (typeof gfcOwnerInstructionQueue === 'function') gfcOwnerInstructionQueue({ ...item, operation:'delete' });
      if (typeof toast === 'function') toast('Eliminada localmente; queda pendiente sincronizar.', 'warning');
    }
  };

  function installPlainYarbiButton() {
    const old = document.getElementById('micFab');
    if (!old || old.dataset.yarbiPlain === '1') return;
    const button = old.cloneNode(false);
    button.id = 'micFab';
    button.dataset.yarbiPlain = '1';
    button.className = '';
    button.removeAttribute('style');
    button.innerHTML = '<span class="gfc-mic-symbol" aria-hidden="true">🤖</span><div class="status-dot"></div>';
    button.setAttribute('aria-label','Abrir Yarbi');
    button.setAttribute('title','Abrir Yarbi');
    button.addEventListener('click', event => { event.preventDefault(); window.gfcOpenCopilotModal('chat'); });
    old.replaceWith(button);
    localStorage.removeItem('fnz_yarbi_overlay_active');
    localStorage.removeItem('fnz_yarbi_overlay_permission_pending');
  }
  window._gfcMascot = {
    init:installPlainYarbiButton,
    setState:function(){},
    syncDialogueMessage:function(){},
    proposeVisita:function(){}
  };
  [0, 700, 1700].forEach(delay => setTimeout(installPlainYarbiButton, delay));

  window.addEventListener('online', () => { void flushTimelineOutbox().catch(() => {}); });
  setTimeout(() => { void flushTimelineOutbox().catch(() => {}); }, 1800);
})();
