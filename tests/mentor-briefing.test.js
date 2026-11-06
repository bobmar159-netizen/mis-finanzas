const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const frontend = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('mentor: uses a deterministic read-only briefing before advice', () => {
  assert.match(frontend, /function gfcBuildMentorBriefing\(\)/);
  assert.match(frontend, /name: 'get_mentor_briefing'/);
  assert.match(frontend, /if \(name === 'get_mentor_briefing'\) return gfcBuildMentorBriefing\(\)/);
  assert.match(frontend, /MENTOR_BRIEFING_V1/);
});

test('mentor: briefing labels evidence and never executes a prepared action', () => {
  const start = frontend.indexOf('async function gfcBuildMentorBriefing()');
  const end = frontend.indexOf('function gfcLiveToolDeclarations()', start);
  const block = frontend.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(block, /evidence_type: 'fact'/);
  assert.match(block, /evidence_type: 'signal'/);
  assert.match(block, /recommendation:/);
  assert.doesNotMatch(block, /gfcPrepareAgentAction|prepare_confirmed_action|saveAll\(/);
});
