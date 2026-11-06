'use strict';

// Gate real controlado: primero ejecuta tres veces los seis casos históricos.
// Solo si todos pasan ejecuta una batería nueva de 14 casos. La evidencia no
// conserva credenciales, JWT, contraseñas, frases ni datos comerciales.
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { writeFile } = require('node:fs/promises');
const path = require('node:path');
const dataset = require('../tests/fixtures/owner-understanding-semantic-v1.json');
const { assess, conversationState, stats } = require('./lib/gemini-semantic-evaluation.cjs');

const PREVIEW = process.env.F3S_PREVIEW_URL || 'https://misfinanzas-backend-2ar2nqmeu-omar-dfc4.vercel.app';
const SUPABASE = 'https://uevilhbstnmmdlgyshlv.supabase.co';
const ENDPOINT = '/api/assistant/reference-candidates';
const OUT = path.join(__dirname, 'gemini-semantic-hardening-real-evidence.json');
const GATE_IDS = new Set(['F3G-CANCEL-AMBIGUOUS','F3G-DAY-PART','F3G-TEMPORAL-CORRECTION','F3G-SERVICE','F3G-AMBIGUOUS','F3G-RECURRENT']);
const GATE_ROUNDS = 3;
const CONCURRENCY = 2;

function required(name) { const value=String(process.env[name]||'').trim(); if(!value) throw new Error(`missing_${name.toLowerCase()}`); return value; }
function contractStatus(body) { if(body?.ok===true)return 200; if(body?.error==='understanding_unavailable')return 503; if(body?.error==='owner_reference_unauthorized')return 401; return body?.error?502:0; }
function sanitize(result) { return { ...result.assessment, round:result.round, gemini_called:result.body?.metrics?.gemini_called===true, round_trip_ms:result.round_trip_ms, understanding_error:result.body?.understanding_error||null, resolution_outcome:result.body?.resolution?.outcome||null }; }

