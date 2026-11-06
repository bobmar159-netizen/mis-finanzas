'use strict';

const crypto = require('node:crypto');

const ALLOWED_AUDIO_MIME = new Set(['audio/ogg', 'audio/opus', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/webm']);
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_DURATION_MS = 10 * 60 * 1000;

function normalizedMime(value) {
  return String(value ?? '').toLowerCase().split(';', 1)[0].trim();
}

function validateOwnerPersonalAudio({ mimeType, sizeBytes, durationMs, maxBytes = DEFAULT_MAX_BYTES, maxDurationMs = DEFAULT_MAX_DURATION_MS } = {}) {
  const mime = normalizedMime(mimeType);
  const bytes = Number(sizeBytes);
  const duration = Number(durationMs);
  if (!ALLOWED_AUDIO_MIME.has(mime)) return { outcome: 'audio_rejected', code: 'audio_mime_not_allowed' };
  if (!Number.isInteger(bytes) || bytes <= 0 || bytes > maxBytes) return { outcome: 'audio_rejected', code: 'audio_size_invalid' };
  if (!Number.isFinite(duration) || duration <= 0 || duration > maxDurationMs) return { outcome: 'audio_rejected', code: 'audio_duration_invalid' };
  return { outcome: 'audio_accepted', mime_type: mime, size_bytes: bytes, duration_ms: Math.floor(duration), retention: 'temporary_reference_only' };
}

function createOwnerPersonalAudioReference({ providerMediaId, validation, secret } = {}) {
  if (!validation || validation.outcome !== 'audio_accepted') return { outcome: 'audio_reference_rejected' };
  const value = String(providerMediaId ?? '').trim();
  if (!value || !String(secret ?? '').trim()) return { outcome: 'audio_reference_rejected' };
  return {
    ...validation,
    outcome: 'audio_reference_created',
    audio_ref: crypto.createHmac('sha256', String(secret)).update(value, 'utf8').digest('hex').slice(0, 32)
  };
}

module.exports = { ALLOWED_AUDIO_MIME, DEFAULT_MAX_BYTES, DEFAULT_MAX_DURATION_MS, validateOwnerPersonalAudio, createOwnerPersonalAudioReference };
