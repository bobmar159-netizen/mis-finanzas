const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const frontend = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const webhook = fs.readFileSync(path.join(root, 'api', 'webhook.js'), 'utf8');

function loadOperationalScenario(agenda) {
  const context = {
    state: { agenda, deudas: [] },
    window: { _gfcWhatsappSuggestions: [], _gfcLiveSession: {} },
    gfcLimaClock: () => ({ date:'2026-10-03' }),
    gfcYarbiLocalNormalize: value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(),
    gfcExtractPhoneNumber: value => String(value || '').replace(/\D/g, ''),
    gfcExtractMapsLink: value => (/https?:\/\/\S+/i.exec(String(value || '')) || [])[0] || '',
    gfcEscHtml: value => String(value || ''),
    gfcAppendCopilotChatMessage: () => {},
    _migEst: value => String(value || 'agendado'),
    crmText: value => String(value || '')
  };
  vm.createContext(context);
  const cycleStart = frontend.indexOf('// OPERATIONAL_CYCLE_V1');
  const cycleEnd = frontend.indexOf('// COLLECTION_BALANCE_V1', cycleStart);
  vm.runInContext(frontend.slice(cycleStart, cycleEnd), context);
  const alertsStart = frontend.indexOf('function gfcBuildProactiveAlerts(options = {})');
  const alertsEnd = frontend.indexOf('function gfcAgentCompact', alertsStart);
  vm.runInContext(frontend.slice(alertsStart, alertsEnd), context);
  const visualStart = frontend.indexOf('const AGENDA_ESTADOS = {');
  const visualEnd = frontend.indexOf('const AGENDA_SERVICIOS = [', visualStart);
  vm.runInContext(frontend.slice(visualStart, visualEnd), context);
  return context;
}

test('controlled E2E: pending visit flows through close, alerts and visual completion', () => {
  const visit = { id:'visit-1', tipo:'visita', cliente:'Carlos', fecha:'2026-10-03', hora:'16:30', estado:'pendiente' };
  const context = loadOperationalScenario([visit]);
  const beforeClose = context.gfcBuildDailyClose();
  const beforeAlerts = context.gfcBuildProactiveAlerts({ scope:'review' });
  assert.equal(beforeClose.current.id, 'visit-1');
  assert.ok(beforeAlerts.alerts.some(item => item.key === 'outcome:visit-1'));

  visit.estado = 'interesado';
  const cycle = context.gfcAgendaOperationalCycle(visit);
  const chips = context.gfcAgendaVisualChips(visit);
  const afterClose = context.gfcBuildDailyClose();
  const afterAlerts = context.gfcBuildProactiveAlerts({ scope:'review' });
  assert.equal(cycle.actual.status, 'executed');
  assert.equal(chips[0].label, 'Visitado');
  assert.equal(afterClose.current, null);
  assert.ok(!afterAlerts.alerts.some(item => item.key === 'outcome:visit-1'));
});

test('controlled E2E: manual voice activation greets before using persistent context', () => {
  const activation = frontend.indexOf('gfcStartGeminiLive({ initialGreeting: true })');
  const greeting = frontend.indexOf("return 'Hola, Omar. Te escucho.'");
  const contextLoad = frontend.indexOf('const liveMemoryContext = gfcBuildLiveMemoryContext()');
  const exactGreeting = frontend.indexOf('Responde exactamente con esta frase y nada más');
  assert.ok(activation >= 0 && greeting >= 0 && contextLoad >= 0 && exactGreeting >= 0);
  assert.match(frontend, /if \(session\.modeGreetingTurn\)[\s\S]*return;[\s\S]*memory\.turns\.push/);
});

test('controlled E2E: incoming WhatsApp is durable before background analysis and fast conversation read', () => {
  const persisted = webhook.indexOf('const whatsappSaveResponse = await fetch');
  const scheduled = webhook.indexOf('scheduleCanonicalProcessing(messageId)', persisted);
  const fastStart = frontend.indexOf('// FAST_READ_PATH_V1');
  const fastEnd = frontend.indexOf('function gfcLiveInputRequestsCurrentClock', fastStart);
  const fastBlock = frontend.slice(fastStart, fastEnd);
  assert.ok(persisted >= 0 && scheduled > persisted);
  assert.ok(fastBlock.indexOf('gfcYarbiLocalFindMemory') < fastBlock.indexOf('gfcClientMemoryCacheRead'));
  assert.ok(fastBlock.indexOf('gfcClientMemoryCacheRead') < fastBlock.indexOf("fetch('https://misfinanzas-backend.vercel.app/api/whatsapp/messages?'"));
});
