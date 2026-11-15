const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const frontend = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function loadStatusLabel() {
  const start = frontend.indexOf('// BACKGROUND_PROCESSING_STATUS_V1');
  const end = frontend.indexOf('async function gfcHandleLiveToolCalls', start);
  const context = {};
  vm.createContext(context);
  vm.runInContext(frontend.slice(start, end), context);
  return context.gfcLiveToolStatusLabel;
}

test('processing status: structured reads are labeled as consultation, not reprocessing', () => {
  const label = loadStatusLabel();
  assert.equal(label([{ name:'get_client_memory' }]), 'Consultando datos ya procesados...');
  assert.equal(label([{ name:'get_agenda_summary' }, { name:'get_proactive_alerts' }]), 'Consultando datos ya procesados...');
});

test('processing status: write-capable tools use a distinct execution label', () => {
  const label = loadStatusLabel();
  assert.equal(label([{ name:'record_daily_outcome' }]), 'Ejecutando la solicitud...');
});

test('processing status: manual update downloads the mirror and never starts AI analysis', () => {
  const start = frontend.indexOf('async function gfcProcessYarbiInformation');
  const end = frontend.indexOf('function gfcOpenCopilotModal', start);
  const block = frontend.slice(start, end);
  assert.match(block, /gfcSyncYarbiLocalMirror\(\{ reason: 'manual-download', backfill: true \}\)/);
  assert.doesNotMatch(block, /requested_by|action:\s*'process'|Gemini.*proces/i);
  assert.match(block, /gfcAccountFreshAccessToken\(\)/);
  assert.doesNotMatch(block, /X-Assistant-Token/);
});

test('processing status: current installs do not require the retired client token', () => {
  const start = frontend.indexOf('async function gfcRefreshYarbiProcessingStatus');
  const end = frontend.indexOf('async function gfcLearnHistoricalReplyStyle', start);
  const block = frontend.slice(start, end);
  assert.doesNotMatch(block, /Configura el token para sincronizar/);
  assert.match(block, /gfcYarbiLocalStatusRead\(\)/);
});

test('WhatsApp cloud polling uses the authenticated Supabase session', () => {
  const start = frontend.indexOf('async function gfcPollWhatsappNotifications');
  const end = frontend.indexOf('function gfcCheckPendingLaunchPayload', start);
  const block = frontend.slice(start, end);
  assert.match(block, /gfcAccountFreshAccessToken\(\)/);
  assert.match(block, /Authorization:\s*'Bearer '\s*\+\s*accessToken/);
  assert.doesNotMatch(block, /X-Assistant-Token/);
});

test('native notification capture is queued locally before authenticated canonical sync', () => {
  const start = frontend.indexOf('const GFC_WHATSAPP_NOTIFICATION_OUTBOX_KEY');
  const end = frontend.indexOf('// Deduplicar sugerencias al arrancar', start);
  const block = frontend.slice(start, end);
  assert.match(block, /GFC_WHATSAPP_NOTIFICATION_OUTBOX_KEY/);
  assert.match(block, /gfcAccountFreshAccessToken\(\)/);
  assert.match(block, /\/api\/whatsapp\/messages\?action=local-ingest/);
  assert.match(block, /acknowledge_local_capture:\s*true/);
  assert.match(block, /needs_contact_confirmation/);
  assert.doesNotMatch(block, /X-Assistant-Token/);
});

test('WhatsApp history fallbacks use the authenticated owner session, never the retired token', () => {
  const searchStart = frontend.indexOf('async function gfcSearchClientHistoryByClues');
  const searchEnd = frontend.indexOf('async function gfcBuildVerifiedAgendaSummary', searchStart);
  const search = frontend.slice(searchStart, searchEnd);
  assert.match(search, /await gfcAccountFreshAccessToken\(\)/);
  assert.match(search, /Authorization:\s*'Bearer '\s*\+\s*token/);
  assert.doesNotMatch(search, /X-Assistant-Token/);

  const chatStart = frontend.indexOf('// Cargar contexto en tiempo real desde Supabase & Memoria Local');
  const chatEnd = frontend.indexOf('const ownerInstructionContext', chatStart);
  const chat = frontend.slice(chatStart, chatEnd);
  assert.match(chat, /cloudAccessToken\s*=\s*await gfcAccountFreshAccessToken\(\)/);
  assert.match(chat, /Authorization:\s*'Bearer '\s*\+\s*cloudAccessToken/);
  assert.doesNotMatch(chat, /X-Assistant-Token/);
});

test('WhatsApp reads distinguish an empty authorized scope from locally captured notifications', () => {
  const start = frontend.indexOf('function gfcLocalNotificationMessages');
  const end = frontend.indexOf('function gfcIsWhatsAppVoiceNote', start);
  const block = frontend.slice(start, end);
  assert.match(block, /source:\s*'android-notification-local'/);
  assert.match(block, /Solo incluye notificaciones de WhatsApp Business capturadas/);
  assert.match(block, /no_synchronized_messages_for_authorized_scope/);
  assert.match(block, /Esto no demuestra que WhatsApp no tenga mensajes/);
});

test('processing status: real background work remains visible as background', () => {
  const start = frontend.indexOf('function gfcSetYarbiProcessingUi');
  const end = frontend.indexOf('async function gfcRefreshYarbiProcessingStatus', start);
  const block = frontend.slice(start, end);
  assert.match(block, /chat\(s\) en segundo plano/);
  assert.match(block, /chat\(s\) pendientes · proceso automático/);
  assert.match(block, /Yarbi al día · chats y memoria local/);
});
