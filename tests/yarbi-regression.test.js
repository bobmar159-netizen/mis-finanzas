const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('P0: supabase-secure authenticates before selecting an action', () => {
  const source = read('api/supabase-secure.js');
  const auth = source.indexOf("if (!expected || token !== expected) return res.status(401)");
  const action = source.indexOf('const { action } = req.query;');
  assert.ok(auth >= 0, 'missing global assistant-token validation');
  assert.ok(action >= 0 && auth < action, 'authorization must run before any action');
});

test('P0: notion proxy requires the Yarbi token', () => {
  const source = read('api/notion-proxy.js');
  assert.match(source, /x-assistant-token/);
  assert.match(source, /expectedAssistantToken/);
  assert.match(source, /status\(401\)/);
});

test('P1: canonical agenda checks the same contact, type and time slot', () => {
  const source = read('api/actions/approve.js');
  assert.match(source, /dedupe_key=eq/);
  assert.match(source, /contact_id=eq/);
  assert.match(source, /event_type=eq/);
  assert.match(source, /starts_at=eq/);
  assert.match(source, /source=eq\.yarbi_form/);
});

test('Safety: background analysis proposes agenda instead of creating it', () => {
  const source = read('api/ai/process.js');
  const functionBody = source.slice(source.indexOf('async function createAgendaEvent'), source.indexOf('async function createIntelligentAlert'));
  assert.match(functionBody, /requires_review: true/);
  assert.doesNotMatch(functionBody, /\/rest\/v1\/agenda_events/);
});

