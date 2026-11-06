const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const frontend = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const collections = fs.readFileSync(path.join(root, 'api', 'assistant', 'collections.js'), 'utf8');

test('expected outcome: what do we have today uses the deterministic Lima snapshot', () => {
  assert.match(frontend, /name: 'get_today_snapshot'/);
  assert.match(frontend, /if \(name === 'get_today_snapshot'\) return gfcTodaySnapshot\(\)/);
  assert.match(frontend, /que tenemos para hoy[\s\S]{0,160}llama obligatoriamente get_today_snapshot/);
});

test('expected outcome: a construction order opens the existing form and exposes missing fields', () => {
  const start = frontend.indexOf('async function gfcPrepareAgentAction(args)');
  const end = frontend.indexOf('function gfcAgentReadModule', start);
  const block = frontend.slice(start, end);
  assert.match(block, /_mostrarResumenAgendaEnMic/);
  assert.match(block, /form_opened: true/);
  assert.match(block, /missing: window\._gfcYarbiDraftMissing \|\| \[\]/);
  assert.match(block, /di guardalo para conservarlo como pendiente/);
});

test('expected outcome: completed work asks for collection and accepts only the spoken balance', () => {
  const closeStart = frontend.indexOf('async function gfcRecordDailyOutcome(args)');
  const closeEnd = frontend.indexOf('// COLLECTION_BALANCE_V1', closeStart);
  const close = frontend.slice(closeStart, closeEnd);
  const collectionStart = frontend.indexOf('async function gfcRecordCollectionBalance(args)');
  const collectionEnd = frontend.indexOf('// PROACTIVE_ALERTS_V1', collectionStart);
  const collection = frontend.slice(collectionStart, collectionEnd);
  assert.match(close, /collection_prompt: outcome === 'completed' && agreedTotal > 0/);
  assert.match(close, /¿Se cobró todo o quedó algún saldo\?/);
  assert.match(collection, /gfcCollectionInputSupports\(balanceAmount, inputText\)/);
  assert.match(collection, /payload\?\.canonical_updates\?\.verified !== true/);
});

test('expected outcome: debt confirmation updates receivable, CRM and memory with read-back', () => {
  const receivableReadBack = collections.indexOf("/rest/v1/yarbi_receivables?id=eq.'");
  const canonicalUpdate = collections.indexOf('syncCanonicalCollectionContext', receivableReadBack);
  assert.ok(receivableReadBack >= 0 && canonicalUpdate > receivableReadBack);
  assert.match(collections, /crm_contacts\?id=eq\./);
  assert.match(collections, /read-back no confirmó su estado operativo/);
  assert.match(collections, /ai_conversation_memory\?on_conflict=contact_id/);
  assert.match(collections, /read-back no confirmó el seguimiento/);
  assert.match(collections, /\[agenda:' \+ agendaEventId \+ '\]/);
});
