'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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

test('Preview Gemini reports configuration failures separately from authenticated conversation failures', async () => {
  const frontend = read('frontend/index.html');
  const start = frontend.indexOf('async function gfcCallGeminiAPI');
  const end = frontend.indexOf('async function gfcTestGeminiConnection', start);
  assert.ok(start >= 0 && end > start);
  const block = frontend.slice(start, end);
  const diagnostics = [];
  const context = {
    gfcSupabaseAuthConfig: async () => ({ ownerConversationEnabled:true }),
    gfcCallAuthenticatedOwnerConversation: async () => { throw new TypeError('synthetic fetch failure'); },
    gfcChatDiag: (name, detail) => diagnostics.push({ name, detail }),
    gfcAccountFreshAccessToken: async () => '',
    GEMINI_URL: () => '/api/assistant/chat',
    fetch: async () => { throw new Error('unexpected legacy path'); },
    JSON, String, Number, Boolean, Array, Object
  };
  vm.runInNewContext(`${block}; globalThis.__call = gfcCallGeminiAPI;`, context);
  const conversationFailure = await context.__call('unused', { contents:[] });
  assert.equal(conversationFailure.message, 'No se pudo completar la consulta autenticada de Yarbi.');
  assert.equal(conversationFailure.status, 0);
  assert.equal(diagnostics[0].name, 'owner-conversation-exception');
  assert.equal(diagnostics[0].detail.category, 'network_error');

  context.gfcSupabaseAuthConfig = async () => { throw new Error('synthetic config failure'); };
  const configFailure = await context.__call('unused', { contents:[] });
  assert.equal(configFailure.message, 'No está disponible la configuración aislada de Yarbi.');
  assert.equal(diagnostics[1].name, 'isolated-config-unavailable');
});

test('Preview conversation retries once after an expired session and explains a remaining 401', async () => {
  const frontend = read('frontend/index.html');
  const start = frontend.indexOf('async function gfcCallAuthenticatedOwnerConversation');
  const end = frontend.indexOf('async function gfcCallGeminiAPI', start);
  assert.ok(start >= 0 && end > start);
  const calls = [];
  let renewed = 'fresh';
  const context = {
    window: { gfcRuntimeApiOrigin: () => 'https://preview.example', YarbiOwnerConversationUi: { formatReply: data => data.reply } },
    gfcAccountFreshAccessToken: async options => options?.force ? renewed : 'old',
    gfcOwnerConversationToken: () => '',
    gfcSetOwnerConversationToken: () => {},
    fetch: async (_url, options) => {
      calls.push(options.headers.Authorization);
      return calls.length === 1 || renewed === 'old'
        ? { status:401, ok:false, json:async () => ({ error:'owner_reference_unauthorized' }) }
        : { status:200, ok:true, json:async () => ({ ok:true, reply:'OK' }) };
    },
    JSON, String, Number, Boolean, Array, Object
  };
  vm.runInNewContext(`${frontend.slice(start, end)}; globalThis.__call = gfcCallAuthenticatedOwnerConversation;`, context);
  const payload = { contents:[{ role:'user', parts:[{ text:'Di OK' }] }] };
  const success = await context.__call(payload);
  assert.equal(success.ok, true);
  assert.equal(success.text, 'OK');
  assert.deepEqual(calls, ['Bearer old', 'Bearer fresh']);
  calls.length = 0;
  renewed = 'old';
  const failure = await context.__call(payload);
  assert.equal(failure.status, 401);
  assert.match(failure.message, /Cuenta de Yarbi/);
  assert.deepEqual(calls, ['Bearer old']);
});

