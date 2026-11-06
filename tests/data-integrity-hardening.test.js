const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const processSource = fs.readFileSync(path.join(__dirname, '..', 'api', 'ai', 'process.js'), 'utf8');
const preferencesSource = fs.readFileSync(path.join(__dirname, '..', 'api', 'assistant', 'preferences.js'), 'utf8');

test('processing failures stop retrying after three attempts and remain traceable', () => {
  assert.match(processSource, /attempt_count \|\| 1\) >= 3/);
  assert.match(processSource, /status: 'skipped'/);
  assert.match(processSource, /Omitido tras 3 intentos/);
  assert.match(processSource, /failure_samples/);
});

test('account debt snapshots are authenticated, mode-separated and read-back verified', () => {
  assert.match(preferencesSource, /async function handleAccountDebts\(req, res\)/);
  assert.match(preferencesSource, /authenticatedSupabaseUser\(req\)/);
  assert.match(preferencesSource, /\[mode\]: \{ items: debts, updatedAt \}/);
  assert.match(preferencesSource, /Supabase no confirmó la copia completa de deudas/);
  assert.match(preferencesSource, /action === 'account-debts'/);
});

test('settings and vault updates preserve the debt snapshot', () => {
  assert.match(preferencesSource, /if \(current\.__debts\) settings\.__debts = current\.__debts/);
  assert.match(preferencesSource, /if \(currentSettings\.__debts\) settings\.__debts = currentSettings\.__debts/);
});
