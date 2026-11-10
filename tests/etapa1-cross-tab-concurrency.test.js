const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const storeSource = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'yarbi-conversation-store.js'), 'utf8');

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

class FakeTransaction {
  constructor(db, names) { this.db = db; this.names = Array.isArray(names) ? names : [names]; this.pending = 0; this.completed = false; this.oncomplete = null; this.onerror = null; this.onabort = null; }
  objectStore(name) {
    assert.ok(this.names.includes(name), `store ${name} no pertenece a la transacción`);
    const map = this.db.stores.get(name);
    const request = operation => {
      const result = { onsuccess:null, onerror:null, result:undefined, error:null };
      this.pending += 1;
      queueMicrotask(() => {
        try { result.result = operation(); result.onsuccess?.({ target:result }); }
        catch (error) { result.error = error; result.onerror?.({ target:result }); this.onerror?.(); }
        finally { this.pending -= 1; this.finishWhenIdle(); }
      });
      return result;
    };
    return {
      get:key => request(() => clone(map.get(key))),
      getAll:() => request(() => [...map.values()].map(clone)),
      count:() => request(() => map.size),
      put:value => request(() => { map.set(value.id || value.key, clone(value)); return value.id || value.key; }),
      delete:key => request(() => map.delete(key))
    };
  }
  finishWhenIdle() {
    if (this.pending || this.completed) return;
    this.completed = true;
    queueMicrotask(() => this.oncomplete?.());
  }
}

class FakeDb {
  constructor() {
    this.stores = new Map();
    this.objectStoreNames = { contains:name => this.stores.has(name) };
  }
  createObjectStore(name) { this.stores.set(name, new Map()); return {}; }
  transaction(names) { return new FakeTransaction(this, names); }
}

function createSharedBrowser() {
  const database = new FakeDb();
  const values = new Map();
  const channels = new Map();
  let lockTail = Promise.resolve();
  return {
    indexedDB:{
      open() {
        const request = { onupgradeneeded:null, onsuccess:null, onerror:null, onblocked:null, result:database, error:null };
        queueMicrotask(() => {
          if (!database.stores.size) request.onupgradeneeded?.({ target:request });
          request.onsuccess?.({ target:request });
        });
        return request;
      }
    },
    locks:{ request(_name, _options, callback) { const next = lockTail.then(callback); lockTail = next.catch(() => {}); return next; } },
    localStorage:{ getItem:key => values.has(key) ? values.get(key) : null, setItem:(key, value) => values.set(key, String(value)) },
    Channel:class {
      constructor(name) { this.name = name; this.onmessage = null; if (!channels.has(name)) channels.set(name, new Set()); channels.get(name).add(this); }
      postMessage(data) { channels.get(this.name).forEach(peer => { if (peer !== this) queueMicrotask(() => peer.onmessage?.({ data:clone(data) })); }); }
      close() { channels.get(this.name)?.delete(this); }
    }
  };
}

function createTab(shared) {
  const window = { indexedDB:shared.indexedDB, navigator:{ locks:shared.locks }, addEventListener() {} };
  new Function('window', 'localStorage', 'BroadcastChannel', storeSource)(window, shared.localStorage, shared.Channel);
  return window.YarbiConversationStore;
}

const message = (id, text = 'mensaje sintético') => ({ id, role:'assistant', text, at:1794355200000, channel:'voice' });

test('1.2B: migra timeline y outbox conservando las claves legacy sin borrarlas', async () => {
  const shared = createSharedBrowser();
  shared.localStorage.setItem('legacy-timeline', JSON.stringify([message('legacy-1')]));
  shared.localStorage.setItem('legacy-outbox', JSON.stringify([{ id:'legacy-1', messageId:'legacy-1', item:message('legacy-1'), state:'retry', attempts:2, operationId:'op-legacy-1', createdAt:1794355200000, updatedAt:1794355200500, lastErrorCode:'network_unavailable' }]));
  const store = createTab(shared);
  assert.deepEqual(await store.initialize({ timelineKey:'legacy-timeline', outboxKey:'legacy-outbox' }), { ok:true, initialized:true, migrated:true });
  assert.equal((await store.listTimeline()).length, 1);
  const outbox = await store.listOutbox();
  assert.equal(outbox.length, 1);
  assert.deepEqual({ state:outbox[0].state, attempts:outbox[0].attempts, operationId:outbox[0].operationId, lastErrorCode:outbox[0].lastErrorCode }, { state:'retry', attempts:2, operationId:'op-legacy-1', lastErrorCode:'network_unavailable' });
  assert.match(shared.localStorage.getItem('legacy-timeline'), /legacy-1/);
  assert.match(shared.localStorage.getItem('legacy-outbox'), /legacy-1/);
  assert.equal((await store.initialize({ timelineKey:'legacy-timeline', outboxKey:'legacy-outbox' })).initialized, false);
});

test('1.2B: dos pestañas concurrentes conservan una sola fila y un solo outbox', async () => {
  const shared = createSharedBrowser();
  const first = createTab(shared);
  const second = createTab(shared);
  await Promise.all([first.initialize({}), second.initialize({})]);
  const [left, right] = await Promise.all([first.persist(message('same-id')), second.persist(message('same-id'))]);
  assert.deepEqual([left.code, right.code].sort(), ['idempotent', 'persisted']);
  assert.equal((await first.listTimeline()).length, 1);
  assert.equal((await second.listOutbox()).length, 1);
});

test('1.2B: una colisión de identidad conserva el primer mensaje inmutable', async () => {
  const shared = createSharedBrowser();
  const store = createTab(shared);
  await store.initialize({});
  assert.equal((await store.persist(message('immutable-id', 'original'))).code, 'persisted');
  assert.equal((await store.persist(message('immutable-id', 'alterado'))).code, 'identity_conflict');
  assert.equal((await store.listTimeline())[0].text, 'original');
});

test('1.2B: BroadcastChannel notifica cambios sin transportar texto del mensaje', async () => {
  const shared = createSharedBrowser();
  const writer = createTab(shared);
  const reader = createTab(shared);
  await Promise.all([writer.initialize({}), reader.initialize({})]);
  let received = null;
  reader.subscribe(change => { received = change; });
  await writer.persist(message('signal-id', 'texto que nunca debe viajar por señal'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(received?.type, 'timeline_committed');
  assert.equal(JSON.stringify(received).includes('texto que nunca debe viajar por señal'), false);
});

test('1.2B: IndexedDB ausente falla cerrado y conserva los datos legacy', async () => {
  const source = { getItem:key => key === 'legacy' ? JSON.stringify([message('legacy-safe')]) : null, setItem() { throw new Error('no debe escribir'); } };
  const window = { addEventListener() {} };
  new Function('window', 'localStorage', 'BroadcastChannel', storeSource)(window, source, undefined);
  await assert.rejects(() => window.YarbiConversationStore.initialize({ timelineKey:'legacy' }), error => error.code === 'storage_unavailable');
  assert.match(source.getItem('legacy'), /legacy-safe/);
});

test('1.2B: una migración legacy conflictiva no marca completada ni borra el origen', async () => {
  const shared = createSharedBrowser();
  shared.localStorage.setItem('legacy-conflict', JSON.stringify([message('duplicate', 'uno'), message('duplicate', 'dos')]));
  const store = createTab(shared);
  assert.deepEqual(await store.initialize({ timelineKey:'legacy-conflict' }), { ok:false, code:'migration_conflict', id:'duplicate' });
  assert.match(shared.localStorage.getItem('legacy-conflict'), /"uno"/);
  assert.match(shared.localStorage.getItem('legacy-conflict'), /"dos"/);
});
