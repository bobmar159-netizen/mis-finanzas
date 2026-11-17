const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const frontend = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'index.html'), 'utf8');

function loadAlerts({ agenda = [], suggestions = [], debts = [] } = {}) {
  const start = frontend.indexOf('function gfcBuildProactiveAlerts(options = {})');
  const end = frontend.indexOf('function gfcAgentCompact', start);
  const context = {
    state: { agenda, deudas: debts },
    window: { _gfcWhatsappSuggestions: suggestions, _gfcLiveSession: {} },
    gfcLimaClock: () => ({ date: '2026-10-02' }),
    gfcAgendaOperationalCycle: item => ({ actual: { status: item.actual || 'unconfirmed' } }),
    gfcExtractPhoneNumber: value => String(value || '').replace(/\D/g, ''),
    gfcExtractMapsLink: value => (/https?:\/\/\S+/i.exec(String(value || '')) || [])[0] || '',
    gfcYarbiLocalNormalize: value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(),
    gfcYarbiConversationInboxRead: () => [],
    gfcEscHtml: value => String(value || ''),
    gfcAppendCopilotChatMessage: () => {}
  };
  vm.createContext(context);
  vm.runInContext(frontend.slice(start, end), context);
  return context;
}

test('proactive alerts: prioritizes balances and due unconfirmed work', () => {
  const context = loadAlerts({
    agenda: [
      { id: 'job-1', cliente: 'Ana', fecha: '2026-10-01', tipo: 'trabajo', estado: 'pendiente', actual: 'unconfirmed' },
      { id: 'job-2', cliente: 'Beto', fecha: '2026-10-02', tipo: 'trabajo', estado: 'se_finalizo', actual: 'executed', montoPendienteCobro: 200 }
    ]
  });
  const result = context.gfcBuildProactiveAlerts({ scope: 'review' });
  assert.equal(result.alerts[0].key, 'collection:job-2');
  assert.ok(result.alerts.some(item => item.key === 'outcome:job-1'));
  assert.equal(result.groups.collections, 1);
  assert.equal(result.groups.operations, 1);
});

test('proactive alerts: location without linked agenda is a signal, not a completed visit', () => {
  const context = loadAlerts({
    suggestions: [{ id: 'msg-1', title: 'Carlos', phone: '999111222', mapsUrl: 'https://maps.app.goo.gl/test', timestamp: Date.now() }]
  });
  const result = context.gfcBuildProactiveAlerts({ scope: 'review' });
  assert.equal(result.alerts[0].key, 'location:msg-1');
  assert.match(result.alerts[0].recommendation, /confirmar/i);
  assert.doesNotMatch(JSON.stringify(result.alerts[0]), /servicio completado/i);
});

test('proactive alerts: an availability conflict is a high-priority reprogramming prompt, never an automatic change', () => {
  const context = loadAlerts({
    suggestions: [{ id: 'availability-1', title: 'Carlos', phone: '999111222', text: 'El cliente informó que estará de viaje.', _yarbiAvailabilityAlertId: 'remote-alert-1', _yarbiAgendaEventId: 'agenda-1', timestamp: Date.now() }]
  });
  const result = context.gfcBuildProactiveAlerts({ scope: 'review' });
  assert.equal(result.alerts[0].key, 'availability:remote-alert-1');
  assert.equal(result.alerts[0].severity, 'high');
  assert.match(result.alerts[0].recommendation, /reprogramar o cancelar/i);
  assert.match(result.alerts[0].recommendation, /sigue intacta/i);
});

test('proactive alerts: proactive scope emits at most one unseen alert per session', () => {
  const context = loadAlerts({
    agenda: [
      { id: 'a', cliente: 'A', fecha: '2026-10-01', tipo: 'visita', actual: 'unconfirmed' },
      { id: 'b', cliente: 'B', fecha: '2026-10-01', tipo: 'trabajo', actual: 'unconfirmed' }
    ]
  });
  const first = context.gfcBuildProactiveAlerts({ scope: 'proactive' });
  const second = context.gfcBuildProactiveAlerts({ scope: 'proactive' });
  assert.equal(first.returned_count, 1);
  assert.equal(second.returned_count, 1);
  assert.notEqual(first.alerts[0].key, second.alerts[0].key);
});

test('proactive alerts: visual strip is silent and live rule forbids alerts in the greeting', () => {
  assert.match(frontend, /PROACTIVE_ALERTS_V1/);
  assert.match(frontend, /gfcProactiveAlertStripHtml\(\)/);
  assert.match(frontend, /Nunca leas alertas durante el saludo inicial/);
  const start = frontend.indexOf('function gfcBuildProactiveAlerts(options = {})');
  const end = frontend.indexOf('function gfcAgentCompact', start);
  const block = frontend.slice(start, end);
  assert.doesNotMatch(block, /gfcSpeak|speechSynthesis|gfcStartCopilotVoiceInput/);
  assert.match(block, /slice\(0, 1\)/);
});
