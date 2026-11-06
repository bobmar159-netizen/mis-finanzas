'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { searchScopedCrm, invalidateCrmSearchCache } = require('../lib/yarbi-crm-search-runtime');
const { planCrmSearchFromUnderstanding } = require('../lib/yarbi-crm-search-conversation');
const { processOwnerTurn, createOwnerConversationState } = require('../lib/yarbi-owner-conversation');
const { processOwnerPersonalCrmQuery } = require('../lib/yarbi-owner-personal-conversation');

const OWNER_A = '00000000-0000-4000-8000-0000000000a1';
const OWNER_B = '00000000-0000-4000-8000-0000000000b2';
const ENV = {
  VERCEL_ENV: 'preview', YARBI_PREVIEW_OWNER_REFERENCES_ONLY: 'true',
  YARBI_PREVIEW_SUPABASE_PROJECT_REF: 'uevilhbstnmmdlgyshlv',
  SUPABASE_URL: 'https://uevilhbstnmmdlgyshlv.supabase.co',
  SUPABASE_SECRET_KEY: 'isolated-service-key-only-for-local-tests-123456',
  YARBI_TRACE_HMAC_KEY: 'trace-hmac-only-for-local-tests-1234567890'
};
const CONTACTS = [
  { id: 101, display_name: 'F3I Carlos Surco', commercial_status: 'tibio', operational_status: 'seguimiento_pendiente', latest_service: 'reparacion', last_contact_at: '2026-11-05T15:00:00.000Z', updated_at: '2026-11-05T15:00:00.000Z' },
  { id: 102, display_name: 'F3I Andrea Comas', commercial_status: 'caliente', operational_status: 'visita_por_confirmar', latest_service: 'instalacion_nueva', last_contact_at: '2026-11-02T15:00:00.000Z', updated_at: '2026-11-02T15:00:00.000Z' },
  { id: 202, display_name: 'F3I Carlos Ajeno', commercial_status: 'frio', operational_status: '', latest_service: 'reparacion', last_contact_at: '2026-11-05T16:00:00.000Z', updated_at: '2026-11-05T16:00:00.000Z' }
];
const IDENTIFIERS = [{ contact_id:101, normalized_value:'900000101' },{ contact_id:102, normalized_value:'900000102' },{ contact_id:202, normalized_value:'900000202' }];
const MEMORY = [
  { contact_id:101,memory_type:'district',value:{district:'Surco'} }, { contact_id:101,memory_type:'customer_commitment',value:{detail:'terma'} },
  { contact_id:102,memory_type:'district',value:{district:'Comas'} }, { contact_id:102,memory_type:'pending_step',value:{step:'visita_por_confirmar'} }
];
const MESSAGES = [{contact_id:101,text:'Solicitó mantenimiento mensual.'},{contact_id:102,text:'Quiere visita para instalación.'}];
const ANALYSES = [{contact_id:101,intent:'consulta',service:'reparacion',extracted_data:{cotizacion:'pendiente'}},{contact_id:102,intent:'visita',service:'instalacion_nueva',extracted_data:{}}];
const AGENDA = [{contact_id:102,service:'instalacion_nueva',status:'pending',description:'visita de instalación'}];
const RECEIVABLES = [{contact_id:101,status:'pending',next_action:'enviar cotización',agreed_amount:0,balance_amount:0}];

