const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeHabitCandidates } = require('../lib/yarbi-habits');

const root = path.join(__dirname, '..');

test('habits: accepts only traceable outgoing evidence', () => {
  const rows = normalizeHabitCandidates([{
    category: 'follow_up',
    instruction: 'Después de cotizar, enviar un seguimiento breve al día siguiente.',
    source_message_ids: ['out-1', 'in-1'],
    confidence: 0.92
  }], [
    { id: 'out-1', metadata: { direction: 'outgoing' } },
    { id: 'in-1', metadata: { direction: 'incoming' } }
  ]);
  assert.deepEqual(rows[0].source_message_ids, ['out-1']);
});

test('habits: rejects weak, unsupported or incoming-only guesses', () => {
  const rows = normalizeHabitCandidates([{
    category: 'communication',
    instruction: 'Responder siempre de manera amable y breve.',
    source_message_ids: ['in-1'],
    confidence: 0.99
  }], [{ id: 'in-1', metadata: { direction: 'incoming' } }]);
  assert.deepEqual(rows, []);
});

test('habits: frontend requires explicit yes before permanent instruction', () => {
  const frontend = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const processor = fs.readFileSync(path.join(root, 'api', 'ai', 'process.js'), 'utf8');
  const mirror = fs.readFileSync(path.join(root, 'lib', 'whatsapp-messages.js'), 'utf8');
  assert.match(processor, /habit_candidates/);
  assert.match(frontend, /habit_candidate_id/);
  assert.match(frontend, /gfcYarbiOfferHabitCandidate/);
  assert.match(frontend, /HABIT_LEARNING_V1/);
  assert.match(mirror, /action\) \|\| ''\) === 'habits'/);
});
