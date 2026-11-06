'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const voice = require('../lib/yarbi-app-voice-policy');

test('F07 normaliza una transcripción sin conservar audio y aplica el límite de duración', () => {
  assert.deepEqual(voice.transcript('  ¿Qué   tengo mañana?  '), { ok: true, text: '¿Qué tengo mañana?' });
  assert.equal(voice.transcript(' ').code, 'voice_transcript_empty');
  assert.equal(voice.recordingPolicy({ durationMs: 1200, mimeType: 'audio/webm', sizeBytes: 800 }).retention, 'no_audio_persistence');
  assert.equal(voice.recordingPolicy({ durationMs: voice.MAX_VOICE_DURATION_MS + 1 }).code, 'voice_duration_limit');
});

test('F07 clasifica permisos, cancelación, dispositivo y conexión sin inventar una transcripción', () => {
  assert.deepEqual(voice.recognitionError('not-allowed'), { code: 'voice_permission_denied', retryable: false });
  assert.deepEqual(voice.recognitionError('aborted'), { code: 'voice_no_speech', retryable: true });
  assert.deepEqual(voice.recognitionError('network'), { code: 'voice_connection_lost', retryable: true });
  assert.deepEqual(voice.recognitionError('audio-capture'), { code: 'voice_device_unavailable', retryable: true });
});

test('F07 detecta propuestas de instrucción y consultas de memoria sin convertirlas en acciones comerciales', () => {
  assert.equal(voice.isInstructionUtterance('Yarbi, recuerda que prefiero respuestas cortas'), true);
  assert.equal(voice.isInstructionListUtterance('¿Qué cosas te he enseñado?'), true);
  assert.equal(voice.isInstructionUtterance('Agenda una visita para Carlos'), false);
});
