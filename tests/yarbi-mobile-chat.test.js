const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend', 'index.html'), 'utf8');
const memory = fs.readFileSync(path.join(root, 'frontend', 'yarbi-memory-center.js'), 'utf8');
const completionUi = fs.readFileSync(path.join(root, 'frontend', 'yarbi-product-completion-ui.js'), 'utf8');

test('el compositor móvil reserva el ancho para escribir y separa las acciones', () => {
  assert.match(memory, /gfc-yarbi-composer-toolbar/);
  assert.match(memory, /Pregunta lo que necesites…/);
  assert.match(memory, /Enter para enviar · Shift\+Enter para otra línea/);
  assert.match(html, /max-height:148px/);
  assert.match(html, /font-size:16px !important/);
  assert.match(html, /width:min\(100%,760px\)/);
});

test('la conversación principal no muestra controles de validación como navegación permanente', () => {
  const chatHtml = memory.slice(memory.indexOf('function chatHtml()'), memory.indexOf('function hubHtml()'));
  assert.doesNotMatch(chatHtml, /Trabajo real/);
  assert.doesNotMatch(chatHtml, /Aprendizaje 0/);
  assert.doesNotMatch(chatHtml, /gfc-yarbi-learning-chip/);
  assert.match(chatHtml, /Volver al chat/);
  assert.match(completionUi, /Capacitor\?\.isNativePlatform\?\.\(\)/);
});

test('los saludos automáticos históricos no vuelven a duplicarse visualmente', () => {
  assert.match(memory, /function isLegacyAutomaticGreeting/);
  assert.match(memory, /function visibleTimeline/);
  assert.doesNotMatch(memory, /gfcAppendCopilotTimelineMessage\('assistant', 'Hola, estoy listo para ayudarte/);
  assert.doesNotMatch(html, /gfcAppendCopilotChatMessage\('assistant','Hola, ¿en qué te ayudo\?'\)/);
  assert.match(memory, /divider\.dataset\.dayKey = key/);
});

test('el chat abre en los mensajes recientes y deja el historial bajo demanda', () => {
  assert.match(memory, /const INITIAL_CHAT_MESSAGES = 24/);
  assert.match(memory, /const CHAT_HISTORY_PAGE = 36/);
  assert.match(memory, /function renderTimelineWindow/);
  assert.match(memory, /Ver .* mensajes anteriores/);
  assert.match(memory, /renderTimelineWindow\(box, initialVisibleTimeline, INITIAL_CHAT_MESSAGES, true\)/);
  assert.match(memory, /function scrollChatToLatest/);
  assert.match(memory, /_gfcYarbiForceLatestUntil = Date\.now\(\) \+ 1600/);
  assert.match(memory, /box\.style\.scrollBehavior = 'auto'/);
  assert.match(memory, /box\.dataset\.gfcRestoring === '1'/);
  assert.match(html, /\.gfc-yarbi-chat\[data-gfc-restoring="1"\]\{visibility:hidden\}/);
  assert.doesNotMatch(html, /\.gfc-yarbi-chat\{padding:18px 13px 24px;background:#F7F7F5;scroll-behavior:smooth/);
});

test('la timeline evita respuestas idénticas producidas por callbacks simultáneos', () => {
  assert.match(memory, /const recentTimelineReservations = new Map\(\)/);
  assert.match(memory, /reason:'recent_identical_message'/);
  assert.match(html, /if \(persistedUser\.duplicate\)/);
  assert.match(memory, /const sameContent = previous/);
});

test('el aprendizaje histórico queda visible desde el centro y el menú principal', () => {
  assert.match(memory, /Aprender de mis chats/);
  assert.match(memory, /Sincronizar/);
  assert.match(memory, /Segmentar/);
  assert.match(memory, /Aprobar/);
  assert.match(memory, /Aprendizaje histórico/);
});

test('el renderer conserva jerarquía rica y lectura móvil', () => {
  assert.match(html, /yarbi-content-heading-1/);
  assert.match(html, /yarbi-content-checklist/);
  assert.match(html, /yarbi-content-table-wrap/);
  assert.match(html, /yarbi-content-panel-warning/);
  assert.match(html, /font-size:16px;line-height:1\.62/);
});
