const assert = require('node:assert/strict');
const test = require('node:test');
const { webcrypto } = require('node:crypto');

const saved = {
  indexedDB:global.indexedDB, crypto:global.crypto, fetch:global.fetch,
  gfcAccountFreshAccessToken:global.gfcAccountFreshAccessToken,
  gfcRuntimeApiOrigin:global.gfcRuntimeApiOrigin
};
const rows = new Map();
const database = {
  objectStoreNames:{ contains:name => name === 'assets' },
  transaction() {
    let pending = 0; let finished = false;
    const tx = {
      oncomplete:null, onerror:null, onabort:null,
      objectStore() {
        const request = operation => {
          const result = { onsuccess:null, onerror:null, result:undefined, error:null };
          pending += 1;
          queueMicrotask(() => {
            try { result.result = operation(); result.onsuccess?.(); }
            catch (error) { result.error = error; result.onerror?.(); tx.onerror?.(); }
            finally {
              pending -= 1;
              if (!pending && !finished) { finished = true; queueMicrotask(() => tx.oncomplete?.()); }
            }
          });
          return result;
        };
        return {
          getAll:() => request(() => [...rows.values()].map(item => structuredClone(item))),
          get:id => request(() => structuredClone(rows.get(id))),
          put:item => request(() => { rows.set(item.id, structuredClone(item)); return item.id; }),
          delete:id => request(() => rows.delete(id))
        };
      }
    };
    return tx;
  }
};
global.indexedDB = {
  open() {
    const request = { result:database, onsuccess:null, onupgradeneeded:null, onerror:null };
    queueMicrotask(() => request.onsuccess?.());
    return request;
  }
};
global.crypto = webcrypto;
const api = require('../frontend/yarbi-multimodal-tutor.js');

test('una fuente extraída se revisa y aprueba sin Gemini ni embeddings', async () => {
  let networkCalls = 0;
  global.gfcAccountFreshAccessToken = async () => '';
  global.fetch = async () => { networkCalls += 1; throw new Error('network forbidden'); };
  const text = 'Numeral 8.4\n\nUna misma llave de corte podrá controlar dos aparatos bajo condiciones verificables.';
  const file = { name:'NTP sintetica.txt', type:'text/plain', size:Buffer.byteLength(text), arrayBuffer:async () => Buffer.from(text) };
  const [asset] = await api.importFiles([file]);
  assert.equal(asset.status, 'local_ready');
  const result = await api.analyze(asset.id);
  assert.equal(result.local, true);
  assert.equal((await api.list())[0].status, 'analyzed_draft');
  assert.equal(await api.approve(asset.id), true);
  assert.equal((await api.list())[0].status, 'approved');
  assert.equal(networkCalls, 0);
});

test('una norma aprobada con índice parcial entrega al modelo el fragmento donde está la regla', async () => {
  rows.clear();
  const exact = 'Una misma llave de corte podrá controlar dos aparatos bajo estas condiciones.';
  rows.set('correct', {
    id:'correct', title:'111.011.pdf', kind:'pdf', status:'approved', learningEnabled:true,
    sha256:'a'.repeat(64), bytes:21.7 * 1024 * 1024,
    semanticIndex:{ status:'partial', indexedSections:1, totalSections:2 },
    sections:[{ id:'p8-1', label:'Numeral 8.4 · Página 8', text:'Material introductorio. '.repeat(65) + exact }]
  });
  rows.set('wrong', {
    id:'wrong', title:'EM_040_INSTALACIONES_DE_GAS.pdf', kind:'pdf', status:'approved', learningEnabled:true,
    sha256:'b'.repeat(64), analysis:{ text:'Resumen general sobre válvulas y dos artefactos.' },
    sections:[{ id:'p1', label:'Página 1', text:'Disposiciones generales de ventilación y edificios.' }]
  });
  const query = '¿Puedo usar una sola válvula para dos artefactos?';
  const evidence = api.searchApproved([...rows.values()], query);
  assert.equal(evidence[0].assetId, 'correct');
  assert.match(evidence[0].excerpt, /Una misma llave de corte podrá controlar dos aparatos/);
  assert.equal(api.rankApprovedSources([...rows.values()], query)[0].asset.id, 'correct');
  let calls = 0;
  global.gfcAccountFreshAccessToken = async () => 'synthetic-token';
  global.gfcRuntimeApiOrigin = () => 'https://synthetic.invalid';
  global.fetch = async (_url, options) => {
    calls += 1;
    assert.match(options.body, /Una misma llave de corte podrá controlar dos aparatos/);
    assert.doesNotMatch(options.body, /Disposiciones generales de ventilación/);
    const answer = JSON.stringify({ selected_asset_id:'correct', found:true, answer:'La norma contempla una llave común bajo condiciones.', exact_quote:exact, reference:'Numeral 8.4 · Página 8', plain_explanation:'Debe verificarse cada condición de la regla.', caveat:'' });
    return { ok:true, json:async () => ({ candidates:[{ content:{ parts:[{ text:answer }] } }] }) };
  };
  const result = await api.answerFromChat(query);
  assert.equal(result.handled, true);
  assert.match(result.reply, /La norma contempla una llave común/);
  assert.match(result.reply, /111\.011\.pdf/);
  assert.equal(calls, 1);
});

test('un no encontrado antiguo no bloquea una búsqueda nueva en el chat único', async () => {
  rows.delete('wrong');
  const question = '¿Puedo usar una sola válvula para dos artefactos?';
  const asset = rows.get('correct');
  asset.queryCache = [{
    key:'library-v4|' + api.normalize(question).slice(0, 1200),
    result:{ ok:true, found:false, caveat:'Resultado anterior sin cita' }
  }];
  rows.set('correct', asset);
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    const answer = JSON.stringify({ found:true, answer:'Hay una regla aplicable bajo condiciones.', exact_quote:'Una misma llave de corte podrá controlar dos aparatos bajo estas condiciones.', reference:'Numeral 8.4 · Página 8', plain_explanation:'Verifica las condiciones del numeral.', caveat:'' });
    return { ok:true, json:async () => ({ candidates:[{ content:{ parts:[{ text:answer }] } }] }) };
  };
  const first = await api.answerFromChat(question);
  assert.match(first.reply, /Hay una regla aplicable/);
  assert.equal(calls, 1);
  const second = await api.answerFromChat(question);
  assert.match(second.reply, /Hay una regla aplicable/);
  assert.equal(calls, 1, 'la respuesta positiva verificada sí se reutiliza');

  const library = api.html();
  assert.match(library, /Ir al chat de Yarbi/);
  assert.doesNotMatch(library, /gfc-mm-tutor-question|gfc-mm-tutor-answer|Preguntar al Tutor/);
  assert.equal(api.askTutorFromUi, undefined);
});

test.after(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete global[key]; else global[key] = value;
  }
});
