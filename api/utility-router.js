'use strict';

// P0.6 staging router. A closed allow-list prevents arbitrary local module execution.
const handlers = Object.freeze({
  trace: require('../api_handlers/audit/trace.js'),
  resolve: require('../api_handlers/location/resolve.js')
});

function restorePublicUrl(req, route) {
  const parsed = new URL(String(req.url || '/api/utility-router'), 'http://localhost');
  parsed.searchParams.delete('__p06_route');
  const path = route === 'trace' ? '/api/audit/trace' : '/api/location/resolve';
  const query = parsed.searchParams.toString();
  req.url = `${path}${query ? `?${query}` : ''}`;
}

async function handler(req, res) {
  const parsed = new URL(String(req.url || '/api/utility-router'), 'http://localhost');
  const route = parsed.searchParams.get('__p06_route') || '';
  const target = handlers[route];
  if (!target) return res.status(404).json({ error: 'utility_route_not_found' });
  restorePublicUrl(req, route);
  return target(req, res);
}

handler.routeNames = Object.freeze(Object.keys(handlers));
module.exports = handler;
