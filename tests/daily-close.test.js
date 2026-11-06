const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const frontend = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function loadDailyCloseContext(agenda) {
  const start = frontend.indexOf('function gfcAgendaOperationalCycle(item)');
  const end = frontend.indexOf('function gfcAgentCompact', start);
  const context = {
    state: { agenda },
    window: {},
    gfcLimaClock: () => ({ date: '2026-10-02' }),
    gfcYarbiLocalNormalize: value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  };
  vm.createContext(context);
  vm.runInContext(frontend.slice(start, end), context);
  return context;
}

test('daily close: lists only due unconfirmed agenda records and asks one at a time', () => {
  const start = frontend.indexOf('function gfcBuildDailyClose()');
  const end = frontend.indexOf('function gfcDailyCloseInputText', start);
  const block = frontend.slice(start, end);
  assert.match(frontend, /DAILY_CLOSE_V1/);
  assert.match(block, /date <= today/);
  assert.match(block, /cycle\.actual\.status === 'unconfirmed'/);
  assert.match(block, /current: pending\[0\]/);
});

test('daily close: behavior excludes future and already completed records', () => {
  const context = loadDailyCloseContext([
    { id: 'old-open', cliente: 'Ana', fecha: '2026-10-01', hora: '09:00', estado: 'pendiente', tipo: 'visita' },
    { id: 'today-open', cliente: 'Beto', fecha: '2026-10-02', hora: '10:00', estado: 'agendado', tipo: 'trabajo' },
    { id: 'today-done', cliente: 'Carmen', fecha: '2026-10-02', hora: '11:00', estado: 'se_finalizo', tipo: 'visita' },
    { id: 'future', cliente: 'Diego', fecha: '2026-10-03', hora: '08:00', estado: 'pendiente', tipo: 'visita' }
  ]);
  const result = context.gfcBuildDailyClose();
  assert.deepEqual(Array.from(result.pending, item => item.id), ['old-open', 'today-open']);
  assert.equal(result.current.id, 'old-open');
  assert.equal(result.pending_count, 2);
});

test('daily close: behavior requires a clear answer for each outcome', () => {
  const context = loadDailyCloseContext([]);
  assert.equal(context.gfcDailyCloseOutcomeSupported('completed', 'sí, ya fui'), true);
  assert.equal(context.gfcDailyCloseOutcomeSupported('completed', 'no fui'), false);
  assert.equal(context.gfcDailyCloseOutcomeSupported('not_done', 'no, quedó pendiente'), true);
  assert.equal(context.gfcDailyCloseOutcomeSupported('reprogrammed', 'reprográmalo para mañana'), true);
  assert.equal(context.gfcDailyCloseOutcomeSupported('cancelled', 'cancélalo'), true);
  assert.equal(context.gfcDailyCloseOutcomeSupported('completed', 'quizá luego'), false);
});

test('daily close: updates an exact agenda id only after explicit verbal evidence', () => {
  const start = frontend.indexOf('async function gfcRecordDailyOutcome(args)');
  const end = frontend.indexOf('// COLLECTION_BALANCE_V1', start);
  const block = frontend.slice(start, end);
  assert.match(block, /String\(item\?\.id \|\| ''\) === agendaId/);
  assert.match(block, /gfcDailyCloseOutcomeSupported\(outcome, inputText\)/);
  assert.match(block, /explicit_confirmation_required/);
});

test('daily close: waits for canonical Supabase confirmation and reports pending sync honestly', () => {
  const start = frontend.indexOf('async function gfcRecordDailyOutcome(args)');
  const end = frontend.indexOf('// COLLECTION_BALANCE_V1', start);
  const block = frontend.slice(start, end);
  assert.match(block, /await gfcSyncAgendaItemToSupabase/);
  assert.match(block, /persisted_remote: remoteSynced/);
  assert.match(block, /pending_sync/);
  assert.doesNotMatch(block, /telefono/);
});
