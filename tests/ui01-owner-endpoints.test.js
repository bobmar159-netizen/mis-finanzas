'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ENV = { VERCEL_ENV:'preview', YARBI_PREVIEW_OWNER_UI_ONLY:'true', YARBI_PREVIEW_SUPABASE_PROJECT_REF:'uevilhbstnmmdlgyshlv', SUPABASE_URL:'https://uevilhbstnmmdlgyshlv.supabase.co', SUPABASE_SECRET_KEY:'isolated-service-key-not-real-123456789012345678', YARBI_OWNER_ACCOUNT_ID:'00000000-0000-4000-8000-000000000001' };
function responseBox() { let statusCode; let body; return { status(value){statusCode=value;return this;},json(value){body=value;return this;},get value(){return {statusCode,body};} }; }
function setEnv() { const before={}; for(const [key,value] of Object.entries(ENV)){before[key]=process.env[key];process.env[key]=value;} return () => Object.entries(before).forEach(([key,value])=>value===undefined?delete process.env[key]:process.env[key]=value); }

test('UI-01 list endpoint authenticates the owner, reads only isolated inbox rows and exposes a sanitized response', async () => {
  const restore=setEnv(), original=global.fetch, calls=[]; try {
    global.fetch=async (url,options={}) => { calls.push(String(url)); if(String(url).includes('/auth/v1/user')) return new Response(JSON.stringify({id:ENV.YARBI_OWNER_ACCOUNT_ID}),{status:200}); return new Response(JSON.stringify([{id:3,urgency:'high',status:'delivered',owner_decision_status:'pending',created_at:'2026-10-31T10:00:00Z',payload:{items:[{type:'customer_action',action:'ask_for_location',priority:'high',reason:'F3UI reason',requires_authorization:true}]}}]),{status:200}); };
    const handler=require('../api/assistant/owner-inbox'); const res=responseBox(); await handler({method:'GET',url:'/api/assistant/owner-inbox',headers:{authorization:'Bearer account-jwt'}},res);
    assert.equal(res.value.statusCode,200); assert.equal(res.value.body.items.length,1); assert.equal(JSON.stringify(res.value.body).includes(ENV.SUPABASE_SECRET_KEY),false); assert.equal(calls.every(url=>url.startsWith('https://uevilhbstnmmdlgyshlv.supabase.co/')),true);
  } finally { global.fetch=original;restore(); }
});

test('UI-01 action endpoint uses account auth and delegates a decision to the existing atomic RPC', async () => {
  const restore=setEnv(), original=global.fetch, calls=[]; try {
    global.fetch=async (url,options={}) => { calls.push(String(url)); if(String(url).includes('/auth/v1/user')) return new Response(JSON.stringify({id:ENV.YARBI_OWNER_ACCOUNT_ID}),{status:200}); return new Response(JSON.stringify([{outcome:'authorized',decision_id:1,owner_status:'authorized',execution_state:'authorized_pending_execution'}]),{status:200}); };
    const handler=require('../api/assistant/owner-action'); const res=responseBox(); await handler({method:'POST',url:'/api/assistant/owner-action',headers:{authorization:'Bearer account-jwt'},body:{inbox_id:3,item_index:0,decision:'authorize'}},res);
    assert.equal(res.value.statusCode,200); assert.equal(res.value.body.outcome,'authorized'); assert.equal(calls.some(url=>url.endsWith('/rest/v1/rpc/apply_yarbi_owner_action')),true);
  } finally { global.fetch=original;restore(); }
});
