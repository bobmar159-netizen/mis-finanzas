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
  assert.equal((html.match(/window\.gfcAppendCopilotChatMessage\s*=/g) || []).length, 0);
  const memoryCenter = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'yarbi-memory-center.js'), 'utf8');
  assert.equal((memoryCenter.match(/window\.gfcAppendCopilotChatMessage\s*=/g) || []).length, 0);
  assert.match(memoryCenter, /window\.gfcAppendCopilotTimelineMessage\s*=/);
  assert.match(memoryCenter, /YarbiConversationRenderer\.appendMessage/);
});

test('Etapa 1.1: el punto de entrada real usa el renderer una sola vez para un mensaje del asistente', async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'index.html'), 'utf8');
  const start = html.indexOf('async function gfcAppendCopilotChatMessage(role, text) {');
  assert.ok(start >= 0);
  let depth = 0; let end = -1;
  for (let index = html.indexOf('{', start); index < html.length; index += 1) {
    if (html[index] === '{') depth += 1;
    if (html[index] === '}' && --depth === 0) { end = index + 1; break; }
  }
  const source = html.slice(start, end);
  const calls = [];
  const box = { appendChild() {}, scrollTop:0, scrollHeight:0 };
  const windowMock = { YarbiConversationRenderer:{ appendMessage(container, message) { calls.push({ container, message }); return { ok:true }; } } };
  const fn = new Function('window', 'document', source + '; return gfcAppendCopilotChatMessage;')(windowMock, { getElementById:id => id === 'gfc-copilot-chat-messages' ? box : null });
  const result = await fn('assistant', 'Respuesta real');
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].message, { role:'assistant', text:'Respuesta real', status:'complete' });
});

test('Etapa 1.1: contenido vacío no fabrica una respuesta ni crea una burbuja', () => {
  for (const value of ['', ' ', '\n\t']) {
    const result = renderer.validateContent(value);
    assert.equal(result.empty, true);
    assert.equal(result.issues[0].code, 'content_empty');
  }
  const container = { scrollHeight:100, scrollTop:0, clientHeight:100, dataset:{}, appended:0, appendChild() { this.appended += 1; } };
  const result = renderer.appendMessage(container, { role:'assistant', text:'   ' });
  assert.equal(result.code, 'content_empty');
  assert.equal(container.appended, 0);
  const emptyBlocks = renderer.validateContent(content([]));
  const noTextBlock = renderer.validateContent(content([paragraph([{ text:'' }])]));
  assert.equal(emptyBlocks.issues[0].code, 'content_empty');
  assert.equal(noTextBlock.status, 'partial');
});

test('Etapa 1.1: no corta Unicode ni presenta una respuesta mayor a 30k como completa', () => {
  const result = renderer.validateContent('😀'.repeat(renderer.LIMITS.messageChars + 1));
  assert.equal(result.ok, false);
  assert.equal(result.truncated, true);
  assert.equal(result.status, 'partial');
  assert.equal(result.issues[0].code, 'message_truncated');
  assert.equal(renderer.characterCount('😀á𐐷'), 3);
});

test('Etapa 1.1: adapta Markdown permitido a bloques tipados y conserva sintaxis incompleta como texto', () => {
  const result = renderer.validateContent('# Pendientes\n\nSaldo de **Carlos** y *detalle*.\n\n1. Llamar\n2. Confirmar\n\n| Cliente | Saldo |\n| --- | --- |\n| Sintético | S/ 200 |');
  assert.equal(result.ok, true);
  assert.deepEqual(result.blocks.map(block => block.type), ['heading', 'paragraph', 'ordered_list', 'table']);
  assert.deepEqual(result.blocks[1].runs.map(run => run.marks), [[], ['bold'], [], ['italic'], []]);
  const literal = renderer.validateContent('Texto con **asterisco sin cierre y x < y; `código`');
  assert.equal(literal.ok, true);
  assert.equal(literal.blocks[0].runs[0].text.includes('**asterisco sin cierre'), true);
  assert.equal(renderer.validateContent('Comparación segura: x < y.').ok, true);
});

test('Etapa 1.1: corta la validación estructural al exceder el presupuesto global', () => {
  const large = paragraph(Array.from({ length:renderer.LIMITS.runsPerParagraph }, () => ({ text:'x'.repeat(renderer.LIMITS.runChars) })));
  const unvisited = {};
  Object.defineProperty(unvisited, 'type', { get() { throw new Error('No debe validar bloques posteriores al truncamiento'); } });
  const result = renderer.validateContent(content([large, unvisited]));
  assert.equal(result.truncated, true);
  assert.equal(result.issues[0].code, 'message_truncated');
});

test('Etapa 1.1: conserva la lectura al no estar cerca del final y sigue mensajes cuando sí lo está', () => {
  const priorDocument = global.document;
  const makeNode = () => ({ dataset:{}, children:[], appendChild(node) { this.children.push(node); return node; }, append(...nodes) { nodes.forEach(node => this.appendChild(node)); }, setAttribute() {} });
  global.document = { getElementById() { return null; }, createElement() { return makeNode(); }, createTextNode(value) { return { textContent:value }; }, head:makeNode() };
  try {
    const away = { scrollHeight:1000, scrollTop:100, clientHeight:200, dataset:{}, appended:0, appendChild() { this.appended += 1; } };
    const near = { scrollHeight:1000, scrollTop:730, clientHeight:200, dataset:{}, appended:0, appendChild() { this.appended += 1; } };
    const awayResult = renderer.appendMessage(away, { role:'assistant', text:'No interrumpir lectura.' });
    const nearResult = renderer.appendMessage(near, { role:'assistant', text:'Seguir conversación.' });
    assert.equal(awayResult.followed, false); assert.equal(away.scrollTop, 100); assert.equal(away.dataset.yarbiNewMessages, 'true');
    assert.equal(nearResult.followed, true); assert.equal(near.scrollTop, near.scrollHeight); assert.equal(near.appended, 1);
  } finally { global.document = priorDocument; }
});
