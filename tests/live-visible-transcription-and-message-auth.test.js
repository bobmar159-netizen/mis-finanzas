'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'index.html'), 'utf8');

function between(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.notEqual(from, -1, `missing start marker: ${start}`);
  assert.notEqual(to, -1, `missing end marker: ${end}`);
  return source.slice(from, to);
}

test('WhatsApp recent-message reads use the fresh authenticated owner session', () => {
  const block = between('async function gfcFetchCloudWhatsAppMessages', 'function gfcIsWhatsAppVoiceNote');
  assert.match(block, /await gfcAccountFreshAccessToken\(\)/);
  assert.match(block, /Authorization: 'Bearer ' \+ accessToken/);
  assert.doesNotMatch(block, /X-Assistant-Token/);
  assert.match(block, /owner_session_required/);
  assert.match(block, /no inventes mensajes/i);
});

test('Gemini Live enables visible output transcription with the current API contract', () => {
  const block = between('const setupMessage =', 'socket.send(JSON.stringify(setupMessage))');
  assert.match(block, /inputAudioTranscription: \{ languageCodes: \['es-PE'\] \}/);
  assert.match(block, /outputAudioTranscription: \{\}/);
  assert.doesNotMatch(block, /outputAudioTranscription: \{ languageCodes:/);
});

test('Gemini Live output transcript reaches the visible draft and final persistence', () => {
  const receiveStart = source.lastIndexOf('socket.onmessage = async event =>');
  const receiveEnd = source.indexOf('socket.onerror =', receiveStart);
  assert.notEqual(receiveStart, -1);
  assert.notEqual(receiveEnd, -1);
  const receive = source.slice(receiveStart, receiveEnd);
  const commit = between('function gfcCommitLiveTurn(session)', 'function gfcClearLiveMemory()');
  assert.match(receive, /content\.outputTranscription\?\.text/);
  assert.match(receive, /gfcUpdateLiveTranscriptDraft\('assistant', session\.outputBuffer, session\.liveTurnId\)/);
  assert.match(commit, /gfcPersistLiveFinal\('assistant', output, committedTurnId/);
});