test('Preview conversation replaces an expired continuity token without dropping the question', async () => {
  const frontend = read('frontend/index.html');
  const start = frontend.indexOf('async function gfcCallAuthenticatedOwnerConversation');
  const end = frontend.indexOf('async function gfcCallGeminiAPI', start);
  const requests = [];
  let cleared = 0;
  let stored = '';
  const context = {
    window: { gfcRuntimeApiOrigin: () => 'https://preview.example', YarbiOwnerConversationUi: { formatReply: data => data.reply } },
    gfcAccountFreshAccessToken: async () => 'owner-session',
    gfcOwnerConversationToken: () => 'expired-token',
    gfcClearOwnerConversationToken: () => { cleared += 1; },
    gfcSetOwnerConversationToken: token => { stored = token; },
    fetch: async (_url, options) => {
      const body = JSON.parse(options.body);
      requests.push({ body, authorization:options.headers.Authorization });
      return requests.length === 1
        ? { status:400, ok:false, json:async () => ({ error:'conversation_token_expired' }) }
        : { status:200, ok:true, json:async () => ({ ok:true, reply:'OK', conversation_token:'new-token' }) };
    },
    JSON, String, Number, Boolean, Array, Object
  };
  vm.runInNewContext(`${frontend.slice(start, end)}; globalThis.__call = gfcCallAuthenticatedOwnerConversation;`, context);
  const result = await context.__call({ contents:[{ role:'user', parts:[{ text:'Di OK' }] }] });
  assert.equal(result.ok, true);
  assert.equal(result.text, 'OK');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].body.conversation_token, 'expired-token');
  assert.equal(requests[1].body.conversation_token, '');
  assert.equal(requests[1].body.utterance, 'Di OK');
  assert.equal(requests[1].authorization, 'Bearer owner-session');
  assert.equal(cleared, 1);
  assert.equal(stored, 'new-token');
});

test('public Preview auth bootstrap bypasses the session bridge while protected preferences remain gated', () => {
  const frontend = read('frontend/index.html');
  const start = frontend.indexOf('function gfcRequiresSessionBridge');
  const end = frontend.indexOf('window.fetch = async function gfcSessionAuthenticatedFetch', start);
  assert.ok(start >= 0 && end > start);
  const context = {
    window: { location:{ origin:'https://preview.example', href:'https://preview.example/' }, gfcRuntimeApiOrigin:() => 'https://preview.example' },
    GFC_SESSION_AUTH_ROUTES: ['/api/assistant/preferences'], URL, String
  };
  vm.runInNewContext(`${frontend.slice(start, end)}; globalThis.__requires = gfcRequiresSessionBridge;`, context);
  assert.equal(context.__requires('/api/assistant/preferences?action=auth-config'), false);
  assert.equal(context.__requires('/api/assistant/preferences?action=auth-config&extra=1'), true);
  assert.equal(context.__requires('/api/assistant/preferences?action=auth-config', { method:'POST' }), true);
  assert.equal(context.__requires('/api/assistant/preferences?action=account-settings'), true);
});

test('magic link requests carry the Preview redirect in the Supabase query and web returns locally', async () => {
  const frontend = read('frontend/index.html');
  const redirectStart = frontend.indexOf('function gfcAccountRedirectUri');
  const redirectEnd = frontend.indexOf('const GFC_ACCOUNT_STATUS_KEY', redirectStart);
  const requestStart = frontend.indexOf('async function gfcAccountRequestCode');
  const requestEnd = frontend.indexOf('function gfcAccountHandleSupabaseDeepLink', requestStart);
  assert.ok(redirectStart >= 0 && redirectEnd > redirectStart && requestStart >= 0 && requestEnd > requestStart);
  const calls = [];
  const context = {
    window:{ location:{ origin:'https://preview.example' }, gfcRuntimeApiOrigin:() => 'https://preview.example', Capacitor:{ getPlatform:() => 'web' } },
    document:{ getElementById:() => ({ value:'owner@example.com' }) },
    gfcSupabaseAuthRequest:async (path, body) => { calls.push({ path, body }); return { data:{} }; },
    gfcAccountSetStatus:() => {},
    localStorage:{ setItem:() => {} },
    GFC_ACCOUNT_EMAIL_KEY:'email',
    encodeURIComponent, String
  };
  vm.runInNewContext(`${frontend.slice(redirectStart, redirectEnd)}; ${frontend.slice(requestStart, requestEnd)}; globalThis.__redirect=gfcAccountRedirectUri; globalThis.__request=gfcAccountRequestCode;`, context);
  assert.equal(context.__redirect(), 'https://preview.example/');
  await context.__request();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, 'otp?redirect_to=https%3A%2F%2Fpreview.example%2F');
  assert.equal(calls[0].body.redirect_to, undefined);
  context.window.Capacitor.getPlatform = () => 'android';
  assert.equal(context.__redirect(), 'https://preview.example/auth/callback');
  assert.match(frontend, /webAuthParams\.has\('access_token'\)/);
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