test('Fast path: stale local snapshots refresh in the background', () => {
  const source = read('www/index.html');
  const memoryBlock = source.slice(source.indexOf('async function gfcYarbiLocalFindMemory'), source.indexOf('async function gfcYarbiLocalMessages'));
  const messagesBlock = source.slice(source.indexOf('async function gfcYarbiLocalMessages'), source.indexOf('const GFC_CLIENT_MEMORY_CACHE_KEY'));
  assert.match(memoryBlock, /memory-query-background/);
  assert.match(messagesBlock, /messages-query-background/);
  assert.doesNotMatch(memoryBlock, /await gfcYarbiLocalEnsureFresh\('memory-query'\)/);
  assert.doesNotMatch(messagesBlock, /await gfcYarbiLocalEnsureFresh\('messages-query'\)/);
});
test('Identity: ambiguous clients expose only the final three phone digits', () => {
  const frontend = read('www/index.html');
  const backend = read('lib/whatsapp-messages.js');
  assert.match(frontend, /phone_last3: phone\.slice\(-3\)/);
  assert.match(backend, /phone_last3: String\(phoneByContact\.get\(Number\(contact\.id\)\) \|\| ''\)\.slice\(-3\)/);
  assert.doesNotMatch(backend, /candidates: contacts\.map\(\(contact\) => \(\{[^}]*phone: phoneByContact/s);
});
test('Processing status identifies a Gemini quota blocker without exposing the raw error', () => {
  const backend = read('api/ai/process.js');
  const frontend = read('www/index.html');
  assert.match(backend, /blocker === 'gemini_quota'/);
  assert.match(backend, /Gemini no tiene cuota disponible para procesar mensajes/);
  assert.match(frontend, /Gemini sin cuota: procesamiento en pausa/);
});
test('WhatsApp sends fail closed when official Meta credentials are absent', () => {
  const backend = read('api/assistant/send-whatsapp.js');
  const frontend = read('www/index.html');
  assert.match(backend, /whatsapp_not_configured/);
  assert.match(backend, /explicit_confirmation_required/);
  assert.match(frontend, /No envie nada; falta conectar la cuenta oficial de Meta/);
});
test('WhatsApp confirmations do not repeat a full client phone number', () => {
  const frontend = read('www/index.html');
  assert.match(frontend, /WhatsApp al numero que termina en/);
  assert.match(frontend, /pending\.phone\)\.replace\(\/\\D\/g, ''\)\.slice\(-3\)/);
  assert.doesNotMatch(frontend, /Listo, envi[^\n]*WhatsApp a ' \+ pending\.phone/);
});
test('Account recovery restores remote preferences before an empty install can synchronize', () => {
  const frontend = read('www/index.html');
  const recovery = frontend.slice(frontend.indexOf('async function gfcAccountRestoreBeforeSync'), frontend.indexOf('function gfcAccountSetStatus'));
  const deepLink = frontend.slice(frontend.indexOf('function gfcAccountHandleSupabaseDeepLink'), frontend.indexOf('function gfcAccountVerifyCode'));
  assert.match(recovery, /gfcAccountSettingsRestore\(\)/);
  assert.match(recovery, /if \(restored\?\.hasSettings\)/);
  assert.match(recovery, /await gfcAccountSettingsSync\(\)/);
  assert.match(deepLink, /await gfcAccountRestoreBeforeSync\(\)/);
  assert.doesNotMatch(deepLink, /await gfcAccountSettingsSync\(\)/);
});
test('Privacy: shipped frontends do not embed a financial preset', () => {
  for (const file of ['index.html', 'www/index.html']) {
    const source = read(file);
    assert.match(source, /const PRESET_DEFAULT_DATA\s*=\s*null;/);
    assert.doesNotMatch(source, /const PRESET_DEFAULT_DATA\s*=\s*\{/s);
  }
});
test('P1: every active agenda creation path waits for canonical Supabase confirmation', () => {
  const frontend = read('www/index.html');
  const helper = frontend.slice(frontend.indexOf('function gfcSyncAgendaItemToSupabase'), frontend.indexOf('function saveAgendaItem'));
  const voice = frontend.slice(frontend.indexOf('function saveAgendaVoz'), frontend.indexOf('// ─────────────────────────────────────────────\n// EXPORT / IMPORT'));
  const directStart = frontend.lastIndexOf('function _agendaMicGuardarDirecto');
  const direct = frontend.slice(directStart, frontend.indexOf('function npBuildLiveList', directStart));
  assert.match(helper, /sync\.supabase_agenda === true && sync\.agenda_event_id/);
  assert.match(helper, /_remoteSync: remoteOk \? 'synced' : 'pending_sync'/);
  assert.match(voice, /gfcSyncAgendaItemToSupabase\(item\.id, item\)/);
  assert.match(direct, /gfcSyncAgendaItemToSupabase\(item\.id, item\)/);
  assert.match(direct, /gfcFindAgendaDuplicate\(item\)/);
  assert.doesNotMatch(voice, /agregado por voz y sincronizado/);
});
test('P1: reprogramming and status changes target the existing canonical event', () => {
  const backend = read('api/actions/approve.js');
  const frontend = read('www/index.html');
  const backendUpsert = backend.slice(backend.indexOf('async function upsertCanonicalAgenda'), backend.indexOf('export default async function handler'));
  const reprogram = frontend.slice(frontend.indexOf('function confirmarReprogramacion'), frontend.indexOf('function _aplicarEstadoAgenda'));
  const status = frontend.slice(frontend.indexOf('function _aplicarEstadoAgenda'), frontend.indexOf('function isServicioFinalizado'));
  const voiceUpdate = frontend.slice(frontend.indexOf('function gfcApplyYarbiAgendaUpdate'), frontend.indexOf('function gfcApplyYarbiCommandResult'));
  assert.match(backendUpsert, /payload\.agenda_event_id/);
  assert.match(backendUpsert, /source=eq\.yarbi_form/);
  assert.match(backendUpsert, /Ya existe otro evento canónico con ese horario/);
  assert.match(frontend, /agenda_event_id: item\._remoteAgendaEventId \|\| null/);
  assert.match(reprogram, /gfcSyncAgendaItemToSupabase\(item\.id, item\)/);
  assert.match(status, /gfcSyncAgendaItemToSupabase\(item\.id, item\)/);
  assert.match(voiceUpdate, /gfcSyncAgendaItemToSupabase\(item\.id, item\)/);
  assert.match(frontend, /if \(\/cancel\|desanim\/\.test\(value\)\) return 'cancelled'/);
});
test('P1: pending agenda records retry safely after reconnecting', () => {
  const frontend = read('www/index.html');
  const retry = frontend.slice(frontend.indexOf('async function gfcRetryPendingAgendaSync'), frontend.indexOf('function saveAgendaItem'));
  assert.match(retry, /_remoteSync === 'pending_sync'/);
  assert.match(retry, /slice\(0, 20\)/);
  assert.match(retry, /await gfcSyncAgendaItemToSupabase\(item\.id, item, \{ silent: true \}\)/);
  assert.match(retry, /window\.addEventListener\('online'/);
  assert.match(retry, /gfcRetryPendingAgendaSync\('startup'\)/);
});
test('Forms: Yarbi opens the existing agenda form and does not claim Calendar confirmation early', () => {
  const frontend = read('www/index.html');
  const draft = frontend.slice(frontend.indexOf('function gfcApplyYarbiDraft'), frontend.indexOf('function gfcConfirmPendingYarbiForm'));
  const confirmationStart = frontend.indexOf('function gfcConfirmPendingYarbiForm');
  const confirmation = frontend.slice(confirmationStart, frontend.indexOf('window._gfcPendingOwnerInstruction', confirmationStart));
  assert.match(draft, /openAddAgenda\(tipo, null, preData\)/);
  assert.match(draft, /mapsUrl:/);
  assert.match(draft, /_gfcYarbiDraftMissing/);
  assert.match(confirmation, /guardado localmente/);
  assert.match(confirmation, /sincronizándolo con Supabase/);
  assert.doesNotMatch(confirmation, /confirmación para sincronizar Google Calendar/);
});
test('Background WhatsApp processing persists first and wakes the canonical queue', () => {
  const webhook = read('api/webhook.js');
  const persisted = webhook.indexOf('const whatsappSaveResponse = await fetch');
  const scheduled = webhook.indexOf('scheduleCanonicalProcessing(messageId)', persisted);
  assert.match(webhook, /const \{ waitUntil \} = require\('@vercel\/functions'\)/);
  assert.ok(persisted >= 0 && scheduled > persisted, 'processor must start only after canonical persistence');
  assert.match(webhook, /priority_message_id: messageId/);
  assert.match(webhook, /ENABLE_LEGACY_WEBHOOK_EXTRACTION && GEMINI_KEY/);
});

test('Manual Yarbi button downloads the local mirror and never starts AI processing', () => {
  const frontend = read('www/index.html');
  const block = frontend.slice(frontend.indexOf('async function gfcProcessYarbiInformation'), frontend.indexOf('function gfcOpenCopilotModal'));
  assert.match(block, /gfcSyncYarbiLocalMirror\(\{ reason: 'manual-download', backfill: true \}\)/);
  assert.doesNotMatch(block, /requested_by/);
  assert.doesNotMatch(block, /limit: 100/);
  assert.match(frontend, /Actualizar Yarbi/);
});

test('Local mirror preserves message direction and refreshes on startup, resume and online', () => {
  const backend = read('lib/whatsapp-messages.js');
  const frontend = read('www/index.html');
  assert.match(backend, /deleted_at,metadata&deleted_at=is\.null/);
  assert.match(frontend, /gfcRunYarbiBackgroundSync\('startup'\)/);
  assert.match(frontend, /gfcRunYarbiBackgroundSync\('resume'\)/);
  assert.match(frontend, /gfcRunYarbiBackgroundSync\('online'\)/);
});

test('Canonical analysis learns reply style but sending still requires explicit voice confirmation', () => {
  const processor = read('api/ai/process.js');
  const frontend = read('www/index.html');
  assert.match(processor, /loadReplyStyleContext/);
  assert.match(processor, /reply_style_patterns/);
  assert.match(processor, /suggested_reply/);
  assert.match(processor, /nunca lo inventes/);
  assert.match(frontend, /Preparar y confirmar por voz/);
  assert.match(frontend, /gfc_yarbi_pending_send/);
  assert.match(frontend, /sí, envíalo/);
});
