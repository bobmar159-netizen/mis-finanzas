const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const frontend = read('index.html');
const approve = read(path.join('api', 'actions', 'approve.js'));
const webhook = read(path.join('api', 'webhook.js'));

function between(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start);
  assert.ok(start >= 0 && end > start, 'No se encontro el bloque ' + startToken);
  return source.slice(start, end);
}

function loadDraftContext(alert = null) {
  const opened = [];
  const context = {
    window: {},
    gfcGetYarbiAlertContext: () => alert,
    gfcRecordYarbiAction: () => {},
    gfcChatDiag: () => {},
    openAddAgenda: (...args) => opened.push(args),
    toast: () => {},
    setTimeout: callback => { callback(); return 1; }
  };
  vm.createContext(context);
  vm.runInContext(between(frontend, 'function gfcApplyYarbiDraft(draft)', 'function gfcConfirmPendingYarbiForm'), context);
  return { context, opened };
}

function loadAgendaMatchContext(agenda) {
  const context = {
    state: { agenda },
    gfcExtractPhoneNumber: value => String(value || '').replace(/\D/g, ''),
    gfcCleanNameForMatching: value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
  };
  vm.createContext(context);
  vm.runInContext(between(frontend, 'function gfcFindAgendaMatch(action)', 'function gfcRecordYarbiAction'), context);
  return context;
}

function loadOperationalContext(agenda) {
  const context = {
    state: { agenda },
    window: {},
    gfcLimaClock: () => ({ date: '2026-10-03' }),
    gfcYarbiLocalNormalize: value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
  };
  vm.createContext(context);
  vm.runInContext(between(frontend, 'function gfcAgendaOperationalCycle(item)', 'function gfcAgentCompact'), context);
  return context;
}

test('Caso A - registrar visita abre el formulario existente con cliente, fecha y hora', () => {
  const { context, opened } = loadDraftContext();
  const result = context.gfcApplyYarbiDraft({ kind: 'visita', clientName: 'Carlos', date: '2026-10-04', time: '16:00' });
  assert.equal(opened.length, 1);
  assert.equal(opened[0][0], 'visita');
  assert.equal(opened[0][2].cliente, 'Carlos');
  assert.equal(opened[0][2].fecha, '2026-10-04');
  assert.equal(opened[0][2].hora, '16:00');
  assert.ok(result.missing.includes('servicio'));
  assert.match(frontend, /gfcSyncAgendaItemToSupabase\(item\.id, item\)/);
});

test('Caso B - construccion reutiliza solo Maps y telefono comprobados y pregunta datos faltantes', () => {
  const verified = { phone: '51999123987', mapsUrl: 'https://maps.app.goo.gl/Ernesto' };
  const { context, opened } = loadDraftContext();
  const result = context.gfcApplyYarbiDraft({ kind: 'construccion', clientName: 'Ernesto', phone: verified.phone, mapsUrl: verified.mapsUrl, date: '2026-10-10', time: '14:00' });
  assert.equal(opened[0][0], 'trabajo');
  assert.equal(opened[0][2].telefono, verified.phone);
  assert.equal(opened[0][2].mapsUrl, verified.mapsUrl);
  assert.ok(result.missing.includes('servicio'));
  assert.ok(result.missing.includes('precio'));
  assert.ok(!result.missing.includes('ubicación'));
});

test('Caso C - dos clientes Carlos obligan a desambiguar y nunca eligen arbitrariamente', () => {
  const context = loadAgendaMatchContext([
    { id: 'c1', cliente: 'Carlos', telefono: '51911111987' },
    { id: 'c2', cliente: 'Carlos', telefono: '51922222654' }
  ]);
  const match = context.gfcFindAgendaMatch({ client_name: 'Carlos' });
  assert.equal(match.ambiguous, true);
  assert.equal(match.count, 2);
  assert.equal(match.item, undefined);
});

test('Caso D - una visita no registrada se mantiene no confirmada sin inventar emociones', () => {
  const context = loadOperationalContext([{ id: 'v1', tipo: 'visita', fecha: '2026-10-03', estado: 'agendado' }]);
  const cycle = context.gfcAgendaOperationalCycle(context.state.agenda[0]);
  assert.equal(cycle.actual.status, 'unconfirmed');
  assert.match(cycle.rule, /no demuestra ejecuci/i);
  assert.doesNotMatch(between(frontend, '// OPERATIONAL_CYCLE_V1', '// DAILY_CLOSE_V1'), /molesto|enojado|no fuiste/i);
});

test('Caso E - cambio de version tiene fuente remota y restauracion antes de sincronizar', () => {
  const recovery = between(frontend, 'async function gfcAccountRestoreBeforeSync', 'function gfcAccountSetStatus');
  assert.match(frontend, /gfcSyncAgendaItemToSupabase\(item\.id, item\)/);
  assert.match(recovery, /await gfcAccountSettingsSync\(\)/);
  assert.match(frontend, /_remoteAgendaEventId/);
});