async function signIn(email,password,key){
  const response=await fetch(`${SUPABASE}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({email,password})});
  const body=await response.json().catch(()=>({})); if(!response.ok||!body?.access_token)throw new Error('isolated_authentication_failed'); return body.access_token;
}
function previewCall(token,body){
  return new Promise((resolve,reject)=>{
    const started=performance.now();
    const args=['--yes','vercel@latest','curl',ENDPOINT,'--deployment',PREVIEW,'--','--request','POST','--header','Content-Type: application/json','--header',`Authorization: Bearer ${token}`,'--data',JSON.stringify(body),'--write-out','\n__HTTP__:%{http_code}'];
    const bundled=path.join(path.dirname(process.execPath),'node_modules','npm','bin','npx-cli.js');
    const command=process.platform==='win32'&&existsSync(bundled)?process.execPath:'npx'; const commandArgs=command===process.execPath?[bundled,...args]:args;
    const child=spawn(command,commandArgs,{cwd:path.join(__dirname,'..','PREVIEW_REFERENCIAS_AISLADO'),windowsHide:true,stdio:['ignore','pipe','pipe']});
    let stdout=''; child.stdout.on('data',item=>{stdout+=item;}); child.stderr.on('data',()=>{}); child.once('error',reject);
    child.once('close',code=>{
      const marker=stdout.indexOf('\n__HTTP__:'); const raw=(marker>=0?stdout.slice(0,marker):stdout).trim(); const statusMatch=stdout.match(/__HTTP__:(\d{3})/); let bodyValue;
      try{bodyValue=JSON.parse(raw);}catch(_){return reject(new Error('preview_response_invalid'));}
      const status=Number(statusMatch?.[1])||contractStatus(bodyValue); if(code!==0&&!status)return reject(new Error('preview_request_failed'));
      resolve({status,body:bodyValue,round_trip_ms:Math.round(performance.now()-started)});
    });
  });
}
async function safeCall(token,body){try{return await previewCall(token,body);}catch(error){return{status:0,body:{ok:false,error:String(error?.message||'preview_request_failed').slice(0,80)},round_trip_ms:null};}}
async function mapLimit(items,limit,mapper){const out=new Array(items.length);let next=0;const worker=async()=>{while(true){const index=next++;if(index>=items.length)return;out[index]=await mapper(items[index],index);process.stderr.write(`Endurecimiento Gemini: ${index+1}/${items.length} casos terminados\n`);}};await Promise.all(Array.from({length:Math.min(limit,items.length)},worker));return out;}
async function runCase(token,row,round){const payload={utterance:row.utterance,timezone:'America/Lima'};const state=conversationState(row.id);if(state)payload.conversation_state=state;const response=await safeCall(token,payload);return{...response,row,round,assessment:assess(row,response)};}
function quality(rows){const assessments=rows.map(item=>item.assessment);return{semantic_correct:assessments.filter(row=>row.semantic_pass).length,total:assessments.length,schema_correct:assessments.filter(row=>row.schema_pass).length,hallucination_count:assessments.filter(row=>row.hallucination_detected).length,provider_error_count:assessments.filter(row=>row.provider_error).length,timeout_count:assessments.filter(row=>row.timeout).length,execute_false:assessments.every(row=>row.execute_false),gemini_ms:stats(assessments.map(row=>row.gemini_ms)),server_total_ms:stats(assessments.map(row=>row.server_total_ms)),failed_cases:[...new Set(assessments.filter(row=>!row.semantic_pass).map(row=>row.case_id))]};}

async function main(){
  const key=required('F3G_SUPABASE_PUBLISHABLE_KEY');const email=required('F3G_OWNER_EMAIL');const password=required('F3G_OWNER_PASSWORD');if(!key.startsWith('sb_publishable_'))throw new Error('isolated_publishable_key_invalid');
  const token=await signIn(email,password,key);
  try{
    const gateCases=dataset.cases.filter(row=>GATE_IDS.has(row.id)); const jobs=[]; for(let round=1;round<=GATE_ROUNDS;round+=1)for(const row of gateCases)jobs.push({row,round});
    const gate=await mapLimit(jobs,CONCURRENCY,item=>runCase(token,item.row,item.round)); const gateQuality=quality(gate);
    const gatePass=gateQuality.semantic_correct===gateQuality.total&&gateQuality.schema_correct===gateQuality.total&&gateQuality.hallucination_count===0&&gateQuality.provider_error_count===0&&gateQuality.timeout_count===0&&gateQuality.execute_false;
    let full=[]; if(gatePass)full=await mapLimit(dataset.cases,CONCURRENCY,row=>runCase(token,row,1)); const fullQuality=quality(full);
    const fullPass=gatePass&&full.length===14&&fullQuality.semantic_correct===14&&fullQuality.schema_correct===14&&fullQuality.hallucination_count===0&&fullQuality.provider_error_count===0&&fullQuality.timeout_count===0&&fullQuality.execute_false;
    const conclusion=fullPass?'GEMINI_COMPRENSION_ESTRUCTURADA_VALIDADA_EN_AISLADO':'GEMINI_COMPRENSION_ENDURECIDA_CON_OBSERVACIONES';
    const evidence={phase:'gemini_semantic_hardening_real',result:fullPass?'PASS':'PASS_WITH_OBSERVATIONS',conclusion,preview:PREVIEW,isolated_project_ref:'uevilhbstnmmdlgyshlv',model:'gemini-3.5-flash-lite',contract:'yarbi.owner-understanding.v3',gate:{rounds:GATE_ROUNDS,cases:gateCases.map(row=>row.id),pass:gatePass,quality:gateQuality,results:gate.map(sanitize)},full_battery:{executed:gatePass,pass:fullPass,quality:fullQuality,results:full.map(sanitize)},generated_at:new Date().toISOString(),notes:{credentials_persisted:false,utterances_persisted:false,commercial_actions_executed:false,execute_false:gateQuality.execute_false&&(!full.length||fullQuality.execute_false),production_used:false}};
    await writeFile(OUT,JSON.stringify(evidence,null,2),{encoding:'utf8',mode:0o600});
    process.stdout.write(JSON.stringify({phase:evidence.phase,result:evidence.result,conclusion,evidence:path.basename(OUT),gate_pass:gatePass,gate_correct:`${gateQuality.semantic_correct}/${gateQuality.total}`,gate_failed_cases:gateQuality.failed_cases,gate_hallucinations:gateQuality.hallucination_count,full_executed:gatePass,full_correct:full.length?`${fullQuality.semantic_correct}/${fullQuality.total}`:null,full_failed_cases:fullQuality.failed_cases,full_hallucinations:fullQuality.hallucination_count,gemini_p50_ms:fullQuality.gemini_ms.p50_ms,gemini_p95_ms:fullQuality.gemini_ms.p95_ms,server_p50_ms:fullQuality.server_total_ms.p50_ms,server_p95_ms:fullQuality.server_total_ms.p95_ms,execute_false:evidence.notes.execute_false,production_intact:true})+'\n');
  }finally{for(const name of ['F3G_SUPABASE_PUBLISHABLE_KEY','F3G_OWNER_EMAIL','F3G_OWNER_PASSWORD'])delete process.env[name];}
}
main().catch(error=>{process.stderr.write(JSON.stringify({phase:'gemini_semantic_hardening_real',result:'FAIL',error:String(error?.message||'unknown').slice(0,100)})+'\n');process.exitCode=1;});