function response(ok = true) { return { ok, status: ok ? 200 : 500 }; }
function ids(url) { const match = decodeURIComponent(String(url)).match(/contact_id=in\.\(([^)]+)\)|id=in\.\(([^)]+)\)/); return new Set(String(match?.[1] || match?.[2] || '').split(',').map(Number).filter(Boolean)); }
function rowsFor(items, url, field = 'contact_id') { const accepted = ids(url); return items.filter(row => accepted.has(Number(row[field]))); }
function createStore(calls) {
  return async path => {
    calls.push(path);
    if (path.includes('crm_contacts')) return { response:response(), data:rowsFor(CONTACTS,path,'id') };
    if (path.includes('contact_identifiers')) return { response:response(), data:rowsFor(IDENTIFIERS,path) };
    if (path.includes('operational_memory')) return { response:response(), data:rowsFor(MEMORY,path) };
    if (path.includes('whatsapp_messages')) return { response:response(), data:rowsFor(MESSAGES,path) };
    if (path.includes('ai_message_analysis')) return { response:response(), data:rowsFor(ANALYSES,path) };
    if (path.includes('agenda_events')) return { response:response(), data:rowsFor(AGENDA,path) };
    if (path.includes('yarbi_receivables')) return { response:response(), data:rowsFor(RECEIVABLES,path) };
    throw new Error('unexpected local path');
  };
}
function identity(owner) { return { kind:'validated_auth_identity',subject:owner }; }
function scope(owner) { return async () => ({ owner_id:owner,contact_ids:owner===OWNER_A?[101,102]:[202],verification:'canonical_owner_contact_scope' }); }
function v1Understanding(overrides = {}) {
  return {
    schema:'yarbi.owner-understanding.v1', intent:'reference_lookup', conversational_act:'request', target_type:'contact',
    target_reference:{name:'',relation:''},
    constraints:{name:{value:'Carlos',certainty:'confirmed'},service:{value:'reparacion',certainty:'confirmed'}},
    entity_mentions:[
      {kind:'proper_name',value:'Carlos',source:'utterance',certainty:'confirmed',evidence:'Carlos'},
      {kind:'service_reference',value:'reparacion',source:'utterance',certainty:'confirmed',evidence:'reparación'}
    ],
    correction:{discard_active_entity:false,replace_previous:false,select_alternative:false},
    continuation:{use_active_entity:false,use_last_proposed_entity:false}, cancel_scope:'none',
    temporal_clues:[],location_clues:[],service_clues:[],confidence:0.9,ambiguity:false,missing_information:[],
    ...overrides
  };
}

test('CRM search finds name, phone, address, service, history, quote and traits only inside the verified owner scope', async () => {
  const cases = [
    ['Carlos',[101]], ['900000101',[101]], ['Surco',[101]], ['arreglo',[101]], ['mantenimiento',[101]], ['cotización',[101]], ['terma',[101]]
  ];
  for (const [query, expected] of cases) {
    const result = await searchScopedCrm({ supabase:createStore([]),validatedIdentity:identity(OWNER_A),ownerScopeResolver:scope(OWNER_A),query,limit:12 });
    assert.deepEqual(result.results.map(row=>row.contact_id),expected,query);
    assert.equal(result.scope.verified,'canonical_owner_contact_scope');
  }
  const denied = await searchScopedCrm({ supabase:createStore([]),validatedIdentity:identity(OWNER_B),ownerScopeResolver:scope(OWNER_B),query:'Carlos',limit:12 });
  assert.deepEqual(denied.results.map(row=>row.contact_id),[202]);
});

test('CRM search deduplicates, paginates, caches by owner and invalidates when a contact changes', async () => {
  const calls=[];
  const first=await searchScopedCrm({supabase:createStore(calls),validatedIdentity:identity(OWNER_A),ownerScopeResolver:scope(OWNER_A),query:'F3I',page:1,limit:1});
  const firstCalls=calls.length;
  const warm=await searchScopedCrm({supabase:createStore(calls),validatedIdentity:identity(OWNER_A),ownerScopeResolver:scope(OWNER_A),query:'F3I',page:1,limit:1});
  assert.equal(first.pagination.total,2); assert.equal(first.results.length,1); assert.equal(warm.metrics.cache,'hit'); assert.equal(calls.length,firstCalls);
  assert.ok(invalidateCrmSearchCache({contactId:101})>=1);
  const refreshed=await searchScopedCrm({supabase:createStore(calls),validatedIdentity:identity(OWNER_A),ownerScopeResolver:scope(OWNER_A),query:'F3I',page:2,limit:1});
  assert.equal(refreshed.results.length,1); assert.ok(calls.length>firstCalls);
});

test('V4 conversation creates a read-only CRM plan and asks for clarification when it has no verified clue', async () => {
  const understanding=v1Understanding();
  const plan=planCrmSearchFromUnderstanding({understanding,state:createOwnerConversationState()});
  assert.equal(plan.outcome,'crm_search_ready'); assert.equal(plan.execute,false); assert.match(plan.query,/Carlos/);
  const noClue=planCrmSearchFromUnderstanding({understanding:{constraints:{},target_reference:{},ambiguity:true},state:createOwnerConversationState()});
  assert.equal(noClue.outcome,'needs_clarification');
  const turn=await processOwnerTurn({utterance:'¿Qué pasó con Carlos?',provider:async()=>understanding,candidates:[],state:createOwnerConversationState()});
  assert.equal(turn.crm_search.outcome,'crm_search_ready'); assert.equal(turn.crm_search.execute,false);
});