test('Caso F - reprogramacion exige nueva fecha valida antes de modificar', () => {
  const block = between(frontend, 'async function gfcRecordDailyOutcome(args)', '// COLLECTION_BALANCE_V1');
  assert.match(block, /outcome === 'reprogrammed'/);
  assert.match(block, /valid_future_date_required/);
  assert.match(block, /Pregunta la nueva fecha antes de modificar la agenda/);
  assert.match(block, /motivoReprogramacion/);
});

test('Caso G - saldo hablado de 200 usa registro remoto idempotente', () => {
  const block = between(frontend, 'function gfcCollectionSpokenBalance(inputText)', '// PROACTIVE_ALERTS_V1');
  assert.match(block, /\(\[0-9\]\+\(\?:\[\.,\]\[0-9\]\{1,2\}\)\?\)/);
  assert.match(block, /gfcCollectionInputSupports\(balanceAmount, inputText\)/);
  assert.match(read(path.join('api', 'assistant', 'collections.js')), /on_conflict=agenda_event_id/);
});

test('Caso H - cierre diario pregunta solo actividades vencidas o de hoy sin cerrar', () => {
  const context = loadOperationalContext([
    { id: 'old', cliente: 'Ana', tipo: 'visita', fecha: '2026-10-02', estado: 'pendiente' },
    { id: 'done', cliente: 'Beto', tipo: 'trabajo', fecha: '2026-10-03', estado: 'se_finalizo' },
    { id: 'future', cliente: 'Celia', tipo: 'visita', fecha: '2026-10-04', estado: 'pendiente' }
  ]);
  const close = context.gfcBuildDailyClose();
  assert.deepEqual(Array.from(close.pending, item => item.id), ['old']);
  assert.equal(close.current.id, 'old');
});

test('Caso I - WhatsApp persiste antes del background y la consulta no reprocesa historial', () => {
  const persisted = webhook.indexOf('const whatsappSaveResponse = await fetch');
  const scheduled = webhook.indexOf('scheduleCanonicalProcessing(messageId)', persisted);
  const liveStart = frontend.indexOf('async function gfcStartGeminiLive');
  const liveEnd = frontend.indexOf('function gfcStopGeminiLive', liveStart);
  assert.ok(persisted >= 0 && scheduled > persisted);
  assert.doesNotMatch(frontend.slice(liveStart, liveEnd), /\/api\/ai\/process|history-backfill/);
});

test('Caso J - preflight Calendar detecta creacion configurada y ausencia actual de update/cancel', () => {
  assert.match(approve, /action: 'create_calendar_event'/);
  assert.doesNotMatch(approve, /action: '(?:update|cancel)_calendar_event'/);
});

test('Caso K - preflight Notion exige credenciales y solo marca exito con respuesta HTTP real', () => {
  assert.match(approve, /if \(NOTION_TOKEN && NOTION_DB_AGENDA\)/);
  assert.match(approve, /if \(nRes\.ok\)/);
  assert.match(approve, /syncResults\.notion = true/);
});

test('Caso L - preflight Sheets envia la agenda pero aun necesita read-back externo', () => {
  assert.match(approve, /if \(GOOGLE_SHEETS_URL\)/);
  assert.match(approve, /action: 'add_agenda'/);
  assert.match(approve, /if \(sRes\.ok\)/);
});

test('Caso M - barge-in detiene fuentes y vacia las colas antes de volver a escuchar', () => {
  const block = between(frontend, 'function gfcClearLivePlayback(reason =', 'function gfcLocalWhatsAppMessages');
  assert.match(block, /source\.stop\(\)/);
  assert.match(block, /session\.liveAudioQueue = \[\]/);
  assert.match(block, /session\.liveAudioIngressQueue = \[\]/);
  assert.match(block, /user-barge-in/);
});

test('Caso N - sin Internet conserva pending_sync y reintenta al recuperar conexion', () => {
  const sync = between(frontend, 'function gfcSyncAgendaItemToSupabase', 'function saveAgendaItem');
  assert.match(sync, /_remoteSync: 'pending_sync'/);
  assert.match(sync, /catch\(error =>/);
  assert.match(sync, /window\.addEventListener\('online'/);
  assert.match(sync, /gfcRetryPendingAgendaSync\('startup'\)/);
});

test.todo('Caso A/E - read-back real de Supabase y recuperacion despues de reinstalar APK');
test.todo('Caso J - crear, reprogramar y cancelar un evento real con read-back de Calendar');
test.todo('Caso K - crear y volver a leer el registro real de Notion');
test.todo('Caso L - enviar y volver a leer la fila real de Sheets');
test.todo('Caso M - interrupcion fisica durante audio real en el telefono');
test.todo('Caso N - apagar red, guardar, reconectar y confirmar read-back remoto');
