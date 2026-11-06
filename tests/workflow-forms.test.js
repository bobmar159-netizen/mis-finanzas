const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workspace = path.resolve(__dirname, '..', '..', 'YARBI_LATEST_CRM_PHASE2_BUILD_2026-09-15');
const html = fs.readFileSync(path.join(workspace, 'www', 'index.html'), 'utf8');
const plugin = fs.readFileSync(path.join(workspace, 'android', 'app', 'src', 'main', 'java', 'com', 'misfinanzas', 'app', 'GfcNotificationPlugin.java'), 'utf8');

test('workflow: a spoken agenda order opens the visual form before the remote command finishes', () => {
  const start = html.indexOf('async function gfcProcessLiveAppCommand');
  const block = html.slice(start, html.indexOf('function gfcCommitLiveTurn', start));
  assert.ok(block.indexOf('gfcFastAgendaCommand(commandText)') < block.indexOf('await gfcTryYarbiCommand(commandText)'));
});

test('workflow: service and price are mandatory only for construction', () => {
  const start = html.indexOf('function gfcApplyYarbiDraft');
  const block = html.slice(start, html.indexOf('window._gfcPendingOwnerInstruction', start));
  assert.match(block, /kind === 'construccion' && !preData\.servicio/);
  assert.match(block, /kind === 'construccion' && !\(Number\(preData\.precio\) > 0\)/);
});

test('workflow: converting a visit creates a linked construction and preserves the source visit', () => {
  const start = html.indexOf('function saveAgendaItem');
  const block = html.slice(start, html.indexOf('function editAgendaItem', start));
  assert.match(block, /sourceVisit\.estado = 'convertido'/);
  assert.match(block, /sourceVisit\.convertedToAgendaId = finalId/);
  assert.doesNotMatch(block, /finalId = window\._conversionVisita\.id/);
});

test('backup: Android persists and verifies JSON in the fixed Downloads folder', () => {
  assert.match(plugin, /Environment\.DIRECTORY_DOWNLOADS \+ "\/MisFinanzas"/);
  assert.match(plugin, /ret\.put\("verified", true\)/);
  assert.match(html, /Descargas\/MisFinanzas/);
});

test('service close: voice opens and updates the real Registrar form', () => {
  assert.match(html, /name: 'open_service_close_form'/);
  assert.match(html, /name: 'update_service_close_form'/);
  assert.match(html, /gfcOpenServiceCloseForm/);
  assert.match(html, /gfcUpdateServiceCloseForm/);
});
