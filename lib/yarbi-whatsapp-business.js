'use strict';

function text(value, limit = 160) { return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, limit); }
function first(...values) { return values.map(value => text(value)).find(Boolean) || ''; }
function deliveryState(value) {
  const state = text(value, 32).toLowerCase();
  if (['sent', 'accepted', 'provider_accepted'].includes(state)) return 'provider_accepted';
  if (state === 'delivered') return 'delivered';
  if (state === 'read') return 'read';
  if (['failed', 'undelivered'].includes(state)) return 'failed';
  return '';
}

// Normalizes only provider structure.  It does not infer a CRM contact or
// interpret commercial free text; the existing canonical processor remains
// responsible for that work after the event is persisted.
function normalizeWhatsAppBusinessEvent({ provider, payload } = {}) {
  const source = provider === 'ycloud' ? 'ycloud' : provider === 'meta_cloud' ? 'meta_cloud' : '';
  if (!source || !payload || typeof payload !== 'object') return { outcome: 'ignored', code: 'whatsapp_event_invalid' };
  if (source === 'ycloud') {
    const eventType = text(payload.type, 120);
    const message = payload.whatsappInboundMessage || payload.whatsappMessage || payload.message || {};
    const eventId = first(payload.id, payload.eventId);
    const messageId = first(message.id, message.wamid, payload.messageId);
    const historical = eventType === 'whatsapp.smb.history';
    const outgoing = eventType === 'whatsapp.smb.message.echoes' || ['sent', 'delivered', 'read'].includes(text(message.status, 32).toLowerCase());
    const status = deliveryState(message.status || payload.status);
    if (messageId && status && !message.text && !message.interactive && !message.audio && !message.image && !message.video && !message.document) return { outcome: 'delivery_status', provider: source, provider_event_id: eventId || null, provider_message_id: messageId, status, historical };
    if (!messageId) return { outcome: 'ignored', code: 'whatsapp_event_message_id_missing' };
    return { outcome: 'message', provider: source, provider_event_id: eventId || null, provider_message_id: messageId, direction: outgoing ? 'outgoing' : 'incoming', history: historical ? 'partial' : 'available', message_type: text(message.type, 40) || 'unknown', has_media: Boolean(message.audio || message.image || message.video || message.document), has_interactive: Boolean(message.interactive), status: status || 'received' };
  }
  const change = payload.entry?.[0]?.changes?.[0]?.value || {};
  const statusRow = Array.isArray(change.statuses) ? change.statuses[0] : null;
  if (statusRow?.id) return { outcome: 'delivery_status', provider: source, provider_event_id: first(payload.entry?.[0]?.id) || null, provider_message_id: text(statusRow.id, 180), status: deliveryState(statusRow.status), historical: false };
  const message = Array.isArray(change.messages) ? change.messages[0] : null;
  if (!message?.id) return { outcome: 'ignored', code: 'whatsapp_event_message_id_missing' };
  return { outcome: 'message', provider: source, provider_event_id: first(payload.entry?.[0]?.id) || null, provider_message_id: text(message.id, 180), direction: 'incoming', history: 'available', message_type: text(message.type, 40) || 'unknown', has_media: Boolean(message.audio || message.image || message.video || message.document), has_interactive: Boolean(message.interactive), status: 'received' };
}

module.exports = { deliveryState, normalizeWhatsAppBusinessEvent };
