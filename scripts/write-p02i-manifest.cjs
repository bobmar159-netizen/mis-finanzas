'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const targets = [
  'frontend/index.html',
  'frontend/runtime-config.js',
  'frontend/service-worker.js',
  'frontend/yarbi-assistant.js',
  'frontend/yarbi-memory-center.js',
  'frontend/yarbi-owner-inbox-ui.js',
  'scripts/bootstrap-unified-frontend.cjs',
  'scripts/build-unified-frontend.cjs',
  'tests/frontend-unified-build.test.js',
  'dist/web/BUILD_MANIFEST.json',
  'dist/android-www/BUILD_MANIFEST.json'
];
function sha(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
for (const target of targets) if (!fs.existsSync(path.join(repo, target))) throw new Error(`P0.2I manifest: falta ${target}`);
const lines = ['# YARBI P0.2I SHA-256', '# Formato: SHA256  ruta relativa'];
for (const target of targets) lines.push(`${sha(path.join(repo, target))}  ${target.replace(/\\/g, '/')}`);
fs.writeFileSync(path.join(repo, 'YARBI_P0_2I_SHA256SUMS.txt'), lines.join('\n') + '\n', 'utf8');
console.log(JSON.stringify({ phase: 'P0.2I', result: 'SHA256_MANIFEST_WRITTEN', entries: targets.length }));
