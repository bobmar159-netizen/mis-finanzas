'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHistoricalOwnerScopeResolver, planHistoricalIntelligence } = require('../lib/yarbi-historical-intelligence');

const OWNER = '11111111-1111-4111-8111-111111111111';

test('plans historical messages once per contact without commercial effects', () => {
  const plan = planHistoricalIntelligence({ messages:[
    { id:'h1', contact_id:'c1', text:'Hola', timestamp:1, metadata:{ historical:true, direction:'incoming' } },
    { id:'h2', contact_id:'c1', text:'Claro, envíame foto', timestamp:2, metadata:{ historical:true, direction:'outgoing' } },
    { id:'live', contact_id:'c1', text:'nuevo', timestamp:3, metadata:{ historical:false, direction:'incoming' } }
  ] });
  assert.equal(plan.tasks.length, 1);
  assert.deepEqual(plan.tasks[0].message_ids, ['h1','h2']);
  assert.deepEqual(plan.tasks[0].outgoing_message_ids, ['h2']);
  assert.equal(plan.tasks[0].commercial_effects_allowed, false);
  assert.equal(plan.safety.owner_review_required_for_rules, true);
});

test('does not repeat an already processed historical batch', () => {
  const first = planHistoricalIntelligence({ messages:[{ id:'h1', contact_id:'c1', text:'Hola', metadata:{historical:true} }] });
  const second = planHistoricalIntelligence({ messages:[{ id:'h1', contact_id:'c1', text:'Hola', metadata:{historical:true} }], processed_keys:[first.tasks[0].idempotency_key] });
  assert.equal(second.tasks.length, 0);
});

test('splits a complete historic conversation into chronological resumable segments', () => {
  const messages = Array.from({ length: 121 }, (_, index) => ({
    id: `h${index + 1}`, contact_id: 'c1', text: `mensaje ${index + 1}`,
    timestamp: index + 1, metadata: { historical: true, direction: index % 2 ? 'outgoing' : 'incoming' }
  }));
  const plan = planHistoricalIntelligence({ messages, limit: 10 });
  assert.equal(plan.tasks.length, 3);
  assert.deepEqual(plan.tasks.map(task => task.message_ids.length), [60, 60, 1]);
  assert.deepEqual(plan.tasks.map(task => task.segment_index), [0, 1, 2]);
  assert.ok(plan.tasks.every(task => task.segment_count === 3));
  assert.equal(plan.tasks[0].occurred_from, 1);
  assert.equal(plan.tasks[2].occurred_to, 121);
  assert.equal(new Set(plan.tasks.flatMap(task => task.message_ids)).size, 121);
});

test('reads every historical contact scope page instead of silently stopping at 96', async () => {
  const all = Array.from({ length: 2000 }, (_, index) => ({ contact_id: index + 1 }));
  const calls = [];
  const resolve = createHistoricalOwnerScopeResolver({
    pageSize: 97,
    supabase: async path => {
      calls.push(path);
      const offset = Number(new URLSearchParams(path.split('?')[1]).get('offset'));
      const limit = Number(new URLSearchParams(path.split('?')[1]).get('limit'));
      return { response: { ok: true }, data: all.slice(offset, offset + limit) };
    }
  });
  const scope = await resolve({ kind: 'validated_auth_identity', subject: OWNER });
  assert.equal(scope.contact_ids.length, 2000);
  assert.equal(scope.contact_ids.at(-1), 2000);
  assert.ok(calls.length > 1);
  assert.equal(scope.verification, 'canonical_owner_contact_scope_paged');
});

test('historical scope fails explicitly beyond its documented maximum', async () => {
  const resolve = createHistoricalOwnerScopeResolver({
    pageSize: 100,
    maxContacts: 100,
    supabase: async path => {
      const offset = Number(new URLSearchParams(path.split('?')[1]).get('offset'));
      return { response: { ok: true }, data: Array.from({ length: 100 }, (_, index) => ({ contact_id: offset + index + 1 })) };
    }
  });
  await assert.rejects(() => resolve({ kind: 'validated_auth_identity', subject: OWNER }), /historical_owner_scope_limit_exceeded/);
});
