'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { REPLY_DRAFT_SCHEMA, buildOwnerReplyDraftRequest, normalizeOwnerReplyDraft } = require('../lib/yarbi-owner-reply-draft');

const OWNER = { kind:'validated_auth_identity', subject:'11111111-1111-4111-8111-111111111111' };
const CONTEXT = { schema:'yarbi.approved-historical-reply-context.v1', owner_account_id:OWNER.subject, contact_id:71, commercial_effects_allowed:false, reply_send_allowed:false,
  contact_observations:[{ category:'service_interest', summary:'Consultó una instalación.', commercial_fact:false }],
  owner_reply_style_patterns:[{ category:'greeting', guidance:'Saluda breve y cordial.' }]
};
function request(overrides = {}) { return buildOwnerReplyDraftRequest({
  ownerIdentity:OWNER, contact:{ id:71, display_name:'Contacto sintético' }, incoming_message:{ id:'message-synthetic-1', text:'¿Cuánto cuesta?' },
  verified_facts:[{ id:'service-known', kind:'crm', statement:'Servicio consultado: instalación.', verified:true }], owner_instructions:['No dar precios sin revisar el trabajo.'], historical_context:CONTEXT, ...overrides
}); }

test('reply drafts use only verified facts plus owner-approved context and always require confirmation', () => {
  const value = request();
  assert.equal(value.execute, false);
  assert.equal(value.automatic_send_allowed, false);
  assert.equal(value.commercial_effects_allowed, false);
  assert.equal(value.response_mime_type, 'application/json');
  assert.equal(REPLY_DRAFT_SCHEMA.additionalProperties, false);
  assert.match(value.prompt, /No dar precios sin revisar el trabajo/);
  assert.match(value.prompt, /Saluda breve y cordial/);
  assert.match(value.prompt, /nunca confirma pagos, visitas, fechas ni cierres/);
  assert.doesNotMatch(value.prompt, /owner_account_id|11111111-1111/i);
});

test('historical context from another owner or contact is discarded rather than mixed into a reply draft', () => {
  const otherOwner = request({ historical_context:{ ...CONTEXT, owner_account_id:'22222222-2222-4222-8222-222222222222' } });
  const otherContact = request({ historical_context:{ ...CONTEXT, contact_id:72 } });
  assert.doesNotMatch(otherOwner.prompt, /Saluda breve y cordial/);
  assert.doesNotMatch(otherContact.prompt, /Consultó una instalación/);
});

test('normalization refuses ungrounded facts, unapproved context categories, or automatic sends', () => {
  const value = request();
  const accepted = normalizeOwnerReplyDraft({ request:value, response:{ draft:'Hola, para darte un precio exacto necesito revisar el trabajo. ¿Puedes enviarme una foto?', disposition:'clarify', requires_owner_confirmation:true, fact_ids_used:['service-known'], historical_context_categories_used:['service_interest'] } });
  assert.equal(accepted.status, 'draft_pending_owner_confirmation');
  assert.equal(accepted.automatic_send_allowed, false);
  assert.throws(() => normalizeOwnerReplyDraft({ request:value, response:{ draft:'Te agendo mañana.', disposition:'answer', requires_owner_confirmation:false, fact_ids_used:[], historical_context_categories_used:[] } }), /owner_reply_draft_response_invalid/);
  assert.throws(() => normalizeOwnerReplyDraft({ request:value, response:{ draft:'Listo.', disposition:'answer', requires_owner_confirmation:true, fact_ids_used:['invented-payment'], historical_context_categories_used:[] } }), /owner_reply_draft_response_invalid/);
});

test('a draft request rejects missing verified identity or incoming message instead of guessing', () => {
  assert.throws(() => request({ contact:{ id:'' } }), /owner_reply_draft_input_invalid/);
  assert.throws(() => request({ incoming_message:{ id:'m' } }), /owner_reply_draft_input_invalid/);
});
