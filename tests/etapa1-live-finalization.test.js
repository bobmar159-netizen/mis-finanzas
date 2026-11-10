const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const renderer = require('../frontend/yarbi-conversation-renderer');

const memoryCenter = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'yarbi-memory-center.js'), 'utf8');

function extractFunction(source, marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `No se encontró ${marker}`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = brace; index < source.length; index += 1) {
    const current = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (current === '\\') escaped = true;
      else if (current === quote) quote = '';
      continue;
    }
    if (current === '\'' || current === '"' || current === '`') { quote = current; continue; }
    if (current === '{') depth += 1;
    if (current === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`No se pudo extraer ${marker}`);
}

function makeNode(tag) {
  const node = {
    tag,
    dataset: {},
    children: [],
    parentElement: null,
    className: '',
    textContent: '',
    _connected: false,
    classList: {
      add(...names) {
        const present = new Set(String(node.className || '').split(/\s+/).filter(Boolean));
        names.forEach(name => present.add(name));
        node.className = [...present].join(' ');
      },
      remove(...names) {
        const removed = new Set(names);
        node.className = String(node.className || '').split(/\s+/).filter(name => name && !removed.has(name)).join(' ');
      }
    },
    appendChild(child) {
      child.parentElement = node;
      child._connected = true;
      node.children.push(child);
      return child;
    },
    append(...nodes) { nodes.forEach(child => node.appendChild(child)); },
    remove() {
      if (node.parentElement) node.parentElement.children = node.parentElement.children.filter(child => child !== node);
      node.parentElement = null;
      node._connected = false;
    },
    removeAttribute(name) {
      if (name === 'data-live-draft-key') delete node.dataset.liveDraftKey;
    },
    querySelector(selector) {
      const match = /^\[data-message-id="(.+)"\]$/.exec(selector);
      if (!match) return null;
      const id = match[1];
      const visit = current => {
        for (const child of current.children) {
          if (child.dataset.messageId === id) return child;
          const nested = visit(child);
          if (nested) return nested;
        }
        return null;
      };
      return visit(node);
    }
  };
  Object.defineProperty(node, 'isConnected', {
    get() { return node._connected && (!node.parentElement || node.parentElement.isConnected); }
  });
  return node;
}

function createLiveHarness(mode = 'normal') {
  const normalBox = makeNode('section');
  normalBox._connected = true;
  normalBox.scrollHeight = 1000;
  normalBox.scrollTop = 850;
  normalBox.clientHeight = 100;
  const trainingBox = makeNode('section');
  trainingBox._connected = true;
  trainingBox.scrollHeight = 1000;
  trainingBox.scrollTop = 850;
  trainingBox.clientHeight = 100;
  const documentMock = {
    getElementById(id) {
      if (id === 'gfc-copilot-chat-messages') return normalBox;
      if (id === 'gfc-yarbi-training-chat') return trainingBox;
      return null;
    },
    createElement(tag) { return makeNode(tag); }
  };
  const persisted = [];
  const state = { failPersistence:false, failRenderer:false };
  const renders = [];
  const normalizeTimelineItem = item => {
    const text = String(item?.text || '').trim();
    const role = item?.role === 'user' ? 'user' : item?.role === 'assistant' ? 'assistant' : '';
    return text && role ? { id:String(item.id || `timeline-${persisted.length + 1}`), role, text, at:Number(item.at) || Date.now(), channel:item.channel || 'voice' } : null;
  };
  const persistTimelineMessage = (role, text, at, channel, id) => {
    if (state.failPersistence) return null;
    const item = normalizeTimelineItem({ id:id || `timeline-${persisted.length + 1}`, role, text, at, channel });
    if (id) {
      const existing = persisted.find(candidate => candidate.id === item.id);
      if (existing) return existing;
    } else {
      const last = persisted[persisted.length - 1];
      if (last && last.role === item.role && last.text === item.text && Math.abs(last.at - item.at) < 2500) return last;
    }
    if (item) persisted.push(item);
    return item;
  };
  const renderTimelineItem = item => {
    const validation = renderer.validateContent(item.text);
    if (state.failRenderer) return undefined;
    const element = documentMock.createElement('article');
    element.dataset.messageId = item.id;
    element.dataset.canonical = 'true';
    element.dataset.status = validation.status;
    normalBox.appendChild(element);
    renders.push({ item, validation, element });
    return { ok:validation.ok, element };
  };
  const parts = [
    'let renderedDay = \"\";',
    'const liveTranscriptDrafts = new Map();',
    'const finalizedLiveTranscriptKeys = new Map();',
    extractFunction(memoryCenter, 'function liveIdentityComponent('),
    extractFunction(memoryCenter, 'function liveIdentityValue('),
    extractFunction(memoryCenter, 'function liveIdentityOptions('),
    extractFunction(memoryCenter, 'function liveIdentityTuple('),
    extractFunction(memoryCenter, 'function liveTranscriptKey('),
    extractFunction(memoryCenter, 'function liveFinalizationKey('),
    extractFunction(memoryCenter, 'function liveTranscriptItemId('),
    extractFunction(memoryCenter, 'function chatIsNearBottom('),
    extractFunction(memoryCenter, 'function pruneFinalizedLiveKeys('),
    extractFunction(memoryCenter, 'function ensureLiveTranscriptDraft('),
    extractFunction(memoryCenter, 'window.gfcUpdateLiveTranscriptDraft = function'),
    extractFunction(memoryCenter, 'window.gfcFinalizeLiveTranscriptDraft = function'),
    extractFunction(memoryCenter, 'window.gfcDiscardLiveTranscriptDraft = function'),
    'return { begin:ensureLiveTranscriptDraft, update:window.gfcUpdateLiveTranscriptDraft, finalize:window.gfcFinalizeLiveTranscriptDraft, discard:window.gfcDiscardLiveTranscriptDraft, drafts:liveTranscriptDrafts, finalized:finalizedLiveTranscriptKeys, draftKey:liveTranscriptKey, finalKey:liveFinalizationKey, itemId:liveTranscriptItemId };'
  ];
  const build = new Function('window', 'document', 'interactionMode', 'dayKey', 'dayLabel', 'renderTimelineItem', 'normalizeTimelineItem', 'persistTimelineMessage', 'timeLabel', parts.join('\n'));
  const api = build({}, documentMock, () => mode, () => '2026-11-09', () => 'Hoy', renderTimelineItem, normalizeTimelineItem, persistTimelineMessage, () => 'ahora');
  return { api, normalBox, trainingBox, persisted, renders, state };
}

