'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const build = path.join(root, 'scripts', 'build-unified-frontend.cjs');
const frontend = path.join(root, 'frontend');
const productionOrigin = 'https://misfinanzas-backend.vercel.app';

function run(target, output, environment = {}, extraArgs = []) {
  const env = { ...process.env, ...environment };
  // Cada caso controla explícitamente el origen Android; nunca hereda el de
  // una terminal que estuviera preparando un build anterior.
  if (target === 'android' && !Object.prototype.hasOwnProperty.call(environment, 'YARBI_ANDROID_API_ORIGIN')) delete env.YARBI_ANDROID_API_ORIGIN;
  execFileSync(process.execPath, [build, `--target=${target}`, `--out=${output}`, ...extraArgs], { cwd: root, env, stdio: 'pipe' });
}

test('P0.2I: source preserves Android-only flows and backend owner inbox', () => {
  const html = fs.readFileSync(path.join(frontend, 'index.html'), 'utf8');
  const ownerInbox = fs.readFileSync(path.join(frontend, 'yarbi-owner-inbox-ui.js'), 'utf8');
  for (const marker of [
    'gfcManualAgendaDraft', 'gfcRepairLegacyVisitedAgenda', 'crm-followup-planner', 'crm-delete-record-sheet',
    "case 'yarbi-pendientes':", 'yarbi-owner-inbox-ui.js', 'gfcStartGeminiLive', 'gfcCallGeminiAPI',
    'gfcYarbiApplyQuickAgendaStatus', 'crmSendFollowUpNow', '/api/notion-proxy', 'yarbi-owner-memory-ui.js', 'yarbi-app-voice.js', 'yarbi-financial-coach.js', 'yarbi-financial-coach-ui.js', 'yarbi-finance-context.js', 'yarbi-business-timeline.js', 'yarbi-agenda-intelligence.js', 'yarbi-agenda-read-ui.js', 'yarbi-client-context-read.js', 'yarbi-client-context-read-ui.js',
    '/api/assistant/send-whatsapp', '/api/assistant/chat', '/api/assistant/conversation', 'gfcCallAuthenticatedOwnerConversation', '/api/assistant/live-token', '/api/whatsapp/messages'
  ]) {
    assert.ok(html.includes(marker), `missing ${marker}`);
  }
  assert.ok(html.indexOf('runtime-config.js') < html.indexOf('gfcRuntimeApiOrigin()'));
  assert.match(fs.readFileSync(path.join(frontend, 'yarbi-owner-memory-ui.js'), 'utf8'), /\/api\/assistant\/memory/);
  assert.match(html, /<\/script>\s*<script src="\.\/yarbi-owner-inbox-ui\.js"><\/script>\s*<\/body>/);
  for (const marker of ['gfcYarbiOwnerDecision', '/api/assistant/owner-inbox', '/api/assistant/owner-action']) assert.ok(ownerInbox.includes(marker), `missing owner inbox ${marker}`);
  assert.equal(html.includes(productionOrigin), false);
  assert.equal(fs.readFileSync(path.join(frontend, 'yarbi-memory-center.js'), 'utf8').includes(productionOrigin), false);
});

test('P0.2I: web and Android builds are reproducible and environment-specific', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yarbi-p02i-'));
  const web = path.join(temp, 'web');
  const android = path.join(temp, 'android');
  const webRepeat = path.join(temp, 'web-repeat');
  const androidRepeat = path.join(temp, 'android-repeat');
  run('web', web);
  run('android', android, { YARBI_ANDROID_API_ORIGIN: 'https://android-build.invalid' });
  run('web', webRepeat);
  run('android', androidRepeat, { YARBI_ANDROID_API_ORIGIN: 'https://android-build.invalid' });
  const webConfig = fs.readFileSync(path.join(web, 'runtime-config.js'), 'utf8');
  const androidConfig = fs.readFileSync(path.join(android, 'runtime-config.js'), 'utf8');
  const webSw = fs.readFileSync(path.join(web, 'service-worker.js'), 'utf8');
  assert.match(webConfig, /apiOrigin: '__YARBI_SAME_ORIGIN__'/);
  assert.match(androidConfig, /apiOrigin: 'https:\/\/android-build\.invalid'/);
  assert.match(webSw, /yarbi-static-p02i-/);
  assert.doesNotMatch(webSw, /ASSETS = \[[^\]]*runtime-config\.js/);
  assert.match(webSw, /pathname\.endsWith\('\/runtime-config\.js'\)/);
  assert.match(webSw, /includes\('\/api\/'\)/);
  assert.equal(fs.readFileSync(path.join(web, 'BUILD_MANIFEST.json'), 'utf8'), fs.readFileSync(path.join(webRepeat, 'BUILD_MANIFEST.json'), 'utf8'));
  assert.equal(fs.readFileSync(path.join(android, 'BUILD_MANIFEST.json'), 'utf8'), fs.readFileSync(path.join(androidRepeat, 'BUILD_MANIFEST.json'), 'utf8'));
  for (const output of [web, android]) {
    assert.ok(fs.existsSync(path.join(output, 'BUILD_MANIFEST.json')));
    for (const file of ['index.html', 'yarbi-assistant.js', 'yarbi-memory-center.js', 'yarbi-owner-memory-ui.js', 'yarbi-app-voice.js', 'yarbi-owner-inbox-ui.js', 'yarbi-financial-coach.js', 'yarbi-financial-coach-ui.js', 'yarbi-finance-context.js', 'yarbi-business-timeline.js', 'yarbi-agenda-intelligence.js', 'yarbi-agenda-read-ui.js', 'yarbi-client-context-read.js', 'yarbi-client-context-read-ui.js']) assert.ok(fs.existsSync(path.join(output, file)));
    for (const file of fs.readdirSync(output)) {
      const full = path.join(output, file);
      if (fs.statSync(full).isFile()) assert.equal(fs.readFileSync(full, 'utf8').includes(productionOrigin), false, `${file} has production literal`);
    }
  }
});

