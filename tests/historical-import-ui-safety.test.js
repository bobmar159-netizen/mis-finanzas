const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const memoryCenter = fs.readFileSync(path.join(root, 'frontend', 'yarbi-memory-center.js'), 'utf8');
const frontend = fs.readFileSync(path.join(root, 'frontend', 'index.html'), 'utf8');
const historicalReview = fs.readFileSync(path.join(root, 'frontend', 'yarbi-historical-learning.js'), 'utf8');

test('historical import loads the local review module before the importer', () => {
  assert.match(frontend, /<script src="yarbi-historical-learning\.js"><\/script>\s*<script src="yarbi-memory-center\.js"><\/script>/);
});

test('historical import requires an explicit commercial review acknowledgement', () => {
  assert.match(memoryCenter, /gfc-yarbi-import-review-confirmed/);
  assert.match(memoryCenter, /Confirma primero que revisarás las propuestas/);
  assert.match(historicalReview, /automatic_crm_updates:false/);
  assert.match(historicalReview, /payment_requires_movement_reconciliation:true/);
});

test('historical import sends only conversations mapped to a verified CRM phone identifier', () => {
  assert.match(memoryCenter, /gfcYarbiLocalRows\('identifier'\)/);
  assert.match(memoryCenter, /identity_state === 'candidate_phone_match'/);
  assert.match(memoryCenter, /contact_id:contactId/);
  assert.match(memoryCenter, /needs_contact_matching/);
  assert.doesNotMatch(memoryCenter, /gfcProcessYarbiInformation\(\)\)\.catch\(\(\) => \{\}\);\s*if \(typeof gfcLearnHistoricalReplyStyle/);
});