test('Etapa 1.1.2: Gemini Live muestra un borrador transitorio y finaliza una sola vez por el renderer canónico', () => {
  const harness = createLiveHarness();
  const draft = harness.api.begin('assistant', 'turn-1', 'Preparando respuesta…');
  assert.ok(draft?.wrap?.isConnected);
  assert.match(draft.wrap.className, /is-live/);
  assert.equal(harness.api.update('assistant', '<script>alert(1)</script>', 'turn-1'), true);
  assert.equal(harness.persisted.length, 0);
  assert.equal(harness.renders.length, 0);

  assert.equal(harness.api.finalize('assistant', '<script>alert(1)</script>', 'turn-1', { channel:'voice' }), true);
  assert.equal(draft.wrap.isConnected, false);
  assert.equal(harness.persisted.length, 1);
  assert.equal(harness.renders.length, 1);
  assert.equal(harness.renders[0].item.role, 'assistant');
  assert.equal(harness.renders[0].element.dataset.messageId, harness.persisted[0].id);
  assert.equal(harness.renders[0].element.dataset.canonical, 'true');
  assert.equal(harness.renders[0].validation.status, 'partial');
  assert.equal(harness.normalBox.querySelector(`[data-message-id="${harness.persisted[0].id}"]`), harness.renders[0].element);

  assert.equal(harness.api.finalize('assistant', 'respuesta repetida', 'turn-1', { channel:'voice' }), true);
  assert.equal(harness.persisted.length, 1);
  assert.equal(harness.renders.length, 1);
});

test('Etapa 1.1.2: vacío, cancelación o interrupción eliminan el borrador sin persistir ni presentar una respuesta falsa', () => {
  const harness = createLiveHarness();
  const emptyDraft = harness.api.begin('user', 'turn-empty', 'Escuchando…');
  harness.api.update('user', 'fragmento sin cierre', 'turn-empty');
  assert.equal(harness.api.finalize('user', '  ', 'turn-empty'), false);
  assert.equal(emptyDraft.wrap.isConnected, false);

  const interruptedDraft = harness.api.begin('assistant', 'turn-interrupted', 'Yarbi está respondiendo…');
  harness.api.update('assistant', 'respuesta parcial interrumpida', 'turn-interrupted');
  harness.api.discard('turn-interrupted');
  assert.equal(interruptedDraft.wrap.isConnected, false);
  assert.equal(harness.persisted.length, 0);
  assert.equal(harness.renders.length, 0);
});

