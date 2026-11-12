'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHistoricalIntelligenceProcessor } = require('../lib/yarbi-historical-intelligence-processor');

const OWNER = { kind: 'validated_auth_identity', subject: '11111111-1111-4111-8111-111111111111' };
const TASK = { batch_id:'22222222-2222-4222-8222-222222222222', idempotency_key:'a'.repeat(64), contact_id:71, message_ids:['h1','h2'], outgoing_message_ids:['h2'], segment_index:0, segment_count:1, occurred_from:1, occurred_to:2, attempt_count:1 };
const MESSAGES = [
  { id:'h1', contact_id:71, text:'Busco una instalación', timestamp:1, metadata:{ historical:true, direction:'incoming' } },
  { id:'h2', contact_id:71, text:'Hola, envíame una foto por favor.', timestamp:2, metadata:{ historical:true, direction:'outgoing' } }
];

test('historical processor completes exactly one scoped segment as review-only', async () => {
  const calls = []; const queue = {
    claim: async () => ({ ...TASK }),
    complete: async input => calls.push(['complete', input]),
    fail: async input => calls.push(['fail', input])
  };
  const processor = createHistoricalIntelligenceProcessor({
    queue,
    resolveOwnerScope: async () => ({ owner_id: OWNER.subject, contact_ids:[71] }),
    readTaskMessages: async task => { assert.equal(task.batch_id, TASK.batch_id); return MESSAGES; },
    interpret: async request => {
      assert.match(request.prompt, /No declares pagos, visitas/);
      return { contact_context_observations:[{ category:'service_interest', summary:'Consulta una instalación.', source_message_ids:['h1'], confidence:0.8 }], reply_style_patterns:[{ pattern_key:'saludo_breve', category:'greeting', guidance:'Saluda y pide una foto.', source_message_ids:['h2'], confidence:0.9 }], requires_owner_review:false };
    }
  });
  const result = await processor.processOne({ ownerIdentity: OWNER });
  assert.equal(result.outcome, 'historical_segment_awaiting_owner_review');
  assert.equal(result.gemini_invoked, true);
  assert.equal(result.commercial_effects_allowed, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'complete');
  assert.equal(calls[0][1].result.requires_owner_review, true);
});

test('historical processor stops and marks the claimed segment failed without a retry', async () => {
  const calls = []; const queue = {
    claim: async () => ({ ...TASK }), complete: async () => calls.push('complete'),
    fail: async input => calls.push(input)
  };
  const processor = createHistoricalIntelligenceProcessor({
    queue,
    resolveOwnerScope: async () => ({ owner_id: OWNER.subject, contact_ids:[] }),
    readTaskMessages: async () => { throw new Error('must_not_read'); },
    interpret: async () => { throw new Error('must_not_call'); }
  });
  const result = await processor.processOne({ ownerIdentity: OWNER });
  assert.equal(result.outcome, 'historical_segment_failed');
  assert.equal(result.error_code, 'historical_task_owner_scope_invalid');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].error_code, 'historical_task_owner_scope_invalid');
});

test('historical processor reports empty queue without reading or invoking a model', async () => {
  const processor = createHistoricalIntelligenceProcessor({
    queue: { claim: async () => null, complete: async () => {}, fail: async () => {} },
    resolveOwnerScope: async () => { throw new Error('must_not_scope'); },
    readTaskMessages: async () => { throw new Error('must_not_read'); },
    interpret: async () => { throw new Error('must_not_call'); }
  });
  const result = await processor.processOne({ ownerIdentity: OWNER });
  assert.deepEqual(result, { outcome:'no_ready_historical_segment', owner_id:OWNER.subject, gemini_invoked:false });
});
