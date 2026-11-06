const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeReplyStylePatterns, sanitizeStyleExample } = require('../lib/yarbi-reply-style');

const root = path.join(__dirname, '..');
const workspace = path.resolve(root, '..');

test('reply style: accepts only traceable outgoing evidence', () => {
  const rows = normalizeReplyStylePatterns([{
    category: 'follow_up',
    pattern_key: 'followup-breve-pregunta',
    guidance: 'Hace seguimientos breves y termina con una pregunta concreta.',
    source_message_ids: ['out-1', 'in-1'],
    confidence: 0.91
  }], [
    { id: 'out-1', metadata: { direction: 'outgoing' } },
    { id: 'in-1', metadata: { direction: 'incoming' } }
  ]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].source_message_ids, ['out-1']);
});

test('reply style: rejects incoming-only and weak guesses', () => {
  const rows = normalizeReplyStylePatterns([{
    category: 'tone',
    guidance: 'Utiliza un tono amable y cercano con todos los clientes.',
    source_message_ids: ['in-1'],
    confidence: 0.99
  }], [{ id: 'in-1', metadata: { direction: 'incoming' } }]);
  assert.deepEqual(rows, []);
});

test('reply style: sanitizes facts that must never leak into another suggested reply', () => {
  const sanitized = sanitizeStyleExample('Te cobro S/ 250 soles, escríbeme al 999888777 y voy el 12/10 a las 14:30 https://maps.google.com/x');
  assert.doesNotMatch(sanitized, /250|999888777|12\/10|14:30|https:/);
  assert.match(sanitized, /\[monto\]|\[telefono\]|\[fecha\]|\[hora\]|\[enlace\]/);
});

test('reply style: processor persists patterns and injects the active profile', () => {
  const processor = fs.readFileSync(path.join(root, 'api', 'ai', 'process.js'), 'utf8');
  const mirror = fs.readFileSync(path.join(root, 'lib', 'whatsapp-messages.js'), 'utf8');
  const frontend = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(processor, /record_yarbi_reply_style_pattern/);
  assert.match(processor, /PERFIL DE ESTILO APRENDIDO/);
  assert.match(processor, /reply_style_patterns/);
  assert.match(mirror, /yarbi_reply_style_patterns/);
  assert.match(frontend, /REPLY_STYLE_LEARNING_V2/);
  assert.match(frontend, /reply_style_profile/);
});

test('reply style: historical bootstrap is protected and starts only after explicit in-app consent', () => {
  const processor = fs.readFileSync(path.join(root, 'api', 'ai', 'process.js'), 'utf8');
  const frontend = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(processor, /body\.action === 'bootstrap-reply-style'/);
  assert.match(processor, /if \(!authorized\(req\)\) return res\.status\(401\)/);
  assert.match(processor, /responseSchema: REPLY_STYLE_RESPONSE_SCHEMA/);
  assert.match(processor, /requestBootstrapReplyStyle\(samples, 8, 2400\)/);
  assert.match(processor, /requestBootstrapReplyStyle\(samples, 6, 3200\)/);
  assert.doesNotMatch(processor, /No se pudo preparar el estilo de respuesta'\s*,\s*detail:/);
  assert.match(frontend, /function gfcLearnHistoricalReplyStyle\(\)/);
  assert.match(frontend, /window\.confirm\(/);
  assert.match(frontend, /action: 'bootstrap-reply-style'/);
  assert.match(frontend, /requested_by: 'yarbi-explicit-user-consent'/);
  assert.match(frontend, /gfc-reply-style-btn/);
  assert.doesNotMatch(frontend, /setTimeout\(gfcLearnHistoricalReplyStyle|DOMContentLoaded[^\n]+gfcLearnHistoricalReplyStyle/);
});

test('reply style: migration is additive, private and evidence based', () => {
  const sql = fs.readFileSync(path.join(workspace, 'YARBI_REPLY_STYLE_MIGRATION_20261003.sql'), 'utf8');
  assert.match(sql, /create table if not exists public\.yarbi_reply_style_patterns/);
  assert.match(sql, /record_yarbi_reply_style_pattern/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /grant execute[\s\S]+to service_role/i);
  assert.doesNotMatch(sql, /\bdrop\s+table\b|\btruncate\b|\bdelete\s+from\b/i);
});
