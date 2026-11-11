const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const frontend = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const messages = fs.readFileSync(path.join(root, 'lib', 'whatsapp-messages.js'), 'utf8');
const webhook = fs.readFileSync(path.join(root, 'api', 'webhook.js'), 'utf8');
const command = fs.readFileSync(path.join(root, 'api', 'assistant', 'command.js'), 'utf8');
const processor = fs.readFileSync(path.join(root, 'api', 'ai', 'process.js'), 'utf8');

test('performance: interactive client reads are bounded', () => {
  assert.match(messages, /ai_intelligent_alerts[^\n]+limit=10/);
  assert.match(messages, /agenda_events[^\n]+limit=20/);
  assert.match(messages, /ai_contact_observations[^\n]+limit=80/);
  assert.ok(command.includes("/rest/v1/clients?phone_number=eq.' + encodeURIComponent(variant) + '&select=*&limit=1"));
  assert.ok(command.includes("/rest/v1/crm_contacts?or=(display_name.ilike.' + pattern + ',full_name.ilike.' + pattern + ')&select=id,full_name,display_name&limit=8"));
});

test('performance: draft and raw message fallbacks never download complete histories', () => {
  assert.match(webhook, /draft_actions\?[^`\n]+&limit=100/);
  assert.match(webhook, /whatsapp_messages\?[^`\n]+&limit=50/);
  assert.match(command, /whatsapp_messages\?[^'\n]+&limit=200/);
  assert.doesNotMatch(command, /whatsapp_messages\?[^'\n]+order=timestamp\.desc'\)/);
});

test('performance: local mirror is incremental, bounded and parallel', () => {
  assert.match(messages, /messageLimit = localMirrorLimit\(body\.message_limit, 200, 250\)/);
  assert.match(messages, /entityLimit = localMirrorLimit\(body\.entity_limit, 400, 500\)/);
  assert.match(messages, /localMirrorSince\('updated_at', entityCursor\)/);
  assert.match(messages, /const \[contacts, identifiers, memories, agenda, alerts, analyses, observations, receivables, habits, replyStyles, messages, deletedMessages\] = await Promise\.all/);
  assert.match(messages, /yarbi_receivables\?select=id,contact_id,agreed_amount,paid_amount,balance_amount,status/);
});

test('performance: processing status uses HEAD counts in parallel instead of row downloads', () => {
  assert.match(processor, /method: 'HEAD'/);
  assert.match(processor, /Prefer: 'count=exact'/);
  assert.match(processor, /const \[rawMessages, tracked, pending, processing, completed, skipped, failed, identityPending,[^\]]+\] = await Promise\.all/);
  assert.match(processor, /status=eq\.identity_pending/);
  assert.match(frontend, /identityPending = Number\(recovery\.identity_pending/);
});

test('performance: recovery releases one bounded due batch and never the full failed queue', () => {
  assert.match(processor, /attempt_count=lt\.3[^\n]+next_retry_at\.lte/);
  assert.match(processor, /order=updated_at\.asc&limit=/);
  assert.match(processor, /candidateIds\.length/);
  assert.doesNotMatch(processor, /supabase\('\/rest\/v1\/ai_message_analysis\?status=eq\.failed', \{\s*method: 'PATCH',[\s\S]{0,250}next_retry_at: now/);
});

test('performance: Live fast path does not wait for a full mirror refresh', () => {
  assert.match(frontend, /FAST_READ_PATH_V1/);
  assert.match(frontend, /void gfcYarbiLocalEnsureFresh\('memory-query-background'\)/);
  assert.doesNotMatch(frontend, /await gfcYarbiLocalEnsureFresh\('memory-query'/);
  assert.match(frontend, /raw_history_used: false/);
});
