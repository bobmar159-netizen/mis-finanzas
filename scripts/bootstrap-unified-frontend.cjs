/*
 * One-time P0.2I bootstrap. It never modifies either frozen reference tree.
 * It applies the Android delta to a copy of backend/www/index.html, then restores
 * the backend-only owner inbox route and module reference.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repo = path.resolve(__dirname, '..');
const backendWww = path.join(repo, 'www');
const androidWww = path.resolve(repo, '..', 'YARBI_LATEST_CRM_PHASE2_BUILD_2026-09-15', 'www');
const frontend = path.join(repo, 'frontend');

function fail(message) { throw new Error(`P0.2I bootstrap: ${message}`); }
function read(file) { return fs.readFileSync(file, 'utf8'); }
function write(file, value) { fs.writeFileSync(file, value, 'utf8'); }
function copy(file, destination) { fs.copyFileSync(file, destination); }

const resume = process.argv.includes('--resume');
const replaceGenerated = process.argv.includes('--replace-generated');
if (fs.existsSync(frontend) && replaceGenerated) {
  const provenance = path.join(frontend, 'SOURCE_PROVENANCE.json');
  if (!fs.existsSync(provenance)) fail('frontend/ existe pero no tiene proveniencia P0.2I; no se elimina.');
  const recorded = JSON.parse(fs.readFileSync(provenance, 'utf8'));
  if (recorded.schema !== 'yarbi.frontend-source.v1') fail('frontend/ no tiene una proveniencia P0.2I válida; no se elimina.');
  fs.rmSync(frontend, { recursive: true, force: false });
}
if (fs.existsSync(frontend) && !(resume && !fs.existsSync(path.join(frontend, 'index.html')))) {
  fail('frontend/ ya existe; no se sobrescribe automáticamente.');
}
if (!fs.existsSync(path.join(backendWww, 'index.html'))) fail('falta backend www/index.html.');
if (!fs.existsSync(path.join(androidWww, 'index.html'))) fail('falta Android www/index.html.');

fs.mkdirSync(frontend, { recursive: true });
if (!resume) {
  for (const entry of fs.readdirSync(backendWww, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name === 'index.html' || entry.name === 'service-worker.js') continue;
    copy(path.join(backendWww, entry.name), path.join(frontend, entry.name));
  }
}

// Start at backend/www and apply only the frozen Android delta; do not replace
// the backend tree or the Android tree themselves.
const targetIndex = path.join(frontend, 'index.html');
copy(path.join(backendWww, 'index.html'), targetIndex);
const diff = spawnSync('git', ['diff', '--no-index', '--binary', '--', targetIndex, path.join(androidWww, 'index.html')], {
  cwd: repo,
  encoding: 'buffer'
});
if (![0, 1].includes(diff.status)) fail(`no se pudo calcular el delta Android (${diff.error || diff.stderr.toString('utf8')}).`);
let portablePatch = diff.stdout.toString('utf8');
portablePatch = portablePatch.replace(/^diff --git .*\r?\nindex /m, 'diff --git a/frontend/index.html b/frontend/index.html\nindex ');
portablePatch = portablePatch.replace(/^--- .*\r?\n\+\+\+ .*$/m, '--- a/frontend/index.html\n+++ b/frontend/index.html');
const apply = spawnSync('git', ['apply', '--whitespace=nowarn'], {
  cwd: repo,
  input: portablePatch,
  encoding: 'utf8'
});
if (apply.status !== 0) fail(`no se pudo aplicar el delta Android: ${apply.stderr || apply.error || 'error desconocido'}`);

const backendIndex = read(path.join(backendWww, 'index.html'));
let merged = read(targetIndex);
const ownerCase = backendIndex.match(/^\s*case 'yarbi-pendientes':[^\r\n]+$/m);
if (!ownerCase) fail('no se encontró la ruta de Bandeja del dueño en backend/www/index.html.');
if (!merged.includes("case 'yarbi-pendientes':")) {
  const anchor = "    case 'graficos':content.innerHTML=renderGraficos();setTimeout(buildCharts,50);break;";
  if (!merged.includes(anchor)) fail('no se encontró el punto de inserción de Bandeja en el switch de páginas.');
  merged = merged.replace(anchor, `${ownerCase[0]}\n${anchor}`);
}
if (!merged.includes('yarbi-owner-inbox-ui.js')) {
  const closingBody = merged.lastIndexOf('</body>');
  if (closingBody < 0) fail('no se encontró el cierre real del documento para cargar la Bandeja.');
  merged = `${merged.slice(0, closingBody)}<script src="./yarbi-owner-inbox-ui.js"></script>\n${merged.slice(closingBody)}`;
}

// Replace only the known literal production origin. Every resulting call goes
// through runtime-config.js; no production fallback is introduced.
function replaceProductionOrigin(source) {
  return source.replace(/(['`])https:\/\/misfinanzas-backend\.vercel\.app/g, (_match, quote) => (
    quote === '`' ? '`${window.gfcRuntimeApiOrigin()}' : "window.gfcRuntimeApiOrigin() + '"
  ));
}
merged = replaceProductionOrigin(merged);
if (!merged.includes('runtime-config.js')) {
  merged = merged.replace('</head>', '<script src="./runtime-config.js"></script>\n</head>');
}
write(targetIndex, merged);

const memoryPath = path.join(frontend, 'yarbi-memory-center.js');
write(memoryPath, replaceProductionOrigin(read(memoryPath)));

write(path.join(frontend, 'runtime-config.js'), `/* Build template. build-unified-frontend.cjs replaces all placeholders. */
(function () {
  'use strict';
  const config = Object.freeze({
    apiOrigin: '__YARBI_API_ORIGIN__',
    environment: '__YARBI_ENVIRONMENT__',
    releaseId: '__YARBI_RELEASE_ID__'
  });
  function apiOrigin() {
    if (config.apiOrigin === '__YARBI_SAME_ORIGIN__') return window.location.origin;
    try {
      const parsed = new URL(config.apiOrigin);
      if (parsed.protocol !== 'https:') throw new Error('https_required');
      return parsed.origin;
    } catch (_) {
      throw new Error('Configuración de API Yarbi ausente o inválida. La aplicación se detuvo sin usar un destino alternativo.');
    }
  }
  window.gfcRuntimeConfig = config;
  window.gfcRuntimeApiOrigin = apiOrigin;
})();
`);

write(path.join(frontend, 'service-worker.js'), `const CACHE_NAME = 'yarbi-static-__YARBI_RELEASE_ID__';
const ASSETS = ['./', './index.html', './manifest.json', './runtime-config.js', './yarbi-assistant.js', './yarbi-memory-center.js', './yarbi-owner-inbox-ui.js', './yarbi-avatar-motion.js', './avatar.png', './avatar_circle.png', './mascota.png'];
const assetUrls = () => new Set(ASSETS.map(asset => new URL(asset, self.registration.scope).href));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('yarbi-static-') && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  // API and user-specific responses are intentionally never cached here.
  if (new URL(event.request.url).pathname.includes('/api/')) return;
  if (!assetUrls().has(event.request.url)) return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    if (response && response.ok) caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
    return response;
  })));
});
`);

write(path.join(frontend, 'SOURCE_PROVENANCE.json'), JSON.stringify({
  schema: 'yarbi.frontend-source.v1',
  base: 'YARBI_BACKEND_MERGED_20260930/www',
  android_delta: 'YARBI_LATEST_CRM_PHASE2_BUILD_2026-09-15/www',
  preserved_backend_module: 'yarbi-owner-inbox-ui.js',
  generated_by: 'scripts/bootstrap-unified-frontend.cjs',
  notes: [
    'Los árboles originales no fueron modificados.',
    'El origen API se resuelve solamente en runtime-config.js generado.',
    'El Service Worker usa una caché estática versionada por release y excluye /api/.'
  ]
}, null, 2) + '\n');

const forbidden = 'https://misfinanzas-backend.vercel.app';
for (const file of ['index.html', 'yarbi-memory-center.js']) {
  if (read(path.join(frontend, file)).includes(forbidden)) fail(`quedó una URL literal de Production en ${file}.`);
}
console.log(JSON.stringify({ phase: 'P0.2I', result: 'FRONTEND_SOURCE_CREATED', frontend: path.relative(repo, frontend) }));
