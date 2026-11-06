'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  normalizeE164,
  classifyOwnerPersonalInbound,
  personalEventKey
} = require('../lib/yarbi-owner-personal-identity');
const { processOwnerPersonalTurn, buildOwnerInstructionRequest } = require('../lib/yarbi-owner-personal-conversation');
const { validateOwnerPersonalAudio, createOwnerPersonalAudioReference } = require('../lib/yarbi-owner-personal-audio');
const { verifyYCloudWebhookSignature } = require('../lib/yarbi-ycloud-webhook-auth');
const { sanitizeWebhookReceipt, sanitizeWebhookIdentity, sanitizeExtraction } = require('../lib/yarbi-webhook-log');

const SECRET = 'P05-synthetic-owner-hmac-secret-only-123456';
const DESTINATION = '+51999100001';
const IDENTITIES = [
  { phone: '+51999100011', owner_key: 'primary', label: 'personal' },
  { phone: '+51999100012', owner_key: 'primary', label: 'business' }
];

function classification(sender, destination = DESTINATION) {
  return classifyOwnerPersonalInbound({
    destinationPhone: destination,
    senderPhone: sender,
    personalDestinationPhone: DESTINATION,
    authorizedIdentities: IDENTITIES,
    hmacSecret: SECRET
  });
}

function understanding() {
  return {
    schema: 'yarbi.owner-understanding.v1', intent: 'general', conversational_act: 'request', target_type: 'unknown', target_reference: {},
    constraints: {}, correction: {}, continuation: {}, cancel_scope: 'none', temporal_clues: [], location_clues: [], service_clues: [],
    confidence: 0.9, ambiguity: true, missing_information: ['contexto']
  };
}

test('P05 personal and Business authorized identities resolve to the same owner context without exposing phones', () => {
  const personal = classification('+51999100011');
  const business = classification('+51999100012');
  assert.equal(personal.scope, 'owner_personal');
  assert.equal(business.scope, 'owner_personal');
  assert.equal(personal.owner_key, 'primary');
  assert.equal(business.owner_key, 'primary');
  assert.match(personal.identity_ref, /^[a-f0-9]{24}$/);
  assert.equal(JSON.stringify(personal).includes('+51999100011'), false);
  assert.equal(normalizeE164('51999100011'), '');
  assert.equal(normalizeE164('51999100011', { defaultCountryCode: '51' }), '+51999100011');
});

test('P05 unknown senders are rejected only on the dedicated owner number; commercial destinations remain separate', () => {
  assert.deepEqual(classification('+51999100099').scope, 'rejected');
  const commercial = classification('+51999100099', '+51999100055');
  assert.equal(commercial.scope, 'commercial');
  assert.equal(commercial.outcome, 'not_personal_destination');
});

test('P05 duplicate provider events use one stable non-reversible idempotency key', () => {
  const a = personalEventKey({ provider: 'ycloud', providerEventId: 'P05-EVENT-1', messageId: 'P05-MSG-1', hmacSecret: SECRET });
  const b = personalEventKey({ provider: 'ycloud', providerEventId: 'P05-EVENT-1', messageId: 'P05-MSG-1', hmacSecret: SECRET });
  const c = personalEventKey({ provider: 'ycloud', providerEventId: 'P05-EVENT-2', messageId: 'P05-MSG-1', hmacSecret: SECRET });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(a.includes('P05-MSG-1'), false);
});

test('P05 personal turns use the existing owner brain, never execute commerce and do not need CRM I/O', async () => {
  let calls = 0;
  const result = await processOwnerPersonalTurn({
    classification: classification('+51999100011'),
    utterance: 'Muéstrame el resumen.',
    provider: async () => { calls += 1; return understanding(); },
    candidates: [], providerEventId: 'P05-EVENT-TURN', messageId: 'P05-MSG-TURN', hmacSecret: SECRET,
    now: '2026-11-05T15:00:00.000Z'
  });
  assert.equal(calls, 1);
  assert.equal(result.scope, 'owner_personal');
  assert.equal(result.owner_key, 'primary');
  assert.equal(result.proposal.execute, false);
  assert.equal(result.commercial_effects_allowed, false);
  assert.match(result.idempotency_key, /^[a-f0-9]{64}$/);
});

