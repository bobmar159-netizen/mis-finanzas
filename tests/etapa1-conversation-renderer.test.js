const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const renderer = require('../frontend/yarbi-conversation-renderer');

const paragraph = runs => ({ id:'p1', type:'paragraph', version:1, runs });
const content = blocks => ({ schema:renderer.SCHEMA, blocks });

test('Etapa 1: adapta texto plano heredado y FAST sin exigir bloques complejos', () => {
  const result = renderer.validateContent('Carlos tiene un saldo pendiente.');
  assert.equal(result.ok, true);
  assert.equal(result.blocks[0].type, 'paragraph');
  assert.equal(result.blocks[0].runs[0].text, 'Carlos tiene un saldo pendiente.');
});

test('Etapa 1: acepta runs combinados de negrita y cursiva', () => {
  const result = renderer.validateContent(content([paragraph([{ text:'Saldo: ' }, { text:'S/ 2,500', marks:['bold', 'italic'] }])]));
  assert.equal(result.ok, true);
  assert.deepEqual(result.blocks[0].runs[1].marks, ['bold', 'italic']);
});

test('Etapa 1: rechaza HTML, scripts, marks desconocidos y propiedades extra por bloque', () => {
  const html = renderer.validateContent(content([paragraph([{ text:'<script>alert(1)</script>' }]) ]));
  const marks = renderer.validateContent(content([paragraph([{ text:'saldo', marks:['underline'] }]) ]));
  const extra = renderer.validateContent(content([{ ...paragraph([{ text:'saldo' }]), onclick:'alert(1)' }]));
  assert.equal(html.ok, false); assert.equal(marks.ok, false); assert.equal(extra.ok, false);
  assert.equal(html.blocks[0].fallback, true);
});

test('Etapa 1: degrada bloques desconocidos y versiones futuras sin bloquear el mensaje', () => {
  const result = renderer.validateContent(content([{ id:'x1', type:'future_widget', version:9 }, paragraph([{ text:'Respuesta segura' }]) ]));
  assert.equal(result.ok, false);
  assert.equal(result.blocks.length, 2);
  assert.equal(result.blocks[0].fallback, true);
  assert.equal(result.blocks[1].type, 'paragraph');
});

test('Etapa 1: aplica límites a runs, bloques y tablas', () => {
  const tooManyRuns = renderer.validateContent(content([paragraph(Array.from({ length:renderer.LIMITS.runsPerParagraph + 1 }, () => ({ text:'x' })))]));
  const hugeTable = renderer.validateContent(content([{ id:'table1', type:'table', version:1, columns:Array.from({ length:renderer.LIMITS.tableColumns + 1 }, () => 'C'), rows:[], summary:'Comparación' }]));
  const tooManyBlocks = renderer.validateContent(content(Array.from({ length:renderer.LIMITS.blocksPerMessage + 1 }, (_, index) => ({ id:'p' + index, type:'paragraph', version:1, runs:[{ text:'x' }] }))));
  assert.equal(tooManyRuns.ok, false); assert.equal(hugeTable.ok, false); assert.equal(tooManyBlocks.ok, false);
});

test('Etapa 1: aplica el límite total visible y rechaza contenido raíz con propiedades inesperadas', () => {
  const withinLimit = renderer.validateContent('x'.repeat(renderer.LIMITS.messageChars));
  const overLimit = renderer.validateContent(content([paragraph([{ text:'x'.repeat(renderer.LIMITS.runChars) }]), ...Array.from({ length:15 }, (_, index) => ({ id:'p' + index, type:'paragraph', version:1, runs:[{ text:'x'.repeat(renderer.LIMITS.runChars) }] }))]));
  const extraRoot = renderer.validateContent({ schema:renderer.SCHEMA, blocks:[paragraph([{ text:'saldo' }])], html:'<b>no</b>' });
  assert.equal(withinLimit.ok, true); assert.equal(overLimit.ok, false); assert.equal(extraRoot.ok, false);
});

test('Etapa 1: valida tabla, listas, paneles, chips y cita sin acciones ejecutables', () => {
  const result = renderer.validateContent(content([
    { id:'h1', type:'heading', version:1, level:1, text:'Resumen' },
    { id:'l1', type:'ordered_list', version:1, items:['Primero', 'Segundo'] },
    { id:'t1', type:'table', version:1, columns:['Cliente', 'Saldo'], rows:[['Cliente sintético', 'S/ 200']], summary:'Saldos sintéticos' },
    { id:'i1', type:'information_panel', version:1, title:'Dato confirmado', text:'No ejecuta acciones.', severity:'info' },
    { id:'w1', type:'warning_panel', version:1, title:'Revisión', text:'Requiere confirmación.', severity:'warning' },
    { id:'s1', type:'status_chip', version:1, text:'Pendiente', severity:'warning' },
    { id:'c1', type:'source_citation', version:1, source_id:'source-1', label:'CRM sintético' }
  ]));
  assert.equal(result.ok, true);
  assert.equal(result.blocks.length, 7);
});

test('Etapa 1: el chat existente carga el renderer después de conservar su ruta F03', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'index.html'), 'utf8');
  assert.match(html, /\/api\/assistant\/conversation/);
  assert.match(html, /<script src="\.\/yarbi-conversation-renderer\.js"><\/script>/);
  assert.match(html, /YarbiConversationRenderer\.appendMessage/);
});
