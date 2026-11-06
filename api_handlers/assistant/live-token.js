const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GEMINI_KEY || '';
const ASSISTANT_TOKEN = process.env.ASSISTANT_API_TOKEN || process.env.TOKEN_API_DE_ASISTENTE || '';
const GEMINI_LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-3.1-flash-live-preview';
const GEMINI_LIVE_API_VERSION = process.env.GEMINI_LIVE_API_VERSION || 'v1alpha';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.APP_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Assistant-Token');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
}

function authorized(req) {
  const header = req.headers?.['x-assistant-token'] || req.headers?.authorization || '';
  const token = String(header).replace(/^Bearer\s+/i, '').trim();
  return Boolean(ASSISTANT_TOKEN && token && token === ASSISTANT_TOKEN);
}

function safeDetail(data, fallback) {
  return String(data?.error?.message || data?.error?.status || fallback || 'Live token request failed')
    .replace(/AIza[0-9A-Za-z_-]+/g, '[redacted-key]')
    .slice(0, 300);
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!ASSISTANT_TOKEN || !GEMINI_KEY) return res.status(503).json({ error: 'assistant_not_configured' });
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' });

  try {
    const requestedProtocol = String(req.query?.protocol || req.headers?.['x-gemini-live-protocol'] || '').trim().toLowerCase();
    const apiVersion = requestedProtocol === 'v1beta' ? 'v1beta' : GEMINI_LIVE_API_VERSION;
    const now = Date.now();
    const payload = {
      uses: 1,
      expireTime: new Date(now + 30 * 60 * 1000).toISOString(),
      newSessionExpireTime: new Date(now + 60 * 1000).toISOString()
    };
    const result = await fetch('https://generativelanguage.googleapis.com/' + apiVersion + '/auth_tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
      body: JSON.stringify(payload)
    });
    const data = await result.json().catch(() => ({}));
    const tokenName = data.name || data.authToken?.name || '';
    if (!result.ok || !tokenName) {
      const detail = safeDetail(data, `HTTP ${result.status}`);
      console.error('[ASSISTANT LIVE TOKEN ERROR]', JSON.stringify({ status: result.status, detail }));
      return res.status(502).json({ error: 'live_token_error', detail });
    }
    return res.status(200).json({ token: tokenName, model: GEMINI_LIVE_MODEL, apiVersion, protocol: apiVersion === 'v1beta' ? 'gemini-live-v1beta-384' : 'legacy-default' });
  } catch (error) {
    console.error('[ASSISTANT LIVE TOKEN]', error);
    return res.status(500).json({ error: 'live_token_failed' });
  }
};