test('P05 instruction requests from either authorized channel share the logical owner and require confirmation', () => {
  const a = buildOwnerInstructionRequest({ ownerKey: classification('+51999100011').owner_key, instruction: 'Responde breve.', eventId: 'P05-INSTR-1', hmacSecret: SECRET });
  const b = buildOwnerInstructionRequest({ ownerKey: classification('+51999100012').owner_key, instruction: 'Responde breve.', eventId: 'P05-INSTR-2', hmacSecret: SECRET });
  assert.equal(a.outcome, 'instruction_requires_confirmation');
  assert.equal(a.confirmed, false);
  assert.equal(a.owner_key, b.owner_key);
  assert.notEqual(a.event_ref, b.event_ref);
});

test('P05 audio accepts only bounded supported media and keeps a temporary opaque reference', () => {
  const accepted = validateOwnerPersonalAudio({ mimeType: 'audio/ogg; codecs=opus', sizeBytes: 1000, durationMs: 2000 });
  assert.equal(accepted.outcome, 'audio_accepted');
  const ref = createOwnerPersonalAudioReference({ providerMediaId: 'P05-MEDIA-ONE', validation: accepted, secret: SECRET });
  assert.equal(ref.outcome, 'audio_reference_created');
  assert.equal(ref.audio_ref.includes('P05-MEDIA-ONE'), false);
  assert.equal(validateOwnerPersonalAudio({ mimeType: 'text/plain', sizeBytes: 1000, durationMs: 2000 }).code, 'audio_mime_not_allowed');
  assert.equal(validateOwnerPersonalAudio({ mimeType: 'audio/ogg', sizeBytes: 17 * 1024 * 1024, durationMs: 2000 }).code, 'audio_size_invalid');
});

test('P05 valid and invalid YCloud signatures keep the pre-existing commercial signature contract', () => {
  const raw = Buffer.from('{"id":"P05-SIGNED"}', 'utf8');
  const timestamp = '1793900000';
  const signature = crypto.createHmac('sha256', 'P05-signature-secret').update(Buffer.concat([Buffer.from(`${timestamp}.`), raw])).digest('hex');
  assert.equal(verifyYCloudWebhookSignature({ rawBody: raw, signatureHeader: `t=${timestamp},s=${signature}`, secret: 'P05-signature-secret' }).ok, true);
  assert.equal(verifyYCloudWebhookSignature({ rawBody: raw, signatureHeader: `t=${timestamp},s=${'0'.repeat(64)}`, secret: 'P05-signature-secret' }).code, 'ycloud_signature_invalid');
});

test('P05 webhook diagnostics never preserve message body, numbers, profile names or extracted payload values', () => {
  const receipt = sanitizeWebhookReceipt({ id: 'P05-EVENT', type: 'whatsapp.inbound_message.received', whatsappInboundMessage: { id: 'P05-MSG', type: 'text', text: { body: 'contenido privado' }, from: '+51999100011' } });
  const identity = sanitizeWebhookIdentity({ identitySource: 'cloud_profile', senderPhone: '+51999100011', profileName: 'Nombre privado', profileUsername: 'private', fromUserId: 'id-private' });
  const extraction = sanitizeExtraction({ summary: 'no conservar', phone: '+51999100011' });
  const logged = JSON.stringify({ receipt, identity, extraction });
  assert.equal(logged.includes('contenido privado'), false);
  assert.equal(logged.includes('+51999100011'), false);
  assert.equal(logged.includes('Nombre privado'), false);
  assert.deepEqual(extraction.keys, ['phone', 'summary']);
});
