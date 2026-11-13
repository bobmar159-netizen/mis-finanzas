'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApprovedHistoricalReplyContext, createApprovedHistoricalReplyContextReader } = require('../lib/yarbi-approved-historical-reply-context');

const OWNER_A = { kind:'validated_auth_identity', subject:'11111111-1111-4111-8111-111111111111' };
const OWNER_B = { kind:'validated_auth_identity', subject:'22222222-2222-4222-8222-222222222222' };
function batch(contact_id, status = 'approved') {
  return { batch_id:'11111111-1111-4111-8111-111111111111', contact_id, status, proposal:{
    schema:'yarbi.historical-intelligence-result.v1', contact_id:String(contact_id), commercial_effects_allowed:false,
    contact_context_observations:[{ category:'service_interest', summary:`El contacto ${contact_id} consultó una instalación.`, confidence:0.8 }],
    reply_style_patterns:[{ pattern_key:'saludo_breve', category:'greeting', guidance:'Saluda breve y pide una foto si hace falta.', confidence:0.9 }]
  } };
}

test('approved historical learning separates owner style from the resolved contact context', () => {
  const context = buildApprovedHistoricalReplyContext({ ownerIdentity:OWNER_A, contact_id:71, batches:[batch(71), batch(72)] });
  assert.equal(context.owner_account_id, OWNER_A.subject);
  assert.equal(context.contact_id, 71);
  assert.deepEqual(context.contact_observations.map(item => item.summary), ['El contacto 71 consultó una instalación.']);
  assert.equal(context.owner_reply_style_patterns.length, 1);
  assert.equal(context.commercial_effects_allowed, false);
  assert.equal(context.reply_send_allowed, false);
});

test('unapproved, malformed, or commercially-enabled proposals never become reply context', () => {
  const rejected = batch(71, 'rejected');
  const unsafe = batch(71); unsafe.proposal.commercial_effects_allowed = true;
  const malformed = batch(71); malformed.proposal.contact_id = '72';
  const context = buildApprovedHistoricalReplyContext({ ownerIdentity:OWNER_A, contact_id:71, batches:[rejected, unsafe, malformed] });
  assert.equal(context.contact_observations.length, 0);
  assert.equal(context.owner_reply_style_patterns.length, 0);
});

test('contact observations require a resolved positive contact id while approved owner style remains bounded', () => {
  const context = buildApprovedHistoricalReplyContext({ ownerIdentity:OWNER_A, batches:[batch(71), batch(72)] });
  assert.equal(context.contact_id, null);
  assert.equal(context.contact_observations.length, 0);
  assert.equal(context.owner_reply_style_patterns.length, 1);
  assert.throws(() => buildApprovedHistoricalReplyContext({ ownerIdentity:OWNER_A, contact_id:'not-a-contact', batches:[] }), /historical_reply_context_contact_invalid/);
});

test('reader obtains rows only through the owner-bound approved queue', async () => {
  const calls = [];
  const reader = createApprovedHistoricalReplyContextReader({ queue:{
    async listApproved(input) { calls.push(input); return [batch(71)]; }
  } });
  const context = await reader.read({ ownerIdentity:OWNER_A, contact_id:71 });
  assert.equal(context.contact_observations.length, 1);
  assert.equal(calls[0].ownerIdentity.subject, OWNER_A.subject);
  assert.equal(calls[0].contact_id, 71);
  assert.equal(calls[0].limit, 100);
  assert.notEqual(context.owner_account_id, OWNER_B.subject);
});

test('no raw messages, phones, commercial states, or execution permissions are exposed in reply guidance', () => {
  const context = buildApprovedHistoricalReplyContext({ ownerIdentity:OWNER_A, contact_id:71, batches:[batch(71)] });
  const serialized = JSON.stringify(context);
  assert.doesNotMatch(serialized, /source_message_ids|phone|payment|completed|agenda|authorized_pending_execution/i);
  assert.equal(context.contact_observations[0].commercial_fact, false);
});