test('personal WhatsApp reuses the owner brain and injected CRM search mock without commercial effects', async () => {
  let searches=0;
  const result=await processOwnerPersonalCrmQuery({
    classification:{scope:'owner_personal',owner_key:'primary'}, utterance:'Busca a Carlos', provider:async()=>v1Understanding({constraints:{name:{value:'Carlos',certainty:'confirmed'}},entity_mentions:[{kind:'proper_name',value:'Carlos',source:'utterance',certainty:'confirmed',evidence:'Carlos'}]}), candidates:[], providerEventId:'F3I-EVT',messageId:'F3I-MSG',hmacSecret:'F3I-local-secret-123456789',
    searchCrm:async request=>{searches+=1;assert.equal(request.owner_key,'primary');assert.equal(request.execute,false);return {outcome:'results_found',results:[{contact_id:101}]};}
  });
  assert.equal(searches,1); assert.equal(result.crm_search.results.results[0].contact_id,101); assert.equal(result.commercial_effects_allowed,false); assert.equal(result.proposal.execute,false);
});

test('Preview handler authenticates, rejects injected owner fields, limits data to the isolated Supabase host and makes no commercial writes', async () => {
  const before=Object.fromEntries(Object.keys(ENV).map(key=>[key,process.env[key]])); Object.assign(process.env,ENV);
  const originalFetch=global.fetch; const calls=[];
  try {
    global.fetch=async(rawUrl,options={})=>{
      const url=String(rawUrl);calls.push({url,method:options.method||'GET'});assert.equal(new URL(url).hostname,'uevilhbstnmmdlgyshlv.supabase.co');
      if(url.includes('/auth/v1/user')) return new Response(JSON.stringify({id:OWNER_A}),{status:200});
      if(url.includes('yarbi_agent_actions')) {
        const row=JSON.parse(options.body)[0];
        return new Response(JSON.stringify([row]),{status:201});
      }
      if(url.includes('yarbi_owner_contact_scope')) return new Response(JSON.stringify([{contact_id:101},{contact_id:102}]),{status:200});
      if(url.includes('crm_contacts')) return new Response(JSON.stringify(rowsFor(CONTACTS,url,'id')),{status:200});
      if(url.includes('contact_identifiers')) return new Response(JSON.stringify(rowsFor(IDENTIFIERS,url)),{status:200});
      if(url.includes('operational_memory')) return new Response(JSON.stringify(rowsFor(MEMORY,url)),{status:200});
      if(url.includes('whatsapp_messages')) return new Response(JSON.stringify(rowsFor(MESSAGES,url)),{status:200});
      if(url.includes('ai_message_analysis')) return new Response(JSON.stringify(rowsFor(ANALYSES,url)),{status:200});
      if(url.includes('agenda_events')) return new Response(JSON.stringify(rowsFor(AGENDA,url)),{status:200});
      if(url.includes('yarbi_receivables')) return new Response(JSON.stringify(rowsFor(RECEIVABLES,url)),{status:200});
      throw new Error('unexpected request');
    };
    const handler=require('../api_handlers/assistant/crm-search'); let code=0;let body;
    const res={status:value=>{code=value;return res;},json:value=>{body=value;return res;}};
    await handler({method:'POST',url:'/api/assistant/crm-search',headers:{authorization:'Bearer local-owner-token'},body:{query:'Carlos'}},res);
    assert.equal(code,200);assert.equal(body.execute,false);assert.deepEqual(body.results.map(row=>row.contact_id),[101]);
    const writes=calls.filter(call=>call.method!=='GET'&&!call.url.includes('yarbi_agent_actions'));
    assert.equal(writes.length,0);
    await handler({method:'POST',url:'/api/assistant/crm-search',headers:{authorization:'Bearer local-owner-token'},body:{owner_id:OWNER_B,query:'Carlos'}},res);
    assert.equal(code,400);assert.equal(body.error,'owner_scope_client_input_forbidden');
  } finally { global.fetch=originalFetch; for(const [key,value] of Object.entries(before)) value===undefined?delete process.env[key]:process.env[key]=value; }
});

test('instructions and operational memory remain the existing single systems with explicit review and provenance', () => {
  const memoryUi=fs.readFileSync(path.join(__dirname,'..','frontend','yarbi-memory-center.js'),'utf8');
  const preferences=fs.readFileSync(path.join(__dirname,'..','api_handlers','assistant','preferences.js'),'utf8');
  assert.match(memoryUi,/Aún no la guardé/); assert.match(memoryUi,/Aprobar y guardar/); assert.match(preferences,/yarbi_instructions/); assert.match(preferences,/set_active/);
  assert.equal(memoryUi.includes('convertir automáticamente cualquier mensaje'),false);
});
