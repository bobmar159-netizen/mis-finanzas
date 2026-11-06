'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const frontend = path.join(repo, 'frontend');
const args = new Map(process.argv.slice(2).map(value => {
  const [key, ...rest] = value.split('=');
  return [key, rest.join('=') || true];
}));
const target = args.get('--target');
const out = args.get('--out') ? path.resolve(repo, args.get('--out')) : path.join(repo, 'dist', target === 'web' ? 'web' : 'android-www');
const replaceGenerated = args.has('--replace-generated');
const publishRootArg = args.get('--publish-root');
const publishRoot = publishRootArg === true ? repo : (publishRootArg ? path.resolve(repo, publishRootArg) : null);

function fail(message) { throw new Error(`P0.2I build: ${message}`); }
function sha(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}
function copyTree(from, to) {
  for (const file of walk(from)) {
    const relative = path.relative(from, file);
    const destination = path.join(to, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(file, destination);
  }
}
function sourceDigest() {
  return sha(walk(frontend).sort().map(file => `${path.relative(frontend, file).replace(/\\/g, '/')}\t${sha(fs.readFileSync(file))}`).join('\n'));
}
function validateOrigin(value) {
  let parsed;
  try { parsed = new URL(value); } catch (_) { fail('YARBI_ANDROID_API_ORIGIN debe ser una URL HTTPS explícita.'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    fail('YARBI_ANDROID_API_ORIGIN debe ser un origen HTTPS limpio, sin credenciales ni ruta.');
  }
  return parsed.origin;
}
function renderTemplate(file, replacements) {
  let value = fs.readFileSync(file, 'utf8');
  for (const [key, replacement] of Object.entries(replacements)) value = value.split(key).join(replacement);
  const unresolved = value.replaceAll('__YARBI_SAME_ORIGIN__', '');
  if (unresolved.includes('__YARBI_')) fail(`quedó un marcador sin resolver en ${path.basename(file)}.`);
  fs.writeFileSync(file, value, 'utf8');
}

function publishWebRoot(from, destination) {
  const excluded = new Set(['BUILD_MANIFEST.json', 'SOURCE_PROVENANCE.json']);
  for (const file of walk(from)) {
    const relative = path.relative(from, file);
    if (excluded.has(relative)) continue;
    const targetFile = path.join(destination, relative);
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.copyFileSync(file, targetFile);
  }
}

if (!['web', 'android'].includes(target)) fail('use --target=web o --target=android.');
if (publishRoot && target !== 'web') fail('--publish-root solo es válido para --target=web.');
if (!fs.existsSync(frontend)) fail('falta frontend/. Ejecute primero bootstrap-unified-frontend.cjs.');
if (fs.existsSync(out)) {
  const previousManifest = path.join(out, 'BUILD_MANIFEST.json');
  if (!replaceGenerated || !fs.existsSync(previousManifest)) fail(`el destino ya existe y no es un artefacto P0.2I reemplazable: ${path.relative(repo, out)}`);
  const previous = JSON.parse(fs.readFileSync(previousManifest, 'utf8'));
  if (previous.schema !== 'yarbi.frontend-build.v1') fail(`el destino no tiene manifiesto P0.2I válido: ${path.relative(repo, out)}`);
  fs.rmSync(out, { recursive: true, force: false });
}

const sourceHash = sourceDigest();
const releaseId = `p02i-${sourceHash.slice(0, 16)}`;
const apiOrigin = target === 'web' ? '__YARBI_SAME_ORIGIN__' : validateOrigin(process.env.YARBI_ANDROID_API_ORIGIN || '');
fs.mkdirSync(out, { recursive: true });
copyTree(frontend, out);
renderTemplate(path.join(out, 'runtime-config.js'), {
  '__YARBI_API_ORIGIN__': apiOrigin,
  '__YARBI_ENVIRONMENT__': target,
  '__YARBI_RELEASE_ID__': releaseId,
  '__YARBI_SAME_ORIGIN__': '__YARBI_SAME_ORIGIN__'
});
renderTemplate(path.join(out, 'service-worker.js'), { '__YARBI_RELEASE_ID__': releaseId });

const files = walk(out).filter(file => path.basename(file) !== 'BUILD_MANIFEST.json').sort();
const forbidden = 'https://misfinanzas-backend.vercel.app';
for (const file of files) {
  if (fs.readFileSync(file, 'utf8').includes(forbidden)) fail(`URL literal de Production detectada en ${path.relative(out, file)}.`);
}
const manifest = {
  schema: 'yarbi.frontend-build.v1',
  target,
  release_id: releaseId,
  source_sha256: sourceHash,
  api_origin_mode: target === 'web' ? 'same_origin' : 'explicit_https',
  files: files.map(file => ({ path: path.relative(out, file).replace(/\\/g, '/'), sha256: sha(fs.readFileSync(file)), bytes: fs.statSync(file).size }))
};
fs.writeFileSync(path.join(out, 'BUILD_MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
if (publishRoot) publishWebRoot(out, publishRoot);
console.log(JSON.stringify({ phase: 'P0.2I', result: 'BUILD_OK', target, output: path.relative(repo, out), release_id: releaseId, source_sha256: sourceHash, ...(publishRoot ? { published_root: path.relative(repo, publishRoot) || '.' } : {}) }));
