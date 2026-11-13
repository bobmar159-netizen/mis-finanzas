'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOwnerReplyDraftRequest } = require('../lib/yarbi-owner-reply-draft');
const { GEMINI_HOST, DEFAULT_MODEL, createOwnerReplyDraftGemini } = require('../lib/yarbi-owner-reply-gemini');

const OWNER = { kind:'validated_auth_identity', subject:'11111111-1111-4111-8111-111111111111' };
function request() { return buildOwnerReplyDraftRequest({ ownerIdentity:OWNER, contact:{ id:71 }, incoming_message:{ id:'m-1', text:'Hola, ¿cuánto cuesta?' }, verified_facts:[] }); }
function providerResponse(value) { return new Response(JSON.stringify({ candidates:[{ content:{ parts:[{ text:JSON.stringify(value) }] } }] }), { status:200 }); }

test('reply draft adapter uses compact structured output without leaking the key', async () => {
  const seen = []; const draft = { draft:'Hola, para darte un precio exacto necesito revisar el trabajo. ¿Me envías una foto?', disposition:'clarify', requires_owner_confirmation:true, fact_ids_used:[], historical_context_categories_used:[] };
  const provider = createOwnerReplyDraftGemini({ apiKey:'synthetic-reply-key-not-real', fetchImpl:async (url, options) => { seen.push({ url:String(url), headers:options.headers, body:JSON.parse(options.body) }); return providerResponse(draft); } });
  assert.deepEqual(await provider.createDraft(request()), draft);
  assert.equal(new URL(seen[0].url).hostname, GEMINI_HOST);
  assert.equal(new URL(seen[0].url).search, '');
  assert.equal(seen[0].headers['x-goog-api-key'], 'synthetic-reply-key-not-real');
  assert.equal(JSON.stringify(seen[0].body).includes('synthetic-reply-key-not-real'), false);
  assert.equal(seen[0].body.generationConfig.responseJsonSchema.additionalProperties, false);
  assert.equal(provider.model, DEFAULT_MODEL);
});

test('reply draft adapter fails closed for invalid requests and sanitized provider failures', async () => {
  const provider = createOwnerReplyDraftGemini({ apiKey:'key', fetchImpl:async () => new Response(JSON.stringify({ error:{ code:400, status:'INVALID_ARGUMENT', message:'bad schema key=AIza-NO-LOG' } }), { status:400 }) });
  const error = await provider.createDraft(request()).then(() => null, caught => caught);
  assert.equal(error.code, 'owner_reply_draft_provider_rejected');
  assert.equal(JSON.stringify(error.provider_diagnostic).includes('AIza-NO-LOG'), false);
  await assert.rejects(() => provider.createDraft({ ...request(), automatic_send_allowed:true }), { code:'owner_reply_draft_request_invalid' });
});
