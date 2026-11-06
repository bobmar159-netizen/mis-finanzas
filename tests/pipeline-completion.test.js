const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('new WhatsApp message uses the same priority field on producer and consumer', () => {
  const webhook = read('api/webhook.js');
  const processor = read('api/ai/process.js');
  assert.match(webhook, /priority_message_id: messageId/);
  assert.match(processor, /body\.priority_message_id \|\| body\.trigger_message_id/);
  assert.match(processor, /p_priority_message_id: priorityMessageId \|\| null/);
});

test('voice note failures remain diagnostic and are requeued only after a real summary', () => {
  const webhook = read('api/webhook.js');
  assert.match(webhook, /audio_summary_error_code/);
  assert.match(webhook, /audio_summary_status: status/);
  assert.match(webhook, /unavailable \? 'unavailable' : 'failed'/);
  assert.match(webhook, /await requeueCanonicalAnalysis\(id\)/);
  assert.match(webhook, /audioSummaryStatus !== 'pending'/);
  assert.match(webhook, /scheduleStoredVoiceNoteRetry\(messageId\)/);
});

test('manual recovery retries only failed analyses and pending voice notes', () => {
  const processor = read('api/ai/process.js');
  assert.match(processor, /body\.action === 'recover'/);
  assert.match(processor, /ai_message_analysis\?status=eq\.failed/);
  assert.match(processor, /audio_summary_status=in\.%28pending%2Cfailed%29/);
  assert.match(processor, /action: 'summarize-voice-note'/);
  assert.match(processor, /requested_by: String\(requestedBy \|\| 'yarbi-recovery'\)/);
});

test('client memory exposes a consolidated dossier and the form consumes it', () => {
  const memory = read('lib/whatsapp-messages.js');
  const frontend = read('index.html');
  assert.match(memory, /buildClientDossier/);
  assert.match(memory, /dossier: buildClientDossier\(payload\)/);
  assert.match(frontend, /const dossier = verifiedMemory\?\.dossier \|\| \{\}/);
  assert.match(frontend, /stored\.price \?\? dossier\.price/);
  assert.match(frontend, /dossier\.maps_url/);
  assert.match(frontend, /dossier\.appointment_date/);
});

test('later client agenda messages create alerts but never mutate the agenda automatically', () => {
  const processor = read('api/ai/process.js');
  const block = processor.slice(processor.indexOf('function applyAgendaClientUpdate'), processor.indexOf('async function createAgendaEvent'));
  assert.match(block, /agenda_confirmed_by_client/);
  assert.match(block, /agenda_cancel_requested/);
  assert.match(block, /agenda_reschedule_requested/);
  assert.match(block, /La agenda original no fue modificada/);
  assert.doesNotMatch(block, /agenda_events[^\n]+PATCH|DELETE/);
});

test('local mirror refreshes on startup, resume, online and visible interval', () => {
  const frontend = read('index.html');
  const start = frontend.indexOf('function gfcStartYarbiBackgroundSync');
  const block = frontend.slice(start, frontend.indexOf('function gfcYarbiLocalNormalize', start));
  assert.match(block, /gfcRunYarbiBackgroundSync\('startup'\)/);
  assert.match(block, /gfcRunYarbiBackgroundSync\('resume'\)/);
  assert.match(block, /gfcRunYarbiBackgroundSync\('online'\)/);
  // La frecuencia normal se conserva en 30 s. Solo cuando CRM/Yarbi está
  // abierto se usa la réplica incremental de 12 s para priorizar el contexto
  // del cliente activo sin gastar recursos en el resto de la aplicación.
  assert.match(block, /gfcYarbiFastCrmSyncActive\(\) \? 12000 : 30000/);
  assert.match(block, /document\.visibilityState !== 'visible'/);
});
