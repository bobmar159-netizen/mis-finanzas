const { processLocationInput } = require('../../lib/location-resolver');
const { validateServerRouteConfig } = require('../../lib/yarbi-runtime-config');
const { authenticatedOwnerIdentity } = require('../../lib/yarbi-owner-ui-auth');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.APP_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
}
module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const runtime = validateServerRouteConfig({ requirePublicAuth: true });
  if (!runtime.ok) return res.status(503).json({ error: 'configuration_invalid', code: runtime.code });
  const authenticated = await authenticatedOwnerIdentity(req, runtime);
  if (!authenticated.ok) return res.status(authenticated.status).json({ error: authenticated.code });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const input = String(body.url || '').trim();
    if (!input) return res.status(400).json({ error: 'url_required' });
    const result = await processLocationInput(input);
    if (!result?.hasExactCoordinates) return res.status(422).json({ error: 'exact_coordinates_not_found', sourceUrl: result?.sourceUrl || input });
    return res.status(200).json(result);
  } catch (error) {
    console.error('[LOCATION RESOLVE]', error);
    return res.status(500).json({ error: 'location_resolve_failed' });
  }
};
