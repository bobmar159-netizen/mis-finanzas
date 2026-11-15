'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { productionConfiguration, decideOwnerConversationRequest } = require('../lib/yarbi-owner-conversation-policy');

const ENV = Object.freeze({
  VERCEL_ENV: 'production',
  YARBI_OWNER_CONVERSATION_ENABLED: 'true',
  YARBI_OWNER_CONVERSATION_PROJECT_REF: 'haifktjvyhbsazmiyqps',
  SUPABASE_URL: 'https://haifktjvyhbsazmiyqps.supabase.co',
  SUPABASE_SECRET_KEY: 'synthetic-server-secret-not-real',
  SUPABASE_PUBLISHABLE_KEY: 'synthetic-public-key-not-real',
  YARBI_TRACE_HMAC_KEY: 'synthetic-trace-hmac-not-real',
  YARBI_OWNER_CONVERSATION_GEMINI_ENABLED: 'false'
});

test('la conversación de Producción permanece cerrada hasta la bandera, el ref y las claves explícitas', () => {
  assert.equal(productionConfiguration(ENV).valid, true);
  assert.equal(productionConfiguration({ ...ENV, YARBI_OWNER_CONVERSATION_ENABLED: 'false' }).code, 'owner_conversation_production_mode_required');
  assert.equal(productionConfiguration({ ...ENV, YARBI_OWNER_CONVERSATION_PROJECT_REF: 'uevilhbstnmmdlgyshlv' }).code, 'owner_conversation_production_project_not_authorized');
  assert.equal(productionConfiguration({ ...ENV, SUPABASE_URL: 'https://uevilhbstnmmdlgyshlv.supabase.co' }).code, 'owner_conversation_production_supabase_url_not_authorized');
  assert.equal(productionConfiguration({ ...ENV, GEMINI_API_KEY: 'present-but-not-enabled' }).code, 'owner_conversation_gemini_not_enabled');
});

test('la ruta propietaria de Producción exige POST y Bearer antes de autorizar el recorrido', () => {
  const missing = decideOwnerConversationRequest({ method: 'POST', headers: {} }, ENV);
  assert.deepEqual({ allow: missing.allow, status: missing.status, code: missing.code }, { allow: false, status: 401, code: 'owner_conversation_unauthorized' });
  const method = decideOwnerConversationRequest({ method: 'GET', headers: { authorization: 'Bearer synthetic' } }, ENV);
  assert.deepEqual({ allow: method.allow, status: method.status, code: method.code }, { allow: false, status: 405, code: 'owner_conversation_method_not_allowed' });
  const allowed = decideOwnerConversationRequest({ method: 'POST', headers: { authorization: 'Bearer synthetic' } }, ENV);
  assert.equal(allowed.allow, true);
  assert.equal(allowed.state.config.gemini.enabled, false);
});