test('Etapa 1.1.2: una finalización sin borrador tras reconexión conserva rol e id y no declara completo contenido truncado', () => {
  const harness = createLiveHarness();
  const oversized = '😀'.repeat(renderer.LIMITS.messageChars + 1);
  assert.equal(harness.api.finalize('user', oversized, 'turn-reconnected', { channel:'voice' }), true);
  assert.equal(harness.persisted.length, 1);
  assert.equal(harness.renders.length, 1);
  assert.equal(harness.renders[0].item.role, 'user');
  assert.equal(harness.renders[0].element.dataset.messageId, harness.persisted[0].id);
  assert.equal(harness.renders[0].validation.status, 'partial');
  assert.equal(harness.renders[0].validation.truncated, true);
});

test('Etapa 1.1.2: turnos iguales no se fusionan entre sesiones o turnos distintos aunque coincidan texto y timestamp', () => {
  const harness = createLiveHarness();
  const priorNow = Date.now;
  Date.now = () => 1794355200000;
  try {
    assert.equal(harness.api.finalize('assistant', 'Mensaje igual', 'turn-1', { channel:'voice', liveSessionId:'live-A' }), true);
    assert.equal(harness.api.finalize('assistant', 'Mensaje igual', 'turn-2', { channel:'voice', liveSessionId:'live-A' }), true);
    assert.equal(harness.api.finalize('assistant', 'Mensaje igual', 'turn-1', { channel:'voice', liveSessionId:'live-B' }), true);
  } finally { Date.now = priorNow; }
  assert.equal(harness.persisted.length, 3);
  assert.equal(new Set(harness.persisted.map(item => item.id)).size, 3);
  assert.equal(harness.renders.length, 3);
  assert.equal(harness.api.finalize('assistant', 'Mensaje igual', 'turn-1', { channel:'voice', liveSessionId:'live-A' }), true);
  assert.equal(harness.persisted.length, 3);
  assert.equal(harness.renders.length, 3);
});

test('Hardening Live: la identidad v2 conserva cada componente sin sanitización ni truncamiento', () => {
  const harness = createLiveHarness();
  const turn = 'turn/uno:dos con espacio_😀';
  const slash = harness.api.itemId('assistant', turn, { liveSessionId:'sesion/123' });
  const underscore = harness.api.itemId('assistant', turn, { liveSessionId:'sesion_123' });
  assert.notEqual(slash, underscore);
  assert.match(slash, /^yl_v2_[a-z0-9_]+$/);

  const sharedSessionPrefix = 's'.repeat(96);
  const sharedTurnPrefix = 't'.repeat(40);
  assert.notEqual(
    harness.api.itemId('assistant', sharedTurnPrefix + '-A', { liveSessionId:sharedSessionPrefix + '-A' }),
    harness.api.itemId('assistant', sharedTurnPrefix + '-B', { liveSessionId:sharedSessionPrefix + '-B' })
  );
  assert.notEqual(
    harness.api.itemId('assistant', 'Turno', { liveSessionId:'Sesión Única' }),
    harness.api.itemId('assistant', 'turno', { liveSessionId:'sesión única' })
  );
  assert.notEqual(
    harness.api.itemId('assistant', 'x_y:z', { liveSessionId:'a_b:c' }),
    harness.api.itemId('assistant', 'y:z', { liveSessionId:'a_b:c_x' })
  );
  assert.notEqual(harness.api.itemId('user', turn, { liveSessionId:'sesion/123' }), slash);
});

test('Hardening Live: ausente, null y vacío son distintos; sesiones distintas no cruzan borradores', () => {
  const harness = createLiveHarness();
  const undefinedId = harness.api.itemId('user', undefined, {});
  const nullId = harness.api.itemId('user', null, { liveSessionId:null });
  const emptyId = harness.api.itemId('user', '', { liveSessionId:'' });
  assert.notEqual(undefinedId, nullId);
  assert.notEqual(undefinedId, emptyId);
  assert.notEqual(nullId, emptyId);

  const first = harness.api.begin('assistant', 'same-turn', 'Preparando respuesta…', { liveSessionId:'A/B' });
  const second = harness.api.begin('assistant', 'same-turn', 'Preparando respuesta…', { liveSessionId:'A_B' });
  assert.notEqual(first.key, second.key);
  assert.equal(harness.api.finalize('assistant', 'Mismo texto', 'same-turn', { channel:'voice', liveSessionId:'A/B' }), true);
  assert.equal(harness.api.finalize('assistant', 'Mismo texto', 'same-turn', { channel:'voice', liveSessionId:'A_B' }), true);
  assert.equal(harness.persisted.length, 2);
});

