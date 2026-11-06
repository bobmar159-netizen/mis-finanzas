'use strict';

// P0.6 staging router. The map is deliberately closed: public rewrites may
// reach only the reviewed Assistant handlers below.
const handlers = Object.freeze({
  chat: require('../api_handlers/assistant/chat.js'),
  collections: require('../api_handlers/assistant/collections.js'),
  command: require('../api_handlers/assistant/command.js'),
  'crm-dossier': require('../api_handlers/assistant/crm-dossier.js'),
  'crm-search': require('../api_handlers/assistant/crm-search.js'),
  'live-token': require('../api_handlers/assistant/live-token.js'),
  'owner-action': require('../api_handlers/assistant/owner-action.js'),
  'owner-inbox': require('../api_handlers/assistant/owner-inbox.js'),
  preferences: require('../api_handlers/assistant/preferences.js'),
  'proactive-loop': require('../api_handlers/assistant/proactive-loop.js'),
  'reference-candidates': require('../api_handlers/assistant/reference-candidates.js'),
  'scheduled-followups': require('../api_handlers/assistant/scheduled-followups.js')
});

function restorePublicUrl(req, route) {
  const parsed = new URL(String(req.url || '/api/assistant-router'), 'http://localhost');
  parsed.searchParams.delete('__p06_route');
  const query = parsed.searchParams.toString();
  req.url = `/api/assistant/${route}${query ? `?${query}` : ''}`;
}

async function handler(req, res) {
  const parsed = new URL(String(req.url || '/api/assistant-router'), 'http://localhost');
  const route = parsed.searchParams.get('__p06_route') || '';
  const target = handlers[route];
  if (!target) return res.status(404).json({ error: 'assistant_route_not_found' });
  restorePublicUrl(req, route);
  return target(req, res);
}

handler.routeNames = Object.freeze(Object.keys(handlers));
module.exports = handler;
