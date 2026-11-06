const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function serverlessFunctions(directory) {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...serverlessFunctions(absolute));
    else if (entry.isFile() && ['.js', '.ts'].includes(path.extname(entry.name))) found.push(absolute);
  }
  return found;
}

test('Vercel Hobby deployment stays within the 12 serverless function limit', () => {
  const functions = serverlessFunctions(path.join(root, 'api'));
  assert.ok(functions.length <= 12, 'Expected at most 12 functions, found ' + functions.length);
});

test('privacy remains available as static HTML instead of consuming a function', () => {
  const config = fs.readFileSync(path.join(root, 'vercel.json'), 'utf8');
  const privacy = fs.readFileSync(path.join(root, 'privacy.html'), 'utf8');
  assert.match(config, /"src": "\/privacy"[\s\S]*"dest": "\/privacy\.html"/);
  assert.match(privacy, /Política de Privacidad de Mis Finanzas Pro/);
  assert.equal(fs.existsSync(path.join(root, 'api', 'privacy.js')), false);
});

