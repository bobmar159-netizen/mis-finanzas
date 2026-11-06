'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  authenticateYCloudWebhook,
  extractYCloudInteractiveSelection,
  parseYCloudSignatureHeader
} = require('../lib/yarbi-ycloud-webhook-auth');
const { adaptCommercialEvidence, createVerifiedWebhookEvidenceEvent } = require('../lib/yarbi-commercial-evidence');

const SECRET = 'F3D-test-secret-only-not-a-production-credential';

function signature(raw, timestamp = '1793372400') {
  return `t=${timestamp},s=${crypto.createHmac('sha256', SECRET).update(`${timestamp}.${raw}`, 'utf8').digest('hex')}`;
}

test('F3D authenticates the exact raw body using the official YCloud t/s HMAC format', () => {
  const raw = '{"id":"F3D-event-001","type":"whatsapp.inbound_message.received"}';
  const result = authenticateYCloudWebhook({ rawBody: Buffer.from(raw), headers: { 'ycloud-signature': signature(raw) }, secret: SECRET });
  assert.deepEqual(result, { authenticated: true, code: 'ycloud_authenticated', timestamp: '1793372400' });
  assert.deepEqual(parseYCloudSignatureHeader(signature(raw)), { ok: true, timestamp: '1793372400', signature: signature(raw).split('s=')[1] });
});

test('F3D rejects changed raw bytes, altered signatures, malformed/absent headers and a missing secret', () => {
  const raw = '{"id":"F3D-event-002"}';
  const valid = signature(raw);
  assert.equal(authenticateYCloudWebhook({ rawBody: `${raw} `, headers: { 'ycloud-signature': valid }, secret: SECRET }).code, 'ycloud_signature_invalid');
  const altered = valid.slice(0, -1) + (valid.endsWith('0') ? '1' : '0');
  assert.equal(authenticateYCloudWebhook({ rawBody: raw, headers: { 'ycloud-signature': altered }, secret: SECRET }).authenticated, false);
  assert.equal(authenticateYCloudWebhook({ rawBody: raw, headers: {}, secret: SECRET }).code, 'ycloud_signature_missing');
  assert.equal(authenticateYCloudWebhook({ rawBody: raw, headers: { 'ycloud-signature': 'bad' }, secret: SECRET }).code, 'ycloud_signature_malformed');
  assert.equal(authenticateYCloudWebhook({ rawBody: raw, headers: { 'ycloud-signature': valid }, secret: '' }).code, 'ycloud_webhook_secret_missing');
});

test('F3D creates 3C evidence only after a valid signed interactive event', () => {
  const event = {
    id: 'F3D-event-003', type: 'whatsapp.inbound_message.received', createTime: '2026-10-30T15:00:00.000Z',
    whatsappInboundMessage: { id: 'F3D-message-003', interactive: { type: 'button_reply', button_reply: { id: 'yarbi.commercial.v1.service.reparacion' } } }
  };
  const raw = JSON.stringify(event);
  assert.equal(authenticateYCloudWebhook({ rawBody: raw, headers: { 'ycloud-signature': signature(raw) }, secret: SECRET }).authenticated, true);
  const adapted = adaptCommercialEvidence(createVerifiedWebhookEvidenceEvent({
    providerVerified: true, eventId: event.id, messageId: event.whatsappInboundMessage.id, occurredAt: event.createTime,
    interactive: extractYCloudInteractiveSelection(event)
  }));
  assert.equal(adapted.outcome, 'accepted');
  assert.equal(adapted.evidence.service, 'reparacion');
  assert.equal(adapted.evidence.event_id, event.id);
  const replay = adaptCommercialEvidence(createVerifiedWebhookEvidenceEvent({
    providerVerified: true, eventId: event.id, messageId: event.whatsappInboundMessage.id, occurredAt: event.createTime,
    interactive: extractYCloudInteractiveSelection(event)
  }));
  assert.deepEqual(replay.evidence, adapted.evidence);
});

test('F3D leaves signed free text outside commercial classification', () => {
  const event = { id: 'F3D-event-text', type: 'whatsapp.inbound_message.received', createTime: '2026-10-30T15:00:00.000Z', whatsappInboundMessage: { id: 'F3D-message-text', text: { body: 'quiero instalación y visita' } } };
  const raw = JSON.stringify(event);
  assert.equal(authenticateYCloudWebhook({ rawBody: raw, headers: { 'ycloud-signature': signature(raw) }, secret: SECRET }).authenticated, true);
  assert.equal(extractYCloudInteractiveSelection(event), null);
  assert.equal(adaptCommercialEvidence(createVerifiedWebhookEvidenceEvent({ providerVerified: true, eventId: event.id, messageId: event.whatsappInboundMessage.id, occurredAt: event.createTime, interactive: null })).outcome, 'ignored');
});
