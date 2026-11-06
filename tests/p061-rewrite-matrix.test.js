'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

// Twenty-two public API patterns: webhook exposes one documented alias, so it
// accounts for two URLs but one direct Function. Conversation is routed
// through the existing assistant router, so it does not add a Vercel bundle.
// The two non-API routes in
// vercel.json (/auth/callback and /privacy) are checked separately below.
const apiMatrix = Object.freeze([
  ['/api/webhook', '/api/webhook.js', 'direct:webhook', 'api/webhook.js'],
  ['/api/whatsapp/messages', '/api/webhook.js', 'direct:webhook_alias', 'api/webhook.js'],
  ['/api/supabase-secure', '/api/supabase-secure.js', 'direct:supabase-secure', 'api/supabase-secure.js'],
  ['/api/notion-proxy', '/api/notion-proxy.js', 'direct:notion-proxy', 'api/notion-proxy.js'],
  ['/api/actions/approve', '/api/actions/approve.js', 'direct:approve', 'api/actions/approve.js'],
  ['/api/ai/process', '/api/ai/process.js', 'direct:process', 'api/ai/process.js'],
  ['/api/assistant/send-whatsapp', '/api/assistant/send-whatsapp.js', 'direct:send-whatsapp', 'api/assistant/send-whatsapp.js'],
  ['/api/assistant/chat', '/api/assistant-router.js?__p06_route=chat', 'assistant:chat', 'api_handlers/assistant/chat.js'],
  ['/api/assistant/collections', '/api/assistant-router.js?__p06_route=collections', 'assistant:collections', 'api_handlers/assistant/collections.js'],
  ['/api/assistant/command', '/api/assistant-router.js?__p06_route=command', 'assistant:command', 'api_handlers/assistant/command.js'],
  ['/api/assistant/conversation', '/api/assistant-router.js?__p06_route=conversation', 'assistant:conversation', 'api_handlers/assistant/conversation.js'],
  ['/api/assistant/crm-dossier', '/api/assistant-router.js?__p06_route=crm-dossier', 'assistant:crm-dossier', 'api_handlers/assistant/crm-dossier.js'],
  ['/api/assistant/crm-search', '/api/assistant-router.js?__p06_route=crm-search', 'assistant:crm-search', 'api_handlers/assistant/crm-search.js'],
  ['/api/assistant/live-token', '/api/assistant-router.js?__p06_route=live-token', 'assistant:live-token', 'api_handlers/assistant/live-token.js'],
  ['/api/assistant/owner-action', '/api/assistant-router.js?__p06_route=owner-action', 'assistant:owner-action', 'api_handlers/assistant/owner-action.js'],
  ['/api/assistant/owner-inbox', '/api/assistant-router.js?__p06_route=owner-inbox', 'assistant:owner-inbox', 'api_handlers/assistant/owner-inbox.js'],
  ['/api/assistant/preferences', '/api/assistant-router.js?__p06_route=preferences', 'assistant:preferences', 'api_handlers/assistant/preferences.js'],
  ['/api/assistant/proactive-loop', '/api/assistant-router.js?__p06_route=proactive-loop', 'assistant:proactive-loop', 'api_handlers/assistant/proactive-loop.js'],
  ['/api/assistant/reference-candidates', '/api/assistant-router.js?__p06_route=reference-candidates', 'assistant:reference-candidates', 'api_handlers/assistant/reference-candidates.js'],
  ['/api/assistant/scheduled-followups', '/api/assistant-router.js?__p06_route=scheduled-followups', 'assistant:scheduled-followups', 'api_handlers/assistant/scheduled-followups.js'],
  ['/api/audit/trace', '/api/utility-router.js?__p06_route=trace', 'utility:trace', 'api_handlers/audit/trace.js'],
  ['/api/location/resolve', '/api/utility-router.js?__p06_route=resolve', 'utility:resolve', 'api_handlers/location/resolve.js']
]);

const logicalHandlers = Object.freeze([
  'api/webhook.js', 'api/supabase-secure.js', 'api/notion-proxy.js',
  'api/actions/approve.js', 'api/ai/process.js', 'api/assistant/send-whatsapp.js',
  ...apiMatrix.filter(([, , id]) => id.startsWith('assistant:')).map(([, , , handler]) => handler),
  'api_handlers/audit/trace.js', 'api_handlers/location/resolve.js'
]);

test('F05 rewrite matrix has twenty-two API patterns and keeps the existing Vercel Function budget', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.equal(config.routes.length, 24, '22 API patterns + auth callback + static privacy route');
  const seenSources = new Set();
  for (const route of config.routes) {
    assert.equal(seenSources.has(route.src), false, `duplicate rewrite source: ${route.src}`);
    seenSources.add(route.src);
  }
  assert.equal(new Set(apiMatrix.map(([src]) => src)).size, 22);
  assert.equal(new Set(logicalHandlers).size, 21);
  for (const [src, dest, routerId, handler] of apiMatrix) {
    const matches = config.routes.filter(route => route.src === src);
    assert.equal(matches.length, 1, `one rewrite for ${src}`);
    assert.equal(matches[0].dest, dest, `exact destination for ${src}`);
    assert.equal(fs.existsSync(path.join(root, handler)), true, `handler exists: ${handler}`);
    if (routerId.startsWith('assistant:')) assert.match(dest, /^\/api\/assistant-router\.js\?__p06_route=[a-z-]+$/);
    if (routerId.startsWith('utility:')) assert.match(dest, /^\/api\/utility-router\.js\?__p06_route=(trace|resolve)$/);
  }
  assert.deepEqual(config.routes[0], {
    src: '/auth/callback',
    dest: '/api/assistant-router.js?__p06_route=preferences&action=auth-callback'
  });
  assert.deepEqual(config.routes.at(-1), { src: '/privacy', dest: '/privacy.html' });
});

test('P0.6.1 rewrite ordering is explicit: direct routes precede assistant and utility router routes', () => {
  const routes = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')).routes;
  const directIndexes = routes
    .map((route, index) => [route, index])
    .filter(([route]) => route.src.startsWith('/api/') && !route.dest.includes('-router.js'))
    .map(([, index]) => index);
  const assistantIndexes = routes
    .map((route, index) => [route, index])
    .filter(([route]) => route.src.startsWith('/api/') && route.dest.includes('/api/assistant-router.js?__p06_route='))
    .map(([, index]) => index);
  const utilityIndexes = routes
    .map((route, index) => [route, index])
    .filter(([route]) => route.dest.includes('/api/utility-router.js?__p06_route='))
    .map(([, index]) => index);
  assert.ok(Math.max(...directIndexes) < Math.min(...assistantIndexes));
  assert.ok(Math.max(...assistantIndexes) < Math.min(...utilityIndexes));
});
