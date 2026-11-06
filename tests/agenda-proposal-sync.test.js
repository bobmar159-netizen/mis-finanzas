const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const processor = fs.readFileSync(path.join(__dirname, '..', 'api', 'ai', 'process.js'), 'utf8');
const messages = fs.readFileSync(path.join(__dirname, '..', 'lib', 'whatsapp-messages.js'), 'utf8');

test('canonical processing joins a new location with bounded recent conversation context', () => {
  assert.match(processor, /loadRecentConversationContext/);
  assert.match(processor, /order=timestamp\.desc&limit=24/);
  assert.match(processor, /CONTEXTO RECIENTE ANTERIOR/);
  assert.match(processor, /agenda_proposal_ready/);
  assert.doesNotMatch(processor.slice(processor.indexOf('async function createIntelligentAlert'), processor.indexOf('async function countProcessingRows')), /agenda_event_id=eq\.null/);
});

test('local mirror overlaps its numeric cursor and deduplicates safely by primary key', () => {
  assert.match(messages, /timestamp=gte\.' \+ Math\.max\(0, messageCursor - 1\)/);
  assert.match(messages, /action\) \|\| ''\) === 'alert-status'/);
});

