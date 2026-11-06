'use strict';

const { createProactiveSupabaseStore } = require('../../lib/yarbi-proactive-supabase-store');
const { runProactiveLoop } = require('../../lib/yarbi-proactive-loop');

const PREVIEW_REF = 'uevilhbstnmmdlgyshlv';

function token(req) { return String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim(); }
function fixtureCandidatePrefix(env) {
  const prefix = String(env.YARBI_F3J_REMOTE_FIXTURE_PREFIX || '').trim();
  const enabled = String(env.YARBI_F3J_REMOTE_TEST_MODE || '').trim().toLowerCase() === 'true';
  if (!prefix && !enabled) return null;
  return enabled && prefix === 'F3J-REMOTE-' ? prefix : undefined;
}
function safeEnv(env) {
  const url = String(env.SUPABASE_URL || '').trim();
  let parsed;
  try { parsed = new URL(url); } catch (_) { return null; }
  const prefix = fixtureCandidatePrefix(env);
  if (env.VERCEL_ENV !== 'preview' || env.YARBI_PREVIEW_PROACTIVE_LOOP_ONLY !== 'true'
    || env.YARBI_PREVIEW_SUPABASE_PROJECT_REF !== PREVIEW_REF
    || parsed.protocol !== 'https:' || parsed.hostname !== `${PREVIEW_REF}.supabase.co`
    || !String(env.SUPABASE_SECRET_KEY || '').trim() || !String(env.CRON_SECRET || '').trim() || prefix === undefined) return null;
  return { url: parsed.toString().replace(/\/$/, ''), key: env.SUPABASE_SECRET_KEY, cronSecret: env.CRON_SECRET, fixtureCandidatePrefix: prefix };
}

function createSupabaseClient(config) {
  return async (path, options = {}) => {
    const response = await fetch(config.url + path, {
      ...options,
      headers: { apikey: config.key, Authorization: 'Bearer ' + config.key, ...(options.headers || {}) }
    });
    return { response, data: await response.json().catch(() => ({})) };
  };
}

function intervalPolicy(env) {
  const minutes = Number(env.YARBI_PROACTIVE_INTERVAL_MINUTES || 15);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) return null;
  return { interval_ms: minutes * 60 * 1000 };
}

module.exports = async function proactiveLoopHandler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  const config = safeEnv(process.env);
  if (!config) return res.status(503).json({ ok: false, error: 'proactive_preview_not_configured' });
  if (token(req) !== config.cronSecret) return res.status(401).json({ ok: false, error: 'unauthorized_cron' });
  const policy = intervalPolicy(process.env);
  if (!policy) return res.status(503).json({ ok: false, error: 'proactive_interval_invalid' });
  const store = createProactiveSupabaseStore({ supabase: createSupabaseClient(config), fixtureCandidatePrefix: config.fixtureCandidatePrefix });
  const result = await runProactiveLoop({ store, now: new Date().toISOString(), policy: { ...policy, fixture_candidate_prefix: config.fixtureCandidatePrefix } });
  return res.status(result.status === 'failed' ? 502 : 200).json({ ok: result.status !== 'failed', run_key: result.run_key, status: result.status, reason: result.reason || null, next_review_at: result.next_review_at || null });
};

module.exports.createSupabaseClient = createSupabaseClient;
module.exports.intervalPolicy = intervalPolicy;
module.exports.safeEnv = safeEnv;
