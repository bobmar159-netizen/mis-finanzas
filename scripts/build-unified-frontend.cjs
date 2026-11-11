'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const frontend = path.join(repo, 'frontend');
const financialCoach = path.join(repo, 'lib', 'yarbi-financial-coach.js');
const financeContext = path.join(repo, 'lib', 'yarbi-finance-context.js');
const businessTimeline = path.join(repo, 'lib', 'yarbi-business-timeline.js');
const agendaReadModel = path.join(repo, 'lib', 'yarbi-agenda-intelligence.js');
const clientContextReadModel = path.join(repo, 'lib', 'yarbi-client-context-read.js');
const args = new Map(process.argv.slice(2).map(value => {
  const [key, ...rest] = value.split('=');
  return [key, rest.join('=') || true];
}));
const target = args.get('--target');
const out = args.get('--out') ? path.resolve(repo, args.get('--out')) : path.join(repo, 'dist', target === 'web' ? 'web' : 'android-www');
const replaceGenerated = args.has('--replace-generated');
const publishRootArg = args.get('--publish-root');
const publishRoot = publishRootArg === true ? repo : (publishRootArg ? path.resolve(repo, publishRootArg) : null);
const androidOfflineOnly = target === 'android' && process.env.YARBI_ANDROID_OFFLINE_ONLY === 'true';

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
  const frontendFiles = walk(frontend).sort().map(file => `frontend/${path.relative(frontend, file).replace(/\\/g, '/')}` + '\t' + sha(fs.readFileSync(file)));
  if (!fs.existsSync(financialCoach)) fail('falta el módulo compartido yarbi-financial-coach.js.');
  if (!fs.existsSync(financeContext)) fail('falta el módulo compartido yarbi-finance-context.js.');
  if (!fs.existsSync(businessTimeline)) fail('falta el módulo compartido yarbi-business-timeline.js.');
  if (!fs.existsSync(agendaReadModel)) fail('falta el módulo compartido yarbi-agenda-intelligence.js.');
  if (!fs.existsSync(clientContextReadModel)) fail('falta el módulo compartido yarbi-client-context-read.js.');
  return sha([...frontendFiles, 'lib/yarbi-financial-coach.js\t' + sha(fs.readFileSync(financialCoach)), 'lib/yarbi-finance-context.js\t' + sha(fs.readFileSync(financeContext)), 'lib/yarbi-business-timeline.js\t' + sha(fs.readFileSync(businessTimeline)), 'lib/yarbi-agenda-intelligence.js\t' + sha(fs.readFileSync(agendaReadModel)), 'lib/yarbi-client-context-read.js\t' + sha(fs.readFileSync(clientContextReadModel))].join('\n'));
}
function validateOrigin(value) {
  let parsed;
  try { parsed = new URL(value); } catch (_) { fail('YARBI_ANDROID_API_ORIGIN debe ser una URL HTTPS explícita.'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    fail('YARBI_ANDROID_API_ORIGIN debe ser un origen HTTPS limpio, sin credenciales ni ruta.');
  }
  return parsed.origin;
}
function validateAuthScheme(value) {
  if (!/^[a-z][a-z0-9+.-]*$/i.test(value)) fail('YARBI_ANDROID_AUTH_CALLBACK_SCHEME debe ser un esquema URI válido.');
  return value;
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
const apiOrigin = target === 'web'
  ? '__YARBI_SAME_ORIGIN__'
  : (androidOfflineOnly ? 'offline://remote-disabled' : validateOrigin(process.env.YARBI_ANDROID_API_ORIGIN || ''));
const remoteEnabled = target === 'web' || !androidOfflineOnly;
const nativeAuthCallbackScheme = target === 'android'
  ? validateAuthScheme(process.env.YARBI_ANDROID_AUTH_CALLBACK_SCHEME || 'com.misfinanzas.app')
  : 'com.misfinanzas.app';
fs.mkdirSync(out, { recursive: true });
copyTree(frontend, out);
// Financial Coach is a shared deterministic domain module, emitted verbatim
// for the browser rather than duplicated in the frontend source tree.
fs.copyFileSync(financialCoach, path.join(out, 'yarbi-financial-coach.js'));
fs.copyFileSync(financeContext, path.join(out, 'yarbi-finance-context.js'));
fs.copyFileSync(businessTimeline, path.join(out, 'yarbi-business-timeline.js'));
fs.copyFileSync(agendaReadModel, path.join(out, 'yarbi-agenda-intelligence.js'));
fs.copyFileSync(clientContextReadModel, path.join(out, 'yarbi-client-context-read.js'));
renderTemplate(path.join(out, 'runtime-config.js'), {
  '__YARBI_API_ORIGIN__': apiOrigin,
  '__YARBI_ENVIRONMENT__': target,
  '__YARBI_RELEASE_ID__': releaseId,
  '__YARBI_REMOTE_ENABLED__': String(remoteEnabled),
  '__YARBI_NATIVE_AUTH_CALLBACK_SCHEME__': nativeAuthCallbackScheme,
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
  api_origin_mode: target === 'web' ? 'same_origin' : (androidOfflineOnly ? 'remote_disabled' : 'explicit_https'),
  files: files.map(file => ({ path: path.relative(out, file).replace(/\\/g, '/'), sha256: sha(fs.readFileSync(file)), bytes: fs.statSync(file).size }))
};
fs.writeFileSync(path.join(out, 'BUILD_MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
if (publishRoot) publishWebRoot(out, publishRoot);
console.log(JSON.stringify({ phase: 'P0.2I', result: 'BUILD_OK', target, output: path.relative(repo, out), release_id: releaseId, source_sha256: sourceHash, ...(publishRoot ? { published_root: path.relative(repo, publishRoot) || '.' } : {}) }));
