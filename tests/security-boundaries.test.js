const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const frontends = [
  fs.readFileSync(path.join(root, 'index.html'), 'utf8'),
  fs.readFileSync(path.join(root, 'www', 'index.html'), 'utf8')
];

const secretSignatures = [
  /AIza[0-9A-Za-z_-]{30,}/,
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /sb_secret_[0-9A-Za-z_-]{20,}/,
  /sk_(?:live|test)_[0-9A-Za-z_-]{16,}/
];

test('security: shipped frontends contain no recognizable secret value', () => {
  for (const frontend of frontends) {
    for (const signature of secretSignatures) assert.doesNotMatch(frontend, signature);
  }
});

test('security: privileged integrations obtain credentials from server environment', () => {
  const files = [
    'api/webhook.js',
    'api/supabase-secure.js',
    'api/notion-proxy.js',
    'api/actions/approve.js',
    'api/assistant/live-token.js',
    'api/assistant/collections.js'
  ].map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
  for (const name of ['SUPABASE_SECRET_KEY', 'ASSISTANT_API_TOKEN', 'GEMINI_API_KEY']) {
    assert.match(files, new RegExp('process\\.env\\.' + name));
  }
  assert.match(files, /process\.env\.(?:YCLOUD_API_KEY|YCLOUD_KEY)/);
  assert.match(files, /process\.env\.(?:NOTION_TOKEN|FNZ_NOTION_TOKEN)/);
});
