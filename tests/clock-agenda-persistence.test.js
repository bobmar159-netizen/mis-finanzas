const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const frontend = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function between(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start);
  assert.ok(start >= 0 && end > start, 'No se encontró el bloque ' + startToken);
  return source.slice(start, end);
}

test('reloj Lima: 3 de octubre de 2026 es sábado y la etiqueta es determinista', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(between(frontend, 'function gfcLimaClock', 'function gfcOwnerInstructionNormalize'), context);
  const clock = context.gfcLimaClock(Date.parse('2026-10-04T02:29:00Z'));
  assert.equal(clock.date, '2026-10-03');
  assert.equal(clock.time, '21:29');
  assert.equal(clock.weekday, 'sábado');
  assert.equal(clock.dateLabel, 'sábado 3 de octubre de 2026');
  assert.match(frontend, /Usa literalmente weekday y date_label/);
});

test('borrador de construcción conserva teléfono, Maps y precio entre sesiones', () => {
  const values = new Map();
  const context = {
    localStorage: {
      getItem: key => values.has(key) ? values.get(key) : null,
      setItem: (key, value) => values.set(key, String(value))
    },
    gfcChatDiag: () => {},
    Date
  };
  vm.createContext(context);
  vm.runInContext(between(frontend, "const GFC_YARBI_AGENDA_DRAFT_KEY", 'function gfcYarbiAgendaEventParts'), context);
  context.gfcSaveYarbiAgendaDraft({ kind: 'construccion', clientName: 'Omar Mejía', phone: '955411248', date: '2026-10-05', time: '16:30', service: 'punto adicional', price: 350, mapsUrl: 'https://www.google.com/maps?q=-11.8281858,-77.1151053' });
  const restored = context.gfcLoadYarbiAgendaDraft({ client_name: 'Omar Mejia' }, 'trabajo');
  assert.equal(restored.clientName, 'Omar Mejía');
  assert.equal(restored.phone, '955411248');
  assert.equal(restored.price, 350);
  assert.equal(restored.mapsUrl, 'https://www.google.com/maps?q=-11.8281858,-77.1151053');
});

test('agenda Live recupera datos verificados y consulta local más Supabase antes de negar', () => {
  assert.match(frontend, /gfcBuildVerifiedAgendaDraft/);
  assert.match(frontend, /gfcFetchProcessedYarbiMemory\('memory'/);
  assert.match(frontend, /found\.requires_confirmation === false/);
  assert.match(frontend, /gfcBuildVerifiedAgendaSummary/);
  assert.match(frontend, /Antes de afirmar que una visita o construccion no fue agendada, llama obligatoriamente get_agenda_summary/);
  assert.match(frontend, /Un borrador abierto no cuenta como agenda guardada/);
});

test('identidad local: un nombre exacto reutiliza el teléfono del borrador persistente', () => {
  const values = new Map();
  const context = {
    localStorage: {
      getItem: key => values.has(key) ? values.get(key) : null,
      setItem: (key, value) => values.set(key, String(value))
    },
    gfcChatDiag: () => {},
    state: { agenda: [] },
    Date
  };
  vm.createContext(context);
  vm.runInContext(between(frontend, "const GFC_YARBI_AGENDA_DRAFT_KEY", 'function gfcYarbiAgendaEventParts'), context);
  vm.runInContext(between(frontend, 'function gfcResolveLocalClientIdentity', '// FAST_READ_PATH_V1'), context);
  context.gfcSaveYarbiAgendaDraft({ kind: 'construccion', clientName: 'Omar Mejía', phone: '955411248', mapsUrl: 'https://www.google.com/maps?q=-11.8,-77.1' });
  const resolved = context.gfcResolveLocalClientIdentity({ client_name: 'Omar Mejia' });
  assert.equal(resolved.phone, '955411248');
  assert.equal(resolved.source, 'persistent_agenda_draft');
  assert.equal(resolved.maps_url, 'https://www.google.com/maps?q=-11.8,-77.1');
});
