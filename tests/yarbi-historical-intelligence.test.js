'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { planHistoricalIntelligence } = require('../lib/yarbi-historical-intelligence');

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
