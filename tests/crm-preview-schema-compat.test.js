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

test('CRM search reaches the last client in a complete 2,000-contact owner scope through bounded batches', async () => {
  const ids = Array.from({ length: 2000 }, (_, index) => index + 1);
  const contactBatches = [];
  const supabase = async path => {
    if (path.includes('/crm_contacts?')) {
      const match = decodeURIComponent(path).match(/id=in\.\(([^)]+)\)/);
      const batch = (match?.[1] || '').split(',').map(Number).filter(Number.isSafeInteger);
      contactBatches.push(batch);
      return { response: { ok: true }, data: batch.includes(2000) ? [{
        id: 2000, full_name: 'F3-ALL-SCOPE-LAST', display_name: 'F3-ALL-SCOPE-LAST',
        commercial_status: 'frio', latest_service: 'terma', last_contact_at: null, updated_at: null
      }] : [] };
    }
    return { response: { ok: true }, data: [] };
  };
  const result = await searchScopedCrm({
    supabase,
    validatedIdentity: { kind: 'validated_auth_identity', subject: OWNER },
    ownerScopeResolver: async () => ({ owner_id: OWNER, contact_ids: ids, verification: 'canonical_owner_contact_scope', pagination: { complete: true, page_size: 100 } }),
    query: 'F3-ALL-SCOPE-LAST',
    cache: createScopedAsyncCache({ ttlMs: 15000, maxEntries: 8 })
  });
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].contact_id, 2000);
  assert.equal(result.scope.contact_count, 2000);
  assert.equal(contactBatches.length, Math.ceil(2000 / 96));
  assert.ok(contactBatches.every(batch => batch.length <= 96));
  assert.ok(contactBatches.at(-1).includes(2000));
  assert.equal(result.metrics.query_count, Math.ceil(2000 / 96) * 7);
});

test('CRM search fails closed on an oversized scope without a completeness proof', async () => {
  let dataCalls = 0;
  const result = await searchScopedCrm({
    supabase: async () => { dataCalls += 1; return { response: { ok: true }, data: [] }; },
    validatedIdentity: { kind: 'validated_auth_identity', subject: OWNER },
    ownerScopeResolver: async () => ({ owner_id: OWNER, contact_ids: Array.from({ length: 97 }, (_, index) => index + 1), verification: 'canonical_owner_contact_scope' }),
    query: 'Carlos', cache: createScopedAsyncCache({ ttlMs: 1, maxEntries: 2 })
  });
  assert.equal(result.outcome, 'owner_scope_incomplete');
  assert.equal(result.results.length, 0);
  assert.equal(dataCalls, 0);
});
