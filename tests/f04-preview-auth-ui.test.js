'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const frontend = fs.readFileSync(path.join(root, 'frontend', 'index.html'), 'utf8');
const completionUi = fs.readFileSync(path.join(root, 'frontend', 'yarbi-product-completion-ui.js'), 'utf8');

function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to >= 0, `no se encontró bloque ${start}`);
  return source.slice(from, to);
}

test('F04 Preview: el formulario de contraseña está limitado al Preview aislado y limpia la contraseña', () => {
  const signIn = between(frontend, 'async function gfcAccountSignInPreview()', 'window.gfcOpenYarbiAccount =');
  assert.match(signIn, /config\.previewOwnerReferencesOnly !== true/);
  assert.match(signIn, /token\?grant_type=password/);
  assert.match(signIn, /passwordInput\.value = ''/);
  assert.match(signIn, /window\.__gfcPreviewAccountAccessToken = session\.access_token/);
  assert.doesNotMatch(signIn.replace(/\/\/[^\r\n]*/g, ''), /gfcAccountRestoreBeforeSync\s*\(/);
  assert.match(frontend, /window\.gfcAccountAccessToken = gfcAccountAccessToken/);
  assert.match(frontend, /sessionStorage\.setItem\(GFC_ACCOUNT_ACCESS_KEY, session\.access_token\)/);
  assert.match(completionUi, /localStorage\.getItem\('gfc_supabase_access_token_v1'\)/);
  assert.match(frontend, /delete window\.__gfcPreviewAccountAccessToken/);
  assert.match(frontend, /id="yarbi-account-password"/);
  assert.match(frontend, /Iniciar Preview aislado/);
});

test('F04 Preview: la Bandeja dirige una sesión ausente a Cuenta, sin fallback de CRM', () => {
  assert.match(completionUi, /data-open-account/);
  assert.match(completionUi, /window\.gfcOpenYarbiAccount/);
  assert.match(completionUi, /No se usó ningún fallback hacia otro entorno/);
  assert.match(completionUi, /Diagnóstico seguro/);
  assert.match(completionUi, /safeCode\(payload\.error\)/);
  assert.doesNotMatch(completionUi, /misfinanzas-backend\.vercel\.app/);
});

test('F04 Preview: renueva una sesión expirada antes de consultar CRM y limita el reintento a una vez', () => {
  const refresh = between(frontend, 'async function gfcAccountFreshAccessToken(options = {})', '// Módulos cargados por separado');
  assert.match(refresh, /token\?grant_type=refresh_token/);
  assert.match(refresh, /refresh_token: refreshToken/);
  assert.match(refresh, /sessionStorage\.setItem\(GFC_ACCOUNT_ACCESS_KEY, session\.access_token\)/);
  assert.match(frontend, /window\.gfcAccountFreshAccessToken = gfcAccountFreshAccessToken/);
  assert.match(completionUi, /async function authenticatedRequest/);
  assert.match(completionUi, /response\.status === 401/);
  assert.match(completionUi, /freshAccountToken\(true\)/);
  assert.equal((completionUi.match(/response\s*=\s*await fetch\(url, request\(token\)\)/g) || []).length, 2);
  assert.doesNotMatch(refresh, /console\.|JSON\.stringify\(session\)|localStorage\.setItem\([^,]+,\s*refreshToken\)/);
});

test('F04 Preview: una recarga no restaura configuraciones, bóveda ni deudas en el modo CRM de solo lectura', () => {
  const boot = between(frontend, 'async function gfcAccountRestoreOnBoot()', 'setTimeout(() => { gfcAccountRestoreOnBoot()');
  assert.match(boot, /previewOwnerReferencesOnly === true/);
  assert.match(boot, /gfcAccountFreshAccessToken\(\)/);
  const previewBranch = boot.slice(boot.indexOf('if (config?.previewOwnerReferencesOnly === true)'), boot.indexOf('return gfcAccountRestoreBeforeSync()'));
  assert.doesNotMatch(previewBranch, /gfcAccountRestoreBeforeSync|gfcAccountSettings|gfcAccountVault|gfcAccountDebts/);
  assert.match(boot, /return gfcAccountRestoreBeforeSync\(\)/);
});
