'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createOwnerConversationState, processOwnerTurn } = require('../lib/yarbi-owner-conversation');
const { createScopedAsyncCache } = require('../lib/yarbi-scoped-cache');
const { searchClients } = require('../lib/yarbi-client-search');
const { processOwnerPersonalTurn } = require('../lib/yarbi-owner-personal-conversation');

const root = path.join(__dirname, '..');
function understanding(overrides = {}) {
  return {
    schema:'yarbi.owner-understanding.v1', intent:'open_client', conversational_act:'request', target_type:'contact', target_reference:{}, constraints:{}, correction:{}, continuation:{}, cancel_scope:'none', temporal_clues:[], location_clues:[], service_clues:[], confidence:.9, ambiguity:false, missing_information:[], ...overrides
  };
}

test('product: FAST_LOCAL answers natural operational FAQs without calling the provider', async () => {
  let calls = 0;
  const result = await processOwnerTurn({
    state:createOwnerConversationState(), utterance:'¿Cómo puedo buscar un cliente por el servicio?', candidates:[],
    provider:async () => { calls += 1; throw new Error('provider_should_not_run'); }
  });
  assert.equal(result.outcome,'fast_local');
  assert.equal(result.fast_local,true);
  assert.equal(result.proposal.execute,false);
  assert.equal(calls,0);
  assert.match(result.reply,/nombre|teléfono|telefono/i);
});

test('product: language that is not a deterministic FAQ keeps the V4/provider path', async () => {
  let calls = 0;
  const result = await processOwnerTurn({
    state:createOwnerConversationState(), utterance:'Revisa al Carlos de Comas que escribió ayer.',
    candidates:[{contact_id:7,display_name:'Carlos',district:'Comas',phones:['955000007'],last_contact_at:'2026-11-04T16:00:00.000Z'}],
    provider:async () => { calls += 1; return understanding({constraints:{name:{value:'Carlos',certainty:'confirmed'},district:{value:'Comas',certainty:'confirmed'}},entity_mentions:[{kind:'proper_name',value:'Carlos',source:'utterance',certainty:'confirmed',evidence:'Carlos'}]}); }
  });
  assert.equal(calls,1);
  assert.equal(result.outcome,'resolved');
  assert.equal(result.selected.contact_id,7);
});

test('product: scoped cache deduplicates reads and invalidates only affected contact entries', async () => {
  let now = 1000; let loads = 0;
  const cache = createScopedAsyncCache({ttlMs:1000,maxEntries:10,now:() => now});
  const request = () => cache.getOrLoad({ownerId:'OWNER-A',contactIds:[11],key:{query:'Carlos'},load:async()=>({version:++loads})});
  const [first, second] = await Promise.all([request(),request()]);
  assert.equal(loads,1);
  assert.deepEqual(first.value,second.value);
  const third = await request();
  assert.equal(third.cache,'hit');
  const other = await cache.getOrLoad({ownerId:'OWNER-B',contactIds:[11],key:{query:'Carlos'},load:async()=>({version:++loads})});
  assert.equal(other.cache,'miss');
  assert.equal(loads,2);
  assert.equal(cache.invalidate({contactId:11}),2);
  const after = await request();
  assert.equal(after.cache,'miss');
  assert.equal(loads,3);
  now += 1001;
  const expired = await request();
  assert.equal(expired.cache,'miss');
  assert.equal(loads,4);
});

test('product: client search normalizes partial terms, synonyms, filters and owner isolation', () => {
  const records = [
    {id:1,owner_id:'OWNER-A',display_name:'María Pérez',phone:'999 111 222',district:'Comas',latest_service:'reparacion',commercial_status:'tibio',conversation_summary:'solicitó arreglo de cocina',pending_step:'pendiente de visita'},
    {id:2,owner_id:'OWNER-A',display_name:'Carlos Ruiz',phone:'988777666',district:'Ate',latest_service:'instalacion_nueva',commercial_status:'caliente'},
    {id:3,owner_id:'OWNER-B',display_name:'María Pérez',phone:'900000003',district:'Comas',latest_service:'reparacion',commercial_status:'tibio'},
    {id:1,owner_id:'OWNER-A',display_name:'Duplicado no visible',phone:'999111222'}
  ];
  const repair = searchClients({records,ownerId:'OWNER-A',requesterOwnerId:'OWNER-A',query:'arreglo comas',filters:{status:'tibio'}});
  assert.equal(repair.outcome,'results_found');
  assert.deepEqual(repair.results.map(row=>row.contact_id),[1]);
  assert.ok(repair.results[0].matched_fields.includes('service') || repair.results[0].matched_fields.includes('history'));
  const phone = searchClients({records,ownerId:'OWNER-A',requesterOwnerId:'OWNER-A',query:'111 222'});
  assert.equal(phone.results[0].contact_id,1);
  const denied = searchClients({records,ownerId:'OWNER-A',requesterOwnerId:'OWNER-B',query:'Maria'});
  assert.equal(denied.outcome,'owner_scope_denied');
  assert.equal(denied.results.length,0);
});

test('product: personal FAQ uses the shared brain but remains a non-commercial local response', async () => {
  let calls = 0;
  const result = await processOwnerPersonalTurn({
    classification:{scope:'owner_personal',owner_key:'primary'}, utterance:'¿Qué puedes hacer?', candidates:[],
    provider:async()=>{calls += 1; return understanding();}, providerEventId:'FPC-EVENT',messageId:'FPC-MSG',source:'mock',hmacSecret:'FPC-only-synthetic-secret-123456789'
  });
  assert.equal(calls,0);
  assert.equal(result.outcome,'fast_local');
  assert.equal(result.commercial_effects_allowed,false);
  assert.equal(result.proposal.execute,false);
});

test('product: visible UI reuses instruction/training entrypoints and uses the authenticated CRM search route', () => {
  const html = fs.readFileSync(path.join(root,'frontend','index.html'),'utf8');
  const ui = fs.readFileSync(path.join(root,'frontend','yarbi-product-completion-ui.js'),'utf8');
  assert.match(html,/yarbi-product-completion-ui\.js/);
  assert.match(ui,/gfcOpenCopilotModal\?\.\('ordenes'\)/);
  assert.match(ui,/gfcOpenCopilotModal\?\.\('learning'\)/);
  assert.match(ui,/owner_scope_missing/);
  assert.doesNotMatch(ui,/https?:\/\//);
  assert.match(ui,/\/api\/assistant\/crm-search/);
  assert.match(ui,/\/api\/assistant\/crm-dossier/);
  assert.match(ui,/gfcOpenYarbiCrmDossier/);
  assert.match(ui,/gfcAccountAccessToken/);
  assert.doesNotMatch(ui,/misfinanzas-backend\.vercel\.app/);
});
