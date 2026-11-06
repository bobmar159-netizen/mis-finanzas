'use strict';

// Medición reproducible local: compara la misma recuperación sintética sin y
// con caché caliente. No representa Supabase, Vercel, Gemini ni producción.
const { performance } = require('node:perf_hooks');
const fs = require('node:fs');
const path = require('node:path');
const { createScopedAsyncCache } = require('../lib/yarbi-scoped-cache');
const { searchClients } = require('../lib/yarbi-client-search');

const records = Array.from({length:96}, (_, index) => ({
  id:index + 1, owner_id:'FPC-OWNER', display_name:`Cliente Sintético ${index + 1}`,
  phone:`999000${String(index).padStart(3,'0')}`, district:index % 2 ? 'Comas' : 'Ate',
  latest_service:index % 3 ? 'reparacion' : 'instalacion_nueva', commercial_status:index % 2 ? 'tibio' : 'frio',
  conversation_summary:index % 3 ? 'Solicitó arreglo de servicio.' : 'Consultó instalación nueva.', pending_step:index % 4 ? '' : 'pendiente de visita'
}));
function percentile(values, fraction) { const ordered=[...values].sort((a,b)=>a-b); return ordered[Math.min(ordered.length-1,Math.max(0,Math.ceil(ordered.length*fraction)-1))]; }
function stats(values) { return { samples:values.length, p50_ms:Number(percentile(values,.5).toFixed(4)), p95_ms:Number(percentile(values,.95).toFixed(4)), min_ms:Number(Math.min(...values).toFixed(4)), max_ms:Number(Math.max(...values).toFixed(4)) }; }
function query() { return searchClients({records,ownerId:'FPC-OWNER',requesterOwnerId:'FPC-OWNER',query:'arreglo comas',filters:{status:'tibio'}}); }

(async()=>{
  const rounds=300; const baseline=[]; for(let i=0;i<rounds;i+=1){const start=performance.now();query();baseline.push(performance.now()-start);}
  const cache=createScopedAsyncCache({ttlMs:60000,maxEntries:4});
  await cache.getOrLoad({ownerId:'FPC-OWNER',contactIds:records.map(row=>row.id),key:{query:'arreglo comas',status:'tibio'},load:async()=>query()});
  const warm=[]; for(let i=0;i<rounds;i+=1){const start=performance.now();await cache.getOrLoad({ownerId:'FPC-OWNER',contactIds:records.map(row=>row.id),key:{query:'arreglo comas',status:'tibio'},load:async()=>query()});warm.push(performance.now()-start);}
  const result={schema:'yarbi.product-completion-performance.v1',environment:'local_synthetic',rounds,baseline_direct_search:stats(baseline),cached_warm_search:stats(warm),notes:['Misma consulta y fixtures sintéticos.', 'No mide red, Supabase, Vercel, cold starts ni Gemini.']};
  const out=path.join(__dirname,'product-completion-performance.json'); fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n'); console.log(JSON.stringify({phase:'PRODUCT_COMPLETION',result:'LOCAL_PERFORMANCE_MEASURED',evidence:path.basename(out),...result}));
})().catch(error=>{ console.error(JSON.stringify({phase:'PRODUCT_COMPLETION',result:'FAIL',error:error?.message||String(error)})); process.exitCode=1; });
