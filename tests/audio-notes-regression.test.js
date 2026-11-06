const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('YCloud audio link is preferred and authenticated before Meta fallback', () => {
  const webhook = read('api/webhook.js');
  const ycloudBranch = webhook.indexOf('if (isTrustedYCloudMediaLink(media.link))');
  const metaBranch = webhook.indexOf('if (media.id && META_ACCESS_TOKEN)');
  assert.ok(ycloudBranch >= 0, 'missing YCloud media link branch');
  assert.ok(metaBranch > ycloudBranch, 'Meta fallback must run after YCloud link');
  assert.match(webhook, /'X-API-Key': YCLOUD_API_KEY/);
  assert.match(webhook, /url\.hostname === 'api\.ycloud\.com'/);
});

test('voice notes become concise CRM summaries instead of literal transcripts', () => {
  const webhook = read('api/webhook.js');
  assert.match(webhook, /Resume únicamente lo importante para CRM y seguimiento/);
  assert.match(webhook, /No transcribas literalmente, no inventes datos/);
  assert.match(webhook, /resumen, servicio, fecha, hora, ubicacion, precio, compromiso, pendiente, intencion/);
  assert.doesNotMatch(webhook, /Transcribe exactamente el siguiente audio/);
  assert.match(webhook, /Nota de voz del ' \+ role/);
});

test('relative dates from WhatsApp are anchored to Lima rather than UTC', () => {
  const webhook = read('api/webhook.js');
  assert.match(webhook, /timeZone: 'America\/Lima'/);
  assert.doesNotMatch(webhook, /const currentDateStr = new Date\(\)\.toISOString\(\)\.split\('T'\)\[0\]/);
});

test('Yarbi can retrieve a stored voice-note summary and retry a pending audio explicitly', () => {
  const webhook = read('api/webhook.js');
  const frontend = read('index.html');
  assert.match(webhook, /retryStoredWhatsAppAudioSummary/);
  assert.match(webhook, /action \|\| ''\) === 'summarize-voice-note'/);
  assert.match(webhook, /if \(!hasAssistantAccess\(req\)\) return res\.status\(401\)/);
  assert.match(webhook, /audio_summary_status: 'ready'/);
  assert.match(frontend, /name: 'get_whatsapp_voice_notes'/);
  assert.match(frontend, /function gfcFetchWhatsAppVoiceNotes/);
  assert.match(frontend, /action: 'summarize-voice-note'/);
  assert.match(frontend, /WHATSAPP_AUDIO_RETRIEVAL_V2/);
  assert.match(frontend, /usa obligatoriamente get_whatsapp_voice_notes/);
});

test('voice-note lookup uses verified client identity and delays sync until a local miss', () => {
  const frontend = read('index.html');
  const start = frontend.indexOf('async function gfcFetchWhatsAppVoiceNotes');
  const end = frontend.indexOf('function gfcYarbiMinutesFromHint', start);
  const block = frontend.slice(start, end);
  assert.match(block, /gfcResolveLocalClientIdentity\(\{ client_name: clientName, phone: explicitPhone \}\)/);
  assert.match(block, /let result = await gfcFetchCloudWhatsAppMessages/);
  assert.match(block, /if \(!notes\.length && navigator\.onLine\)/);
  assert.match(block, /voice-note-miss-recovery/);
  assert.match(block, /verified_local_identity: identityResolution \|\| null/);
  assert.doesNotMatch(block, /if \(navigator\.onLine\) await gfcSyncYarbiLocalMirror\(\{ reason: 'voice-note-query' \}\)/);
});

test('pending voice notes always reach a terminal diagnostic state', () => {
  const webhook = read('api/webhook.js');
  assert.match(webhook, /markStoredWhatsAppAudioSummaryFailure/);
  assert.match(webhook, /audio_summary_status: status/);
  assert.match(webhook, /unavailable \? 'unavailable' : 'failed'/);
  assert.match(webhook, /recorded_status: recorded\.status/);
});
test('coexistence history accepts both inbound and outbound YCloud payloads', () => {
  const webhook = read('api/webhook.js');
  assert.match(webhook, /body\.whatsappMessage \|\| body\.whatsappInboundMessage/);
  assert.match(webhook, /direction === 'outgoing' \? 'el dueño del negocio' : 'un cliente'/);
});

test('voice loudness matching is output-only, bounded, and keeps the VAD untouched', () => {
  const frontend = read('index.html');
  assert.match(frontend, /VOICE_LEVEL_MATCH_V1/);
  assert.match(frontend, /function gfcUpdateLiveVoiceOutputLevel/);
  assert.match(frontend, /Math\.min\(1\.35, Math\.max\(1, ratio\)/);
  assert.match(frontend, /Math\.min\(1, gfcGetYarbiLiveVolume\(\) \* compensation\)/);
  assert.match(frontend, /automaticActivityDetection: \{ disabled: true \}/);
});

test('three exact local voice commands switch mode and greet with the new voice', () => {
  const frontend = read('index.html');
  assert.match(frontend, /\(mentor\|comercial\|copiloto\)/);
  assert.match(frontend, /match\[1\] === 'comercial'\) return 'crm'/);
  assert.match(frontend, /match\[1\] === 'copiloto'\) return 'copilot'/);
  assert.match(frontend, /gfcApplyYarbiMode\(modeId, 'voice-command'\)/);
  assert.match(frontend, /modeGreeting: voiceCommand \? mode\.greeting : ''/);
  assert.match(frontend, /Responde exactamente con esta frase y nada más/);
  assert.match(frontend, /if \(!voiceCommand\) toast/);
  assert.match(frontend, /VOICE_MODE_COMMANDS_V1/);
});
