'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeInboxRows } = require('../lib/yarbi-owner-inbox');
const { configuration, decidePreviewOwnerUiRequest } = require('../lib/preview-owner-ui-policy');

const ENV = Object.freeze({ VERCEL_ENV:'preview', YARBI_PREVIEW_OWNER_UI_ONLY:'true', YARBI_PREVIEW_SUPABASE_PROJECT_REF:'uevilhbstnmmdlgyshlv', SUPABASE_URL:'https://uevilhbstnmmdlgyshlv.supabase.co', SUPABASE_SECRET_KEY:'isolated-service-key-not-real-123456789012345678', YARBI_OWNER_ACCOUNT_ID:'00000000-0000-4000-8000-000000000001' });
const request = (url, method='GET', auth='jwt') => ({ url, method, headers:{ authorization:`Bearer ${auth}` } });

test('UI-01 fails closed and permits only the two authenticated owner routes', () => {
  assert.equal(configuration(ENV).valid, true);
  assert.equal(decidePreviewOwnerUiRequest(request('/api/assistant/owner-inbox'), ENV).allow, true);
  assert.equal(decidePreviewOwnerUiRequest(request('/api/assistant/owner-action','POST'), ENV).allow, true);
  assert.equal(decidePreviewOwnerUiRequest(request('/api/webhook','POST'), ENV).allow, false);
  assert.equal(decidePreviewOwnerUiRequest(request('/api/assistant/owner-inbox','POST'), ENV).allow, false);
  assert.equal(configuration({ ...ENV, SUPABASE_URL:'https://haifktjvyhbsazmiyqps.supabase.co' }).valid, false);
  assert.equal(configuration({ ...ENV, GEMINI_API_KEY:'forbidden' }).valid, false);
});

test('UI-01 sanitizes cards and supports empty, null-confirmed and multi-recommendation views without internal payloads', () => {
  assert.deepEqual(sanitizeInboxRows([]).items, []);
  const result = sanitizeInboxRows([{ id:44, urgency:'high', status:'delivered', owner_decision_status:'pending', created_at:'2026-10-31T10:00:00Z', payload:{ business_snapshot:{daily_goal:700,confirmed_today:null,remaining_to_goal:700,currency:'PEN'}, items:[
    { type:'customer_action',action:'ask_for_location',priority:'high',reason:'Falta ubicación',requires_authorization:true,contact:{name:'F3UI Cliente',service:'punto_adicional',commercial_status:'caliente'} },
    { type:'owner_review',action:'review_conflict',priority:'medium',reason:'Revisar datos',requires_authorization:false }
  ], secret:'must-not-leak' } }]);
  assert.equal(result.items.length, 2); assert.equal(result.items[0].contact.name, 'F3UI Cliente');
  assert.equal(result.items[0].actionable, true); assert.equal(result.items[1].actionable, false);
  assert.equal(result.summary.confirmed_today, null); assert.equal(JSON.stringify(result).includes('must-not-leak'), false);
});
