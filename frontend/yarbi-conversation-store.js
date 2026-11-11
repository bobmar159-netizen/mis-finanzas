(function () {
  'use strict';

  const DB_NAME = 'gfc_yarbi_conversation_v2';
  const DB_VERSION = 2;
  const TIMELINE = 'timeline';
  const OUTBOX = 'outbox';
  const META = 'metadata';
  const CONVERSATIONS = 'conversations';
  const DEFAULT_CONVERSATION_ID = 'default';
  const MIGRATION_KEY = 'migration';
  const SIGNAL_KEY = 'gfc_yarbi_conversation_change_v2';
  const CHANNEL_NAME = 'gfc_yarbi_conversation_v2';
  const WRITE_LOCK_NAME = 'gfc_yarbi_conversation_write_v2';
  let dbPromise = null;
  let initialized = false;
  let channel = null;
  const listeners = new Set();

  function normalizeConversationId(value) {
    const id = typeof value === 'string' ? value.trim() : '';
    return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(id) ? id : DEFAULT_CONVERSATION_ID;
  }
  function immutableMatch(left, right) {
    const normalizedLeft = normalize(left);
    const normalizedRight = normalize(right);
    return !!normalizedLeft && !!normalizedRight && normalizedLeft.id === normalizedRight.id && normalizedLeft.role === normalizedRight.role
      && normalizedLeft.text === normalizedRight.text && normalizedLeft.channel === normalizedRight.channel
      && normalizedLeft.conversation_id === normalizedRight.conversation_id;
  }
  function normalize(value) {
    const role = value && (value.role === 'user' ? 'user' : (value.role === 'assistant' || value.role === 'model' ? 'assistant' : ''));
    const text = String(value?.text || value?.parts?.[0]?.text || '').trim();
    const id = typeof value?.id === 'string' ? value.id.trim() : '';
    if (!role || !text || !id) return null;
    const at = Number(value.at || value.message_at || Date.now());
    return {
      id,
      role,
      text:text.slice(0, 8000),
      at:Number.isFinite(at) ? at : Date.now(),
      channel:String(value.channel || 'chat').slice(0, 30),
      // Las filas v1 no tenían conversación. Se conservan de forma explícita
      // dentro de la conversación heredada, sin perder ni reescribir texto.
      conversation_id:normalizeConversationId(value.conversation_id || value.conversationId)
    };
  }
  function cleanTitle(value, fallback) {
    const title = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    return title || fallback || 'Nueva conversación';
  }
  function titleForMessage(item) {
    return item?.role === 'user' ? cleanTitle(item.text, 'Nueva conversación') : 'Nueva conversación';
  }
  function normalizeConversation(value) {
    const id = normalizeConversationId(value?.id || value?.conversation_id);
    const createdAt = Number(value?.createdAt || value?.created_at || Date.now());
    const updatedAt = Number(value?.updatedAt || value?.updated_at || createdAt);
    return {
      id,
      title:cleanTitle(value?.title, id === DEFAULT_CONVERSATION_ID ? 'Conversación anterior' : 'Nueva conversación'),
      createdAt:Number.isFinite(createdAt) ? createdAt : Date.now(),
      updatedAt:Number.isFinite(updatedAt) ? updatedAt : Date.now()
    };
  }
  function conversationForMessage(item, existing) {
    const now = Date.now();
    const base = existing ? normalizeConversation(existing) : normalizeConversation({
      id:item.conversation_id,
      title:item.conversation_id === DEFAULT_CONVERSATION_ID ? 'Conversación anterior' : titleForMessage(item),
      createdAt:item.at || now,
      updatedAt:item.at || now
    });
    const title = (base.title === 'Nueva conversación' && item.role === 'user') ? titleForMessage(item) : base.title;
    return { ...base, title, updatedAt:Math.max(base.updatedAt, Number(item.at) || now) };
  }
  function requestValue(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('indexeddb_request_failed'));
    });
  }
  function transactionResult(tx, result) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(result());
      tx.onerror = () => reject(tx.error || new Error('indexeddb_transaction_failed'));
      tx.onabort = () => reject(tx.error || new Error('indexeddb_transaction_aborted'));
    });
  }
  async function withWriteLock(task) {
    const locks = window.navigator && window.navigator.locks;
    if (!locks || typeof locks.request !== 'function') return task();
    return locks.request(WRITE_LOCK_NAME, { mode:'exclusive' }, task);
  }
  function open() {
    if (dbPromise) return dbPromise;
    if (!window.indexedDB) return Promise.reject(Object.assign(new Error('indexeddb_unavailable'), { code:'storage_unavailable' }));
    dbPromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(TIMELINE)) db.createObjectStore(TIMELINE, { keyPath:'id' });
        if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath:'id' });
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath:'key' });
        if (!db.objectStoreNames.contains(CONVERSATIONS)) db.createObjectStore(CONVERSATIONS, { keyPath:'id' });
      };
      request.onblocked = () => reject(Object.assign(new Error('indexeddb_upgrade_blocked'), { code:'storage_blocked' }));
      request.onerror = () => reject(request.error || new Error('indexeddb_open_failed'));
      request.onsuccess = () => resolve(request.result);
    });
    return dbPromise;
  }
  function readLegacy(key) {
    try { const parsed = JSON.parse(localStorage.getItem(key) || 'null'); return Array.isArray(parsed) ? parsed : []; }
    catch (_) { return []; }
  }
  function normalizeOutbox(value) {
    const item = normalize(value?.item || value);
    if (!item) return null;
    const attempts = Number(value?.attempts);
    return {
      id:item.id,
      messageId:typeof value?.messageId === 'string' && value.messageId ? value.messageId : item.id,
      item,
      state:typeof value?.state === 'string' && value.state ? value.state.slice(0, 40) : 'pending',
      attempts:Number.isFinite(attempts) && attempts >= 0 ? Math.floor(attempts) : 0,
      operationId:typeof value?.operationId === 'string' && value.operationId ? value.operationId.slice(0, 180) : 'timeline:' + item.id,
      createdAt:Number.isFinite(Number(value?.createdAt)) ? Number(value.createdAt) : item.at,
      updatedAt:Number.isFinite(Number(value?.updatedAt)) ? Number(value.updatedAt) : Date.now(),
      lastErrorCode:typeof value?.lastErrorCode === 'string' ? value.lastErrorCode.slice(0, 80) : undefined
    };
  }
  function migrationSnapshot(timelineKey, outboxKey) {
    const timeline = readLegacy(timelineKey).map(normalize).filter(Boolean);
    const outbox = readLegacy(outboxKey).map(normalizeOutbox).filter(Boolean);
    const byId = new Map();
    for (const item of timeline) {
      const current = byId.get(item.id);
      if (current && !immutableMatch(current, item)) return { ok:false, code:'migration_conflict', id:item.id };
      byId.set(item.id, item);
    }
    for (const entry of outbox) {
      const current = byId.get(entry.item.id);
      if (current && !immutableMatch(current, entry.item)) return { ok:false, code:'migration_conflict', id:entry.item.id };
      byId.set(entry.item.id, entry.item);
    }
    return { ok:true, timeline:[...byId.values()], outbox };
  }
  function migrate(db, timelineKey, outboxKey) {
    const snapshot = migrationSnapshot(timelineKey, outboxKey);
    if (!snapshot.ok) return Promise.resolve(snapshot);
    return new Promise((resolve, reject) => {
      const tx = db.transaction([TIMELINE, OUTBOX, META, CONVERSATIONS], 'readwrite');
      const meta = tx.objectStore(META);
      let result = null;
      const migration = meta.get(MIGRATION_KEY);
      migration.onsuccess = () => {
        if (migration.result?.completed === true) { result = { ok:true, migrated:false, metadata:migration.result }; return; }
        const timeline = tx.objectStore(TIMELINE);
        const outbox = tx.objectStore(OUTBOX);
        const conversations = tx.objectStore(CONVERSATIONS);
        snapshot.timeline.forEach(item => timeline.put(item));
        snapshot.outbox.forEach(entry => outbox.put(entry));
        if (snapshot.timeline.length || snapshot.outbox.length) {
          conversations.put(normalizeConversation({ id:DEFAULT_CONVERSATION_ID, title:'Conversación anterior', createdAt:Math.min(...snapshot.timeline.map(item => item.at), Date.now()), updatedAt:Math.max(...snapshot.timeline.map(item => item.at), Date.now()) }));
        }
        const record = { key:MIGRATION_KEY, schemaVersion:DB_VERSION, sourceVersion:'localStorage-v1', state:'pending_verification', at:Date.now(), timelineImported:snapshot.timeline.length, outboxImported:snapshot.outbox.length, verified:false };
        meta.put(record);
        result = { ok:true, migrated:true, record };
      };
      tx.oncomplete = () => {
        if (!result?.ok || !result.migrated) return resolve(result || { ok:false, code:'migration_unknown' });
        const verify = db.transaction([TIMELINE, OUTBOX, META], 'readwrite');
        const timelineCount = verify.objectStore(TIMELINE).count();
        const outboxCount = verify.objectStore(OUTBOX).count();
        const verifyMeta = verify.objectStore(META);
        let timelineImported = null;
        let outboxImported = null;
        const completeVerification = () => {
          if (timelineImported === null || outboxImported === null) return;
          if (timelineImported < result.record.timelineImported || outboxImported < result.record.outboxImported) { verify.abort(); return; }
          verifyMeta.put({ ...result.record, state:'completed', completed:true, verified:true, verifiedAt:Date.now(), timelineVerified:timelineImported, outboxVerified:outboxImported });
        };
        timelineCount.onsuccess = () => { timelineImported = timelineCount.result; completeVerification(); };
        outboxCount.onsuccess = () => { outboxImported = outboxCount.result; completeVerification(); };
        transactionResult(verify, () => ({ ok:true, migrated:true })).then(resolve, reject);
      };
      tx.onerror = () => reject(tx.error || new Error('migration_transaction_failed'));
      tx.onabort = () => reject(tx.error || new Error('migration_transaction_aborted'));
    });
  }
  function emit(change) { listeners.forEach(listener => { try { listener(change); } catch (_) {} }); }
  function notify(change) {
    const safe = { type:change?.type || 'changed', revision:Date.now() };
    try { channel?.postMessage(safe); } catch (_) {}
    try { localStorage.setItem(SIGNAL_KEY, JSON.stringify(safe)); } catch (_) {}
    emit(safe);
  }
  function installSignals() {
    if (channel || typeof BroadcastChannel === 'undefined') {
      // storage remains useful even when BroadcastChannel is unsupported.
    } else {
      try { channel = new BroadcastChannel(CHANNEL_NAME); channel.onmessage = event => emit(event.data || { type:'changed' }); } catch (_) { channel = null; }
    }
    window.addEventListener('storage', event => { if (event.key === SIGNAL_KEY && event.newValue) emit({ type:'changed', source:'storage' }); });
  }
  async function initialize(options) {
    if (initialized) return { ok:true, initialized:false };
    const db = await open();
    const migrated = await withWriteLock(() => migrate(db, options?.timelineKey || '', options?.outboxKey || ''));
    if (!migrated?.ok) return migrated;
    initialized = true;
    installSignals();
    return { ok:true, initialized:true, migrated:!!migrated.migrated };
  }
  async function listTimeline(options) {
    const requested = typeof options === 'string' ? options : options?.conversationId;
    const conversationId = requested ? normalizeConversationId(requested) : null;
    const db = await open();
    const tx = db.transaction(TIMELINE, 'readonly');
    const completed = transactionResult(tx, () => null);
    const rows = await requestValue(tx.objectStore(TIMELINE).getAll());
    await completed;
    return rows.map(normalize).filter(Boolean).filter(item => !conversationId || item.conversation_id === conversationId).sort((a,b) => a.at - b.at);
  }
  async function listConversations() {
    const db = await open();
    const tx = db.transaction([CONVERSATIONS, TIMELINE], 'readonly');
    const completed = transactionResult(tx, () => null);
    const [stored, timeline] = await Promise.all([
      requestValue(tx.objectStore(CONVERSATIONS).getAll()),
      requestValue(tx.objectStore(TIMELINE).getAll())
    ]);
    await completed;
    const messages = timeline.map(normalize).filter(Boolean);
    const byId = new Map(stored.map(normalizeConversation).map(item => [item.id, item]));
    messages.forEach(item => byId.set(item.conversation_id, conversationForMessage(item, byId.get(item.conversation_id))));
    return [...byId.values()].map(conversation => {
      const own = messages.filter(item => item.conversation_id === conversation.id);
      return { ...conversation, messageCount:own.length, lastMessageAt:own.length ? own[own.length - 1].at : conversation.updatedAt };
    }).sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id));
  }
  async function searchConversations(query) {
    const needle = String(query || '').trim().toLocaleLowerCase('es-PE').slice(0, 120);
    const conversations = await listConversations();
    if (!needle) return conversations;
    const timeline = await listTimeline();
    const matchingIds = new Set(timeline.filter(item => item.text.toLocaleLowerCase('es-PE').includes(needle)).map(item => item.conversation_id));
    return conversations.filter(item => matchingIds.has(item.id) || item.title.toLocaleLowerCase('es-PE').includes(needle));
  }
  async function createConversation(value) {
    const candidate = value && typeof value === 'object' ? value : {};
    const id = normalizeConversationId(candidate.id);
    if (id === DEFAULT_CONVERSATION_ID && candidate.id && String(candidate.id).trim() !== DEFAULT_CONVERSATION_ID) return { ok:false, code:'conversation_identity_invalid' };
    const normalized = normalizeConversation({ ...candidate, id, createdAt:Date.now(), updatedAt:Date.now() });
    return withWriteLock(async () => {
      const db = await open();
      const tx = db.transaction(CONVERSATIONS, 'readwrite');
      const store = tx.objectStore(CONVERSATIONS);
      const existing = await requestValue(store.get(normalized.id));
      if (existing) return { ok:true, code:'idempotent', conversation:normalizeConversation(existing) };
      store.put(normalized);
      await transactionResult(tx, () => null);
      notify({ type:'conversation_created' });
      return { ok:true, code:'created', conversation:normalized };
    });
  }
  async function renameConversation(conversationId, title) {
    const id = normalizeConversationId(conversationId);
    const safeTitle = cleanTitle(title, '');
    if (!safeTitle || safeTitle === 'Nueva conversación' && !String(title || '').trim()) return { ok:false, code:'conversation_title_invalid' };
    return withWriteLock(async () => {
      const db = await open();
      const tx = db.transaction(CONVERSATIONS, 'readwrite');
      const store = tx.objectStore(CONVERSATIONS);
      const existing = await requestValue(store.get(id));
      if (!existing) return { ok:false, code:'conversation_not_found' };
      const conversation = { ...normalizeConversation(existing), title:safeTitle, updatedAt:Date.now() };
      store.put(conversation);
      await transactionResult(tx, () => null);
      notify({ type:'conversation_renamed' });
      return { ok:true, conversation };
    });
  }
  async function deleteConversation(conversationId) {
    const id = normalizeConversationId(conversationId);
    return withWriteLock(async () => {
      const db = await open();
      const result = await new Promise((resolve, reject) => {
        const tx = db.transaction([CONVERSATIONS, TIMELINE, OUTBOX], 'readwrite');
        const conversations = tx.objectStore(CONVERSATIONS);
        const timeline = tx.objectStore(TIMELINE);
        const outbox = tx.objectStore(OUTBOX);
        let rows = null;
        let queued = null;
        let outcome = { ok:false, code:'conversation_delete_unknown' };
        const removeMatches = () => {
          if (!rows || !queued) return;
          const messages = rows.map(normalize).filter(Boolean).filter(item => item.conversation_id === id);
          messages.forEach(item => timeline.delete(item.id));
          queued.filter(item => normalize(item?.item)?.conversation_id === id).forEach(item => outbox.delete(item.id));
          conversations.delete(id);
          outcome = { ok:true, deletedMessages:messages.length, deletedOutbox:queued.filter(item => normalize(item?.item)?.conversation_id === id).length };
        };
        timeline.getAll().onsuccess = event => { rows = event.target.result || []; removeMatches(); };
        outbox.getAll().onsuccess = event => { queued = event.target.result || []; removeMatches(); };
        tx.oncomplete = () => resolve(outcome);
        tx.onerror = () => reject(tx.error || new Error('indexeddb_delete_failed'));
        tx.onabort = () => reject(tx.error || new Error('indexeddb_delete_aborted'));
      });
      if (result.ok) notify({ type:'conversation_deleted' });
      return result;
    });
  }
  async function listOutbox() {
    const db = await open();
    const tx = db.transaction(OUTBOX, 'readonly');
    const completed = transactionResult(tx, () => null);
    const rows = await requestValue(tx.objectStore(OUTBOX).getAll());
    await completed;
    return rows.filter(row => row && row.id);
  }
  async function persistUnlocked(item) {
    const normalized = normalize(item);
    if (!normalized) return { ok:false, code:'content_invalid' };
    const db = await open();
    const result = await new Promise((resolve, reject) => {
      const tx = db.transaction([TIMELINE, OUTBOX, CONVERSATIONS], 'readwrite');
      const timeline = tx.objectStore(TIMELINE);
      const outbox = tx.objectStore(OUTBOX);
      const conversations = tx.objectStore(CONVERSATIONS);
      let outcome = { ok:false, code:'transaction_unknown' };
      timeline.get(normalized.id).onsuccess = event => {
        const existing = event.target.result;
        if (existing) {
          if (immutableMatch(existing, normalized)) { outcome = { ok:true, code:'idempotent', item:existing }; return; }
          outcome = { ok:false, code:'identity_conflict', item:existing }; return;
        }
        conversations.get(normalized.conversation_id).onsuccess = conversationEvent => {
          conversations.put(conversationForMessage(normalized, conversationEvent.target.result));
          timeline.put(normalized);
          outbox.get(normalized.id).onsuccess = outboxEvent => {
            const prior = outboxEvent.target.result;
            // El endpoint remoto de timeline es anterior a las conversaciones
            // separadas. Solo la conversación heredada puede entrar a su outbox;
            // las nuevas quedan íntegras y locales hasta que exista una API
            // remota que preserve conversation_id.
            if (!prior && normalized.conversation_id === DEFAULT_CONVERSATION_ID) outbox.put({ id:normalized.id, messageId:normalized.id, item:normalized, state:'pending', attempts:0, operationId:'timeline:' + normalized.id, updatedAt:Date.now() });
            outcome = { ok:true, code:'persisted', item:normalized };
          };
        };
      };
      tx.oncomplete = () => resolve(outcome);
      tx.onerror = () => reject(tx.error || new Error('indexeddb_transaction_failed'));
      tx.onabort = () => reject(tx.error || new Error('indexeddb_transaction_aborted'));
    });
    if (result.ok && result.code === 'persisted') notify({ type:'timeline_committed' });
    return result;
  }
  async function persist(item) {
    return withWriteLock(() => persistUnlocked(item));
  }
  async function acknowledgeOutbox(ids) {
    const selected = Array.isArray(ids) ? ids.filter(Boolean) : [];
    if (!selected.length) return { ok:true, removed:0 };
    return withWriteLock(async () => {
      const db = await open();
      const tx = db.transaction(OUTBOX, 'readwrite');
      selected.forEach(id => tx.objectStore(OUTBOX).delete(id));
      await transactionResult(tx, () => null);
      notify({ type:'outbox_changed' });
      return { ok:true, removed:selected.length };
    });
  }
  async function mergeCloud(items) {
    const incoming = (Array.isArray(items) ? items : []).map(normalize).filter(Boolean);
    if (!incoming.length) return { ok:true, added:0, conflicts:0 };
    return withWriteLock(async () => {
    const db = await open();
    const result = await new Promise((resolve, reject) => {
      const tx = db.transaction([TIMELINE, CONVERSATIONS], 'readwrite');
      const store = tx.objectStore(TIMELINE);
      const conversations = tx.objectStore(CONVERSATIONS);
      let added = 0, conflicts = 0;
      let pending = incoming.length;
      incoming.forEach(item => {
        const get = store.get(item.id);
        get.onsuccess = () => {
          const existing = get.result;
          if (!existing) {
            conversations.get(item.conversation_id).onsuccess = conversationEvent => conversations.put(conversationForMessage(item, conversationEvent.target.result));
            store.put(item); added += 1;
          }
          else if (!immutableMatch(existing, item)) conflicts += 1;
          pending -= 1;
        };
      });
      tx.oncomplete = () => resolve({ ok:true, added, conflicts });
      tx.onerror = () => reject(tx.error || new Error('indexeddb_merge_failed'));
      tx.onabort = () => reject(tx.error || new Error('indexeddb_merge_aborted'));
    });
    if (result.added) notify({ type:'timeline_merged' });
    return result;
    });
  }
  window.YarbiConversationStore = Object.freeze({ initialize, persist, listTimeline, listConversations, searchConversations, createConversation, renameConversation, deleteConversation, listOutbox, acknowledgeOutbox, mergeCloud, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, immutableMatch, normalize, normalizeConversation, normalizeConversationId });
}());
