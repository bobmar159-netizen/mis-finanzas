const { processLocationInput } = require('../../lib/location-resolver');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.APP_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Assistant-Token');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
}
function authorized(req) {
  const configured = process.env.ASSISTANT_API_TOKEN || process.env.TOKEN_API_DE_ASISTENTE || '';
  const header = req.headers?.['x-assistant-token'] || req.headers?.authorization || '';
  const token = String(header).replace(/^Bearer\s+/i, '').trim();
  return Boolean(configured && token && token === configured);
}
module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' });
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
