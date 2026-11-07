'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('F01: Live token validates a Supabase session and no longer accepts an assistant static token', () => {
  const handler = read('api_handlers/assistant/live-token.js');
  assert.match(handler, /authenticatedOwnerIdentity\(req, runtime\)/);
  assert.match(handler, /requirePublicAuth: true/);
  assert.equal(handler.includes('ASSISTANT_API_TOKEN'), false);
  assert.equal(handler.includes('X-Assistant-Token'), false);
  assert.equal(handler.includes("Access-Control-Allow-Origin', process.env.APP_ORIGIN || '*"), false);
});

test('F01: the browser requests Gemini Live credentials with its authenticated session', () => {
  const frontend = read('frontend/index.html');
  const start = frontend.indexOf('async function gfcGetGeminiLiveToken()');
  const end = frontend.indexOf('function gfcLiveCaptureDiagnostics', start);
  assert.ok(start >= 0 && end > start);
  const block = frontend.slice(start, end);
  assert.match(block, /await gfcAccountFreshAccessToken\(\)/);
  assert.match(block, /Authorization: 'Bearer ' \+ token/);
  assert.equal(block.includes('X-Assistant-Token'), false);
});

test('F01: the account vault will not sync Gemini, voice-provider or assistant credentials', () => {
  const handler = read('api_handlers/assistant/preferences.js');
  const vaultStart = handler.indexOf('function safeVaultSecrets');
  const vaultEnd = handler.indexOf('function encryptVault', vaultStart);
  const vault = handler.slice(vaultStart, vaultEnd);
  assert.equal(vault.includes('geminiKey'), false);
  assert.equal(vault.includes('assistantToken'), false);
  assert.equal(vault.includes('elevenKey'), false);
});

test('F01: legacy Gemini requests are routed to the authenticated server proxy', () => {
  const frontend = read('frontend/index.html');
  assert.match(frontend, /const GEMINI_URL = \(\) => window\.gfcRuntimeApiOrigin\(\) \+ '\/api\/assistant\/gemini'/);
  assert.match(frontend, /async function gfcSecureGeminiFetch/);
  assert.match(frontend, /Authorization: 'Bearer ' \+ accessToken/);
  assert.equal(frontend.includes('https://generativelanguage.googleapis.com'), false);
  assert.equal(frontend.includes('GEMINI_ANALYSIS_URL'), false);
  const proxy = read('api_handlers/assistant/gemini.js');
  assert.match(proxy, /authenticatedOwnerIdentity\(req, config\)/);
  assert.match(proxy, /MAX_INLINE_BYTES/);
  assert.equal(proxy.includes('ASSISTANT_API_TOKEN'), false);
});

test('F01: chat and command use the same authenticated session boundary as Gemini Live', () => {
  const chat = read('api_handlers/assistant/chat.js');
  const command = read('api_handlers/assistant/command.js');
  for (const handler of [chat, command]) {
    assert.match(handler, /authenticatedOwnerIdentity\(req, runtime\)/);
    assert.match(handler, /requirePublicAuth: true/);
    assert.equal(handler.includes('ASSISTANT_API_TOKEN'), false);
    assert.equal(handler.includes('X-Assistant-Token'), false);
  }
  const frontend = read('frontend/index.html');
  const chatStart = frontend.indexOf('async function gfcCallGeminiAPI');
  const commandStart = frontend.indexOf('async function gfcTryYarbiCommand');
  const commandEnd = frontend.indexOf('function gfcOpenAgendaFormContext', commandStart);
  const chatBlock = frontend.slice(chatStart, frontend.indexOf('async function gfcTestGeminiConnection', chatStart));
  const commandBlock = frontend.slice(commandStart, commandEnd);
  for (const block of [chatBlock, commandBlock]) {
    assert.match(block, /await gfcAccountFreshAccessToken\(\)/);
    assert.match(block, /Authorization: 'Bearer ' \+ token/);
    assert.equal(block.includes('X-Assistant-Token'), false);
  }
});

test('F01: processor and Gemini endpoints emit only sanitized operational errors', () => {
  const processor = read('api/ai/process.js');
  const chat = read('api_handlers/assistant/chat.js');
  assert.equal(processor.includes("console.log('[AI QUEUE CONTINUATION]', response.status, JSON.stringify(result))"), false);
  assert.equal(processor.includes("console.error('[AI PROCESS ERROR]', error)"), false);
  assert.equal(processor.includes("console.error('[AI PROCESS RECOVERY ERROR]', recoveryError)"), false);
  assert.equal(chat.includes("console.error('[ASSISTANT CHAT]', error)"), false);
  assert.equal(chat.includes('data?.error?.message'), false);
});

test('F01: ElevenLabs and browser TTS are retired without leaving a direct provider route', () => {
  const frontend = read('frontend/index.html');
  const voiceUi = read('frontend/yarbi-app-voice.js');
  assert.equal(frontend.includes('https://api.elevenlabs.io'), false);
  assert.match(frontend, /function gfcRetireClientAiCredentials\(\)/);
  assert.match(frontend, /ElevenLabs ya no está disponible/);
  assert.equal((frontend.match(/fnz_eleven_key/g) || []).length, 1, 'only the startup cleanup may reference the retired key');
  assert.equal(frontend.includes('speechSynthesis.speak'), false);
  assert.equal(frontend.includes('YarbiTts.speak'), false);
  assert.equal(voiceUi.includes('speechSynthesis'), false);
  assert.equal(voiceUi.includes('YarbiTts'), false);
});