test('Hardening Live: callback repetido y reconexión conservan una entrada por tupla exacta', () => {
  const harness = createLiveHarness();
  const options = { channel:'voice', liveSessionId:'reconnect/live' };
  assert.equal(harness.api.finalize('user', 'Mensaje estable', 'turn-7', options), true);
  assert.equal(harness.api.finalize('user', 'Mensaje estable', 'turn-7', options), true);
  assert.equal(harness.persisted.length, 1);
  assert.equal(harness.renders.length, 1);
  assert.equal(harness.api.finalize('user', 'Mensaje estable', 'turn-8', options), true);
  assert.equal(harness.persisted.length, 2);
  assert.equal(new Set(harness.persisted.map(item => item.id)).size, 2);
});

test('Etapa 1.1.2: un nuevo turno puede finalizar antes del anterior sin cruzar borradores ni mensajes', () => {
  const harness = createLiveHarness();
  const options = { liveSessionId:'live-order' };
  const first = harness.api.begin('user', 'turn-earlier', 'Escuchando…', options);
  const later = harness.api.begin('assistant', 'turn-later', 'Yarbi está respondiendo…', options);
  harness.api.update('user', 'Primera consulta', 'turn-earlier', options);
  harness.api.update('assistant', 'Respuesta del turno posterior', 'turn-later', options);
  assert.equal(harness.api.finalize('assistant', 'Respuesta del turno posterior', 'turn-later', { channel:'voice', liveSessionId:'live-order' }), true);
  assert.equal(harness.api.finalize('user', 'Primera consulta', 'turn-earlier', { channel:'voice', liveSessionId:'live-order' }), true);
  assert.equal(first.wrap.isConnected, false);
  assert.equal(later.wrap.isConnected, false);
  assert.equal(harness.persisted.length, 2);
  assert.equal(harness.renders.length, 2);
  assert.notEqual(harness.persisted[0].id, harness.persisted[1].id);
});

test('Etapa 1.1.2: un fallo de persistencia o render no confirma el turno y permite recuperación sin duplicarlo', () => {
  const harness = createLiveHarness();
  const options = { liveSessionId:'live-retry' };
  const draft = harness.api.begin('user', 'turn-retry', 'Escuchando…', options);
  harness.api.update('user', 'Cliente sintético', 'turn-retry', options);
  harness.state.failPersistence = true;
  assert.equal(harness.api.finalize('user', 'Cliente sintético', 'turn-retry', { channel:'voice', liveSessionId:'live-retry' }), false);
  assert.equal(draft.wrap.isConnected, true);
  assert.equal(harness.persisted.length, 0);

  harness.state.failPersistence = false;
  harness.state.failRenderer = true;
  assert.equal(harness.api.finalize('user', 'Cliente sintético', 'turn-retry', { channel:'voice', liveSessionId:'live-retry' }), false);
  assert.equal(draft.wrap.isConnected, true);
  assert.equal(harness.persisted.length, 1);
  assert.equal(harness.renders.length, 0);

  harness.state.failRenderer = false;
  assert.equal(harness.api.finalize('user', 'Cliente sintético', 'turn-retry', { channel:'voice', liveSessionId:'live-retry' }), true);
  assert.equal(draft.wrap.isConnected, false);
  assert.equal(harness.persisted.length, 1);
  assert.equal(harness.renders.length, 1);
});

test('Etapa 1.1.2: la implementación normal confirma el renderer canónico antes de retirar el draft', () => {
  const finalizer = extractFunction(memoryCenter, 'window.gfcFinalizeLiveTranscriptDraft = function');
  assert.match(finalizer, /if \(!training\) \{[\s\S]*renderTimelineItem\(item\)[\s\S]*if \(!rendered\) return false;[\s\S]*draft\?\.wrap\?\.isConnected\) draft\.wrap\.remove\(\)/);
  assert.match(finalizer, /else if \(draft\?\.wrap\?\.isConnected\)/);
  assert.match(finalizer, /if \(!rendered\) return false/);
});
