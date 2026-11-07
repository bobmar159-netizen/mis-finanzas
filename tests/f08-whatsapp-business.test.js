'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSendAuthorization, verifySendAuthorization } = require('../lib/yarbi-whatsapp-send-authorization');
const { createMemoryWhatsAppSendOperationStore } = require('../lib/yarbi-whatsapp-send-operations');
const { normalizeWhatsAppBusinessEvent } = require('../lib/yarbi-whatsapp-business');

const SECRET = 'F08-local-only-authorization-secret-not-for-any-deployment';
const OWNER = '11111111-1111-4111-8111-111111111111';
const request = { provider: 'ycloud', to: '+51987654320', type: 'text', message: 'F08 propuesta sintética', mediaUrl: '' };

test('F08 binds an expiring send authorization to its owner, explicit provider, recipient and content', () => {
  const created = createSendAuthorization({ secret: SECRET, ownerId: OWNER, ...request, operationId: '11111111-1111-4111-8111-111111111112', now: 1000 });
  assert.equal(created.ok, true);
  assert.equal(created.token.includes('F08 propuesta'), false);
  assert.equal(verifySendAuthorization({ token: created.token, secret: SECRET, ownerId: OWNER, ...request, now: 2000 }).ok, true);
  assert.equal(verifySendAuthorization({ token: created.token, secret: SECRET, ownerId: OWNER, ...request, message: 'contenido alterado', now: 2000 }).code, 'whatsapp_send_authorization_binding_mismatch');
  assert.equal(verifySendAuthorization({ token: created.token, secret: SECRET, ownerId: OWNER, ...request, provider: 'meta_cloud', now: 2000 }).code, 'whatsapp_send_authorization_binding_mismatch');
  assert.equal(verifySendAuthorization({ token: created.token, secret: SECRET, ownerId: OWNER, ...request, now: 400000 }).code, 'whatsapp_send_authorization_expired');
});

test('F08 operation store makes an authorization single-use and preserves accepted/delivered/read states', async () => {
  const now = 1000;
  const created = createSendAuthorization({ secret: SECRET, ownerId: OWNER, ...request, operationId: '11111111-1111-4111-8111-111111111113', now });
  const checked = verifySendAuthorization({ token: created.token, secret: SECRET, ownerId: OWNER, ...request, now: now + 1 });
  const store = createMemoryWhatsAppSendOperationStore();
  await store.request({ operation_id: checked.authorization.operation_id, owner_account_id: OWNER, provider: checked.authorization.provider, recipient_fingerprint: checked.authorization.recipient_fingerprint, content_fingerprint: checked.authorization.content_fingerprint, authorization_fingerprint: checked.token_fingerprint, expires_at: new Date(checked.authorization.expires_at).toISOString() });
  const claim = await store.claim({ operationId: checked.authorization.operation_id, ownerId: OWNER, provider: checked.authorization.provider, recipientFingerprint: checked.authorization.recipient_fingerprint, contentFingerprint: checked.authorization.content_fingerprint, authorizationFingerprint: checked.token_fingerprint, now: now + 2 });
  assert.equal(claim.ok, true);
  assert.equal((await store.claim({ operationId: checked.authorization.operation_id, ownerId: OWNER, provider: checked.authorization.provider, recipientFingerprint: checked.authorization.recipient_fingerprint, contentFingerprint: checked.authorization.content_fingerprint, authorizationFingerprint: checked.token_fingerprint, now: now + 3 })).code, 'whatsapp_send_operation_replayed');
  assert.equal((await store.accepted({ operationId: checked.authorization.operation_id, providerMessageId: 'F08-provider-1', now: now + 4 })).ok, true);
  assert.equal((await store.delivery({ provider: 'ycloud', providerMessageId: 'F08-provider-1', status: 'delivered', now: now + 5 })).ok, true);
  assert.equal((await store.delivery({ provider: 'ycloud', providerMessageId: 'F08-provider-1', status: 'read', now: now + 6 })).operation.status, 'read');
});

test('F08 marks an ambiguous provider result as non-retriable instead of risking a duplicate send', async () => {
  const created = createSendAuthorization({ secret: SECRET, ownerId: OWNER, ...request, operationId: '11111111-1111-4111-8111-111111111114', now: 1000 });
  const checked = verifySendAuthorization({ token: created.token, secret: SECRET, ownerId: OWNER, ...request, now: 1001 });
  const store = createMemoryWhatsAppSendOperationStore();
  await store.request({ operation_id: checked.authorization.operation_id, owner_account_id: OWNER, provider: checked.authorization.provider, recipient_fingerprint: checked.authorization.recipient_fingerprint, content_fingerprint: checked.authorization.content_fingerprint, authorization_fingerprint: checked.token_fingerprint, expires_at: new Date(checked.authorization.expires_at).toISOString() });
  assert.equal((await store.claim({ operationId: checked.authorization.operation_id, ownerId: OWNER, provider: checked.authorization.provider, recipientFingerprint: checked.authorization.recipient_fingerprint, contentFingerprint: checked.authorization.content_fingerprint, authorizationFingerprint: checked.token_fingerprint, now: 1002 })).ok, true);
  assert.equal((await store.uncertain({ operationId: checked.authorization.operation_id, now: 1003 })).operation.status, 'provider_outcome_unknown');
  assert.equal((await store.claim({ operationId: checked.authorization.operation_id, ownerId: OWNER, provider: checked.authorization.provider, recipientFingerprint: checked.authorization.recipient_fingerprint, contentFingerprint: checked.authorization.content_fingerprint, authorizationFingerprint: checked.token_fingerprint, now: 1004 })).code, 'whatsapp_send_operation_replayed');
});

test('F08 normalizes signed-provider message and delivery shapes without treating historical availability as complete', () => {
  const incoming = normalizeWhatsAppBusinessEvent({ provider: 'ycloud', payload: { id: 'F08-event', type: 'whatsapp.inbound_message.received', whatsappInboundMessage: { id: 'F08-message', type: 'audio', audio: { id: 'media' } } } });
  assert.deepEqual(incoming, { outcome: 'message', provider: 'ycloud', provider_event_id: 'F08-event', provider_message_id: 'F08-message', direction: 'incoming', history: 'available', message_type: 'audio', has_media: true, has_interactive: false, status: 'received' });
  const historical = normalizeWhatsAppBusinessEvent({ provider: 'ycloud', payload: { id: 'F08-history', type: 'whatsapp.smb.history', whatsappInboundMessage: { id: 'F08-history-message', type: 'text', status: 'sent', text: { body: 'x' } } } });
  assert.equal(historical.history, 'partial');
  assert.equal(historical.direction, 'outgoing');
  const delivered = normalizeWhatsAppBusinessEvent({ provider: 'meta_cloud', payload: { entry: [{ id: 'F08-meta-event', changes: [{ value: { statuses: [{ id: 'F08-meta-message', status: 'delivered' }] } }] }] } });
  assert.deepEqual(delivered, { outcome: 'delivery_status', provider: 'meta_cloud', provider_event_id: 'F08-meta-event', provider_message_id: 'F08-meta-message', status: 'delivered', historical: false });
});
