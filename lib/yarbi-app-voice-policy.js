'use strict';

const MAX_VOICE_DURATION_MS = 60 * 1000;
const MAX_TRANSCRIPT_LENGTH = 1200;

function text(value, limit = MAX_TRANSCRIPT_LENGTH) {
  return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function transcript(value) {
  const clean = text(value);
  return clean.length >= 2 ? { ok: true, text: clean } : { ok: false, code: 'voice_transcript_empty' };
}

function recordingPolicy({ durationMs, mimeType = '', sizeBytes = 0 } = {}) {
  const duration = Number(durationMs || 0);
  if (!Number.isFinite(duration) || duration < 0 || duration > MAX_VOICE_DURATION_MS) return { ok: false, code: 'voice_duration_limit' };
  // F07 retains no audio; these values are only diagnostics from browser/native APIs.
  return { ok: true, retention: 'no_audio_persistence', duration_ms: Math.floor(duration), mime_type: text(mimeType, 80) || null, size_bytes: Math.max(0, Number(sizeBytes) || 0) };
}

function recognitionError(error) {
  const code = text(error, 80).toLowerCase();
  if (['not-allowed', 'service-not-allowed', 'permission-denied'].includes(code)) return { code: 'voice_permission_denied', retryable: false };
  if (['no-speech', 'aborted'].includes(code)) return { code: 'voice_no_speech', retryable: true };
  if (['network', 'network-error'].includes(code)) return { code: 'voice_connection_lost', retryable: true };
  if (['audio-capture', 'device-not-found'].includes(code)) return { code: 'voice_device_unavailable', retryable: true };
  return { code: 'voice_transcription_unavailable', retryable: true };
}

function isInstructionUtterance(value) {
  return /\b(recuerda que|prefiero|a partir de ahora|de ahora en adelante|instrucci[oó]n|siempre)\b/i.test(text(value));
}

function isInstructionListUtterance(value) {
  return /\b(que cosas|que me has|que te he|muestrame).{0,40}\b(ensenado|enseñado|aprendido|recuerda)\b/i.test(text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
}

module.exports = { MAX_VOICE_DURATION_MS, MAX_TRANSCRIPT_LENGTH, transcript, recordingPolicy, recognitionError, isInstructionUtterance, isInstructionListUtterance };
