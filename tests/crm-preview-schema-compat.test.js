'use strict';

// Contrato del catálogo aislado validado (2026-11-05). No usa Supabase real.
const test = require('node:test');
const assert = require('node:assert/strict');
const {searchScopedCrm} = require('../lib/yarbi-crm-search-runtime');
const {createScopedAsyncCache} = require('../lib/yarbi-scoped-cache');

const OWNER = '11111111-1111-4111-8111-111111111111';

// PostgREST falla con 400 si se selecciona una columna inexistente.
// En el Preview aislado crm_contacts NO tiene operational_status.
test('CRM Preview: selects only actual contact columns; missing optional tables do not block search', async () => {
  const calls = [];
  const supabase = async (path) => {
    calls.push(path);
    if (path.includes('/crm_contacts?')) {
      const fields = new URL('https://preview.invalid' + path).searchParams.get('select').split(',');
      const realColumns = new Set(['id','full_name','display_name','commercial_status','latest_service','last_contact_at','updated_at']);
      if (fields.some(field => !realColumns.has(field))) return {response:{ok:false,status:400},data:{code:'42703'}};
      return {response:{ok:true,status:200},data:[{
        id:101, full_name:'Carlos de prueba', display_name:'Carlos',
        commercial_status:'pendiente', latest_service:'terma',
        last_contact_at:'2026-11-01T12:00:00Z', updated_at:'2026-11-01T12:00:00Z'
      }]};
    }
    if (path.includes('/agenda_events?') || path.includes('/yarbi_receivables?')) {
      return {response:{ok:false,status:404},data:{code:'PGRST205'}};
    }
    return {response:{ok:true,status:200},data:[]};
  };
  const result = await searchScopedCrm({
    supabase,
    validatedIdentity:{kind:'validated_auth_identity',subject:OWNER},
    ownerScopeResolver:async () => ({owner_id:OWNER,contact_ids:[101],verification:'canonical_owner_contact_scope'}),
    query:'Carlos',
    cache:createScopedAsyncCache({ttlMs:15000,maxEntries:8})
  });
  assert.equal(result.results.length,1);
  assert.equal(result.results[0].contact_id,101);
  assert.equal(result.metrics.sources.agenda,'unavailable');
  assert.equal(result.metrics.sources.receivables,'unavailable');
  assert.equal(result.metrics.sources.contacts,'available');
  assert.equal(result.metrics.query_count,7);
  assert.equal(calls.length,7);
});
