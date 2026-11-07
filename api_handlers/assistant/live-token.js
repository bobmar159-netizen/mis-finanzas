const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GEMINI_KEY || '';
const GEMINI_LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-3.1-flash-live-preview';
const GEMINI_LIVE_API_VERSION = process.env.GEMINI_LIVE_API_VERSION || 'v1alpha';
const { validateServerRouteConfig } = require('../../lib/yarbi-runtime-config');
const { authenticatedOwnerIdentity } = require('../../lib/yarbi-owner-ui-auth');

function cors(res) {
  // No usamos comodín en un endpoint que exige una sesión. Las aplicaciones
  // mismo-origen no necesitan CORS y Android debe declarar APP_ORIGIN.
  if (process.env.APP_ORIGIN) res.setHeader('Access-Control-Allow-Origin', process.env.APP_ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const runtime = validateServerRouteConfig({ requirePublicAuth: true });
  if (!runtime.ok) return res.status(503).json({ error: 'configuration_invalid', code: runtime.code });
  if (!GEMINI_KEY) return res.status(503).json({ error: 'assistant_not_configured' });
  const identity = await authenticatedOwnerIdentity(req, runtime);
  if (!identity.ok) return res.status(identity.status).json({ error: identity.code });

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
      // La respuesta de Gemini puede contener detalles del proveedor. No la
      // exponemos al navegador ni a logs para no filtrar credenciales o datos.
      console.error('[ASSISTANT LIVE TOKEN ERROR]', JSON.stringify({ status: result.status, category: 'provider_rejected' }));
      return res.status(502).json({ error: 'live_token_error' });
    }
    return res.status(200).json({ token: tokenName, model: GEMINI_LIVE_MODEL, apiVersion, protocol: apiVersion === 'v1beta' ? 'gemini-live-v1beta-384' : 'legacy-default' });
  } catch (_) {
    console.error('[ASSISTANT LIVE TOKEN]', JSON.stringify({ category: 'request_failed' }));
    return res.status(500).json({ error: 'live_token_failed' });
  }
};



