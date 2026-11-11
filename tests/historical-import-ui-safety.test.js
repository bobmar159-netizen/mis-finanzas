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

test('historical signals are persisted as a local reconciliation queue, never as commercial state changes', () => {
  assert.match(memoryCenter, /HISTORICAL_RECONCILIATION_KEY/);
  assert.match(memoryCenter, /status:contactId \? 'needs_reconciliation' : 'needs_contact_match'/);
  assert.match(memoryCenter, /automatic_change:false/);
  assert.match(memoryCenter, /payment complete|pago completo/i);
  assert.doesNotMatch(memoryCenter, /commercial_status:\s*['"]cerrado/);
});

test('historical review hands confirmed closures to the existing Movement-to-CRM reconciliation flow', () => {
  assert.match(memoryCenter, /gfcOpenHistoricalServiceImport/);
  assert.match(memoryCenter, /cierres ya confirmados en Movimientos/i);
});

test('historical reconciliation can only compare local Agenda and Movements; it cannot apply commercial changes', () => {
  assert.match(memoryCenter, /gfcYarbiRefreshHistoricalReconciliation/);
  assert.match(memoryCenter, /reconcileHistoricalCandidates/);
  assert.match(memoryCenter, /gfcYarbiLocalRows\('agenda'\)/);
  assert.match(memoryCenter, /Ningún dato comercial fue modificado/);
});
