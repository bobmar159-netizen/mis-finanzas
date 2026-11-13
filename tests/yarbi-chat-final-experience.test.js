'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const frontend = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'index.html'), 'utf8');
const memoryCenter = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'yarbi-memory-center.js'), 'utf8');

test('chat final: muestra chips para escuchar, procesar, consultar, escribir y hablar', () => {
  for (const phase of ['listening','processing','consulting','writing','speaking','ready','error']) {
    assert.match(frontend, new RegExp(`data-phase=\\"${phase}\\"|\\[data-phase=\\"${phase}\\"\\]`));
  }
  assert.match(frontend, /gfcYarbiSetProcessStatus\('processing', 'Procesando tu consulta'\)/);
  assert.match(frontend, /gfcYarbiSetProcessStatus\('writing', 'Yarbi está preparando la respuesta'\)/);
  assert.match(memoryCenter, /gfcYarbiSetProcessStatus\?\.\('ready', 'Respuesta lista'\)/);
});

test('chat final: balance Live usa herramienta determinista y nunca depende del mentor para montos', () => {
  assert.match(frontend, /name: 'get_financial_summary'/);
  assert.match(frontend, /if \(name === 'get_financial_summary'\) return gfcBuildVerifiedFinancialSummary\(\)/);
  assert.match(frontend, /No uses get_mentor_briefing para calcular montos/);
  assert.match(frontend, /liveStructuredReply/);
  assert.match(frontend, /gfcFinancialSummaryRichText/);
});

test('chat final: la actualización del APK activa el nuevo Service Worker sin borrar datos', () => {
  assert.match(frontend, /navigator\.serviceWorker\.addEventListener\('controllerchange'/);
  assert.match(frontend, /return reg\.update\(\)/);
  assert.doesNotMatch(frontend.slice(0, 1400), /caches\.delete|localStorage\.clear|indexedDB\.deleteDatabase/);
});