test('P0.2I: Android output refuses an absent API origin and the service worker excludes API caching', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yarbi-p02i-invalid-'));
  assert.throws(() => run('android', path.join(temp, 'android')), /YARBI_ANDROID_API_ORIGIN/);
  const serviceWorker = fs.readFileSync(path.join(frontend, 'service-worker.js'), 'utf8');
  assert.match(serviceWorker, /includes\('\/api\/'\)/);
  assert.match(serviceWorker, /yarbi-static-__YARBI_RELEASE_ID__/);
});

test('Android stable: Production requires the explicit stable channel and exact canonical backend', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yarbi-android-stable-'));
  assert.throws(
    () => run('android', path.join(temp, 'implicit-production'), { YARBI_ANDROID_API_ORIGIN: productionOrigin }),
    /--channel=stable/
  );
  assert.throws(
    () => run('android', path.join(temp, 'wrong-stable'), { YARBI_ANDROID_API_ORIGIN: 'https://wrong.example.test' }, ['--channel=stable']),
    /canal stable exige exactamente/
  );
  const stable = path.join(temp, 'stable');
  run('android', stable, { YARBI_ANDROID_API_ORIGIN: productionOrigin }, ['--channel=stable']);
  const runtime = fs.readFileSync(path.join(stable, 'runtime-config.js'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(stable, 'BUILD_MANIFEST.json'), 'utf8'));
  assert.match(runtime, /apiOrigin: 'https:\/\/misfinanzas-backend\.vercel\.app'/);
  assert.equal(manifest.channel, 'stable');
  assert.equal(manifest.api_origin_mode, 'explicit_https');
  for (const file of fs.readdirSync(stable)) {
    const full = path.join(stable, file);
    if (!fs.statSync(full).isFile() || file === 'runtime-config.js') continue;
    assert.equal(fs.readFileSync(full, 'utf8').includes(productionOrigin), false, `${file} has an unexpected production literal`);
  }
});

test('Etapa 1.2C: Android offline build explicitly blocks remote operations without a fallback origin', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yarbi-android-offline-'));
  const offline = path.join(temp, 'android');
  run('android', offline, {
    YARBI_ANDROID_OFFLINE_ONLY: 'true',
    YARBI_ANDROID_AUTH_CALLBACK_SCHEME: 'com.misfinanzas.app.yarbitest.etapa12c'
  });
  const runtime = fs.readFileSync(path.join(offline, 'runtime-config.js'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(offline, 'BUILD_MANIFEST.json'), 'utf8'));
  assert.match(runtime, /apiOrigin: 'offline:\/\/remote-disabled'/);
  assert.match(runtime, /remoteEnabled: 'false' === 'true'/);
  assert.match(runtime, /com\.misfinanzas\.app\.yarbitest\.etapa12c/);
  assert.equal(runtime.includes(productionOrigin), false);
  assert.equal(manifest.api_origin_mode, 'remote_disabled');
});

test('Etapa 1.2C: Android offline mode defers remote endpoint resolution until a remote action is requested', () => {
  const html = fs.readFileSync(path.join(frontend, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /const GFC_ACCOUNT_REDIRECT_URI\s*=\s*window\.gfcRuntimeApiOrigin\(/);
  assert.doesNotMatch(html, /const GFC_YARBI_LOCAL_MIRROR_ENDPOINT\s*=\s*window\.gfcRuntimeApiOrigin\(/);
  assert.doesNotMatch(html, /const GFC_YARBI_PROCESSING_STATUS_ENDPOINT\s*=\s*window\.gfcRuntimeApiOrigin\(/);
  assert.match(html, /function gfcAccountRedirectUri\(\)/);
  assert.match(html, /function gfcYarbiLocalMirrorEndpoint\(\)/);
  assert.match(html, /function gfcYarbiProcessingStatusEndpoint\(\)/);
});

test('F00: the served web root is generated from the web build, not an older HTML copy', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yarbi-f00-root-'));
  const web = path.join(temp, 'web');
  const servedRoot = path.join(temp, 'served-root');
  run('web', web, {}, [`--publish-root=${servedRoot}`]);
  for (const file of ['index.html', 'runtime-config.js', 'service-worker.js', 'yarbi-assistant.js', 'yarbi-owner-inbox-ui.js']) {
    assert.equal(fs.readFileSync(path.join(servedRoot, file), 'utf8'), fs.readFileSync(path.join(web, file), 'utf8'), `${file} must come from the generated web build`);
  }
  assert.equal(fs.existsSync(path.join(servedRoot, 'BUILD_MANIFEST.json')), false);
  assert.equal(fs.existsSync(path.join(servedRoot, 'SOURCE_PROVENANCE.json')), false);
});
