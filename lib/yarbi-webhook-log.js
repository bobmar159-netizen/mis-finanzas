'use strict';

function text(value, limit = 80) { return String(value ?? '').trim().slice(0, limit); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }

function sanitizeWebhookReceipt(body) {
  const row = object(body);
  const inbound = object(row.whatsappInboundMessage);
  const message = object(inbound || row);
  return {
    event_type: text(row.type, 80) || 'meta_cloud',
    has_event_id: Boolean(text(row.id, 160)),
    has_message_id: Boolean(text(message.id, 160)),
    message_type: text(message.type, 40) || null,
    has_media: Boolean(message.audio || message.image || message.video || message.document),
    has_interactive: Boolean(message.interactive),
    // Nunca se incluyen cuerpo, teléfono, nombre, ubicación ni cabeceras.
    payload_logged: false
  };
}

function sanitizeWebhookIdentity({ identitySource, senderPhone, profileName, profileUsername, fromUserId } = {}) {
  return {
    identity_source: text(identitySource, 48) || 'unknown',
    has_phone: Boolean(text(senderPhone, 32)),
    has_profile_name: Boolean(text(profileName, 80)),
    has_profile_username: Boolean(text(profileUsername, 80)),
    has_provider_user_id: Boolean(text(fromUserId, 120))
  };
}

function sanitizeWebhookProcessing({ direction, messageType, hasLocation, audioSummaryStatus } = {}) {
  return {
    direction: text(direction, 20) || 'incoming',
    message_type: text(messageType, 40) || 'unknown',
    has_location: Boolean(hasLocation),
    audio_summary_status: text(audioSummaryStatus, 32) || null
  };
}

function sanitizeExtraction(value) {
  const row = object(value);
  return { key_count: Object.keys(row).length, keys: Object.keys(row).sort().slice(0, 12) };
}

module.exports = { sanitizeWebhookReceipt, sanitizeWebhookIdentity, sanitizeWebhookProcessing, sanitizeExtraction };
