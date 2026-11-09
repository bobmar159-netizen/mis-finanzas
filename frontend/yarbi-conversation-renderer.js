/* Yarbi Conversation Renderer v1: declarative, dependency-free and safe by default. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YarbiConversationRenderer = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const SCHEMA = 'yarbi.conversation-content.v1';
  const LIMITS = Object.freeze({
    runChars: 2048, runsPerParagraph: 64, blocksPerMessage: 100,
    tableRows: 50, tableColumns: 12, tableCells: 600, messageChars: 30000
  });
  const MARKS = new Set(['bold', 'italic']);
  const BLOCKS = new Set([
    'paragraph', 'heading', 'ordered_list', 'unordered_list', 'checklist',
    'table', 'information_panel', 'warning_panel', 'status_chip', 'source_citation',
    'image', 'document_preview', 'document_excerpt', 'diagram', 'chart'
  ]);
  const SECURITY_PATTERN = /<\/?[a-z][^>]*>|\bon\w+\s*=|javascript\s*:/i;

  function text(value, maximum) {
    if (typeof value !== 'string') return null;
    if (!value || value.length > maximum || SECURITY_PATTERN.test(value)) return null;
    return value;
  }

  function id(value) { return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(value) ? value : null; }
  function exactKeys(value, allowed) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return Object.keys(value).every(key => allowed.has(key));
  }
  function issue(code, index) { return { code, index: Number.isInteger(index) ? index : null }; }
  function fallbackBlock(message) {
    return { id: 'fallback-' + Math.random().toString(36).slice(2, 10), type: 'information_panel', version: 1, title: 'Contenido no disponible', text: message || 'Una parte de la respuesta no se pudo mostrar de forma segura.', severity: 'neutral', fallback: true };
  }

  function validateRun(value) {
    if (!exactKeys(value, new Set(['text', 'marks']))) return { ok:false, code:'run_properties_invalid' };
    const valueText = text(value.text, LIMITS.runChars);
    if (!valueText) return { ok:false, code:'run_text_invalid' };
    const marks = value.marks === undefined ? [] : value.marks;
    if (!Array.isArray(marks) || marks.length > MARKS.size || new Set(marks).size !== marks.length || marks.some(mark => !MARKS.has(mark))) return { ok:false, code:'run_marks_invalid' };
    return { ok:true, value:{ text:valueText, marks:[...marks] } };
  }

  function base(value, type) {
    if (!value || value.type !== type || value.version !== 1 || !id(value.id)) return null;
    return { id:value.id, type, version:1 };
  }

  function validateParagraph(value) {
    const common = base(value, 'paragraph');
    if (!common || !exactKeys(value, new Set(['id', 'type', 'version', 'runs'])) || !Array.isArray(value.runs) || !value.runs.length || value.runs.length > LIMITS.runsPerParagraph) return null;
    const runs = value.runs.map(validateRun);
    if (runs.some(run => !run.ok)) return null;
    return { ...common, runs:runs.map(run => run.value) };
  }

  function validateHeading(value) {
    const common = base(value, 'heading');
    const headingText = value && text(value.text, LIMITS.runChars);
    if (!common || !exactKeys(value, new Set(['id', 'type', 'version', 'level', 'text'])) || ![1, 2, 3].includes(value.level) || !headingText) return null;
    return { ...common, level:value.level, text:headingText };
  }

  function validateList(value, type) {
    const common = base(value, type);
    if (!common || !exactKeys(value, new Set(['id', 'type', 'version', 'items'])) || !Array.isArray(value.items) || !value.items.length || value.items.length > 100) return null;
    const items = value.items.map(item => {
      if (type === 'checklist') {
        if (!exactKeys(item, new Set(['text', 'checked'])) || typeof item.checked !== 'boolean') return null;
        return { text:text(item.text, LIMITS.runChars), checked:item.checked };
      }
      return { text:text(item, LIMITS.runChars) };
    });
    if (items.some(item => !item || !item.text)) return null;
    return { ...common, items };
  }

  function validateTable(value) {
    const common = base(value, 'table');
    if (!common || !exactKeys(value, new Set(['id', 'type', 'version', 'columns', 'rows', 'summary'])) || !Array.isArray(value.columns) || !Array.isArray(value.rows) || value.columns.length < 1 || value.columns.length > LIMITS.tableColumns || value.rows.length > LIMITS.tableRows || value.rows.some(row => !Array.isArray(row) || row.length !== value.columns.length) || value.rows.length * value.columns.length > LIMITS.tableCells) return null;
    const columns = value.columns.map(column => text(column, 160));
    const rows = value.rows.map(row => row.map(cell => text(cell, LIMITS.runChars)));
    const summary = text(value.summary, 500);
    if (columns.some(column => !column) || rows.some(row => row.some(cell => !cell)) || !summary) return null;
    return { ...common, columns, rows, summary };
  }

  function validatePanel(value, type) {
    const common = base(value, type);
    const title = value && text(value.title, 240);
    const body = value && text(value.text, LIMITS.runChars);
    if (!common || !exactKeys(value, new Set(['id', 'type', 'version', 'title', 'text', 'severity'])) || !title || !body || !['neutral', 'info', 'warning'].includes(value.severity)) return null;
    return { ...common, title, text:body, severity:value.severity };
  }

  function validateChip(value) {
    const common = base(value, 'status_chip');
    const chipText = value && text(value.text, 120);
    if (!common || !exactKeys(value, new Set(['id', 'type', 'version', 'text', 'severity'])) || !chipText || !['neutral', 'info', 'success', 'warning', 'risk'].includes(value.severity)) return null;
    return { ...common, text:chipText, severity:value.severity };
  }

  function validateCitation(value) {
    const common = base(value, 'source_citation');
    const sourceId = value && id(value.source_id);
    const label = value && text(value.label, 240);
    if (!common || !exactKeys(value, new Set(['id', 'type', 'version', 'source_id', 'label'])) || !sourceId || !label) return null;
    return { ...common, source_id:sourceId, label };
  }

  function validateFutureMedia(value) {
    const common = base(value, value && value.type);
    if (!common || !['image', 'document_preview', 'document_excerpt', 'diagram', 'chart'].includes(value.type)) return null;
    if (!exactKeys(value, new Set(['id', 'type', 'version', 'source_id', 'alt', 'label']))) return null;
    const sourceId = id(value.source_id);
    const alt = text(value.alt || value.label, 240);
    return sourceId && alt ? { ...common, source_id:sourceId, alt } : null;
  }

  function validateBlock(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (!BLOCKS.has(value.type) || value.version !== 1) return null;
    if (value.type === 'paragraph') return validateParagraph(value);
    if (value.type === 'heading') return validateHeading(value);
    if (value.type === 'ordered_list' || value.type === 'unordered_list' || value.type === 'checklist') return validateList(value, value.type);
    if (value.type === 'table') return validateTable(value);
    if (value.type === 'information_panel' || value.type === 'warning_panel') return validatePanel(value, value.type);
    if (value.type === 'status_chip') return validateChip(value);
    if (value.type === 'source_citation') return validateCitation(value);
    return validateFutureMedia(value);
  }

  function plainTextContent(value, idPrefix) {
    const safe = typeof value === 'string' && value.length ? value.slice(0, LIMITS.messageChars) : 'No tengo una respuesta verificable todavía.';
    return { schema:SCHEMA, blocks:[{ id:(idPrefix || 'plain') + '-1', type:'paragraph', version:1, runs:[{ text:safe, marks:[] }] }] };
  }

  function validateContent(value) {
    const content = typeof value === 'string' ? plainTextContent(value) : value;
    const issues = [];
    if (!content || content.schema !== SCHEMA || !Array.isArray(content.blocks) || content.blocks.length > LIMITS.blocksPerMessage) return { ok:false, blocks:[fallbackBlock()], issues:[issue('content_schema_invalid')] };
    let characterCount = 0;
    const blocks = content.blocks.map((block, index) => {
      const validated = validateBlock(block);
      if (!validated) { issues.push(issue('block_invalid_or_unknown', index)); return fallbackBlock(); }
      const serialized = JSON.stringify(validated);
      characterCount += serialized.length;
      if (characterCount > LIMITS.messageChars) { issues.push(issue('message_character_limit', index)); return fallbackBlock('La respuesta excedió el límite de presentación.'); }
      return validated;
    });
    return { ok:issues.length === 0, blocks, issues, characterCount:Math.min(characterCount, LIMITS.messageChars) };
  }

  function element(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  }

  function renderBlock(block) {
    if (block.type === 'paragraph') {
      const node = element('p', 'yarbi-content-paragraph');
      block.runs.forEach(run => {
        let current = document.createTextNode(run.text);
        if (run.marks.includes('bold')) { const strong = element('strong'); strong.appendChild(current); current = strong; }
        if (run.marks.includes('italic')) { const em = element('em'); em.appendChild(current); current = em; }
        node.appendChild(current);
      });
      return node;
    }
    if (block.type === 'heading') return element('h' + block.level, 'yarbi-content-heading yarbi-content-heading-' + block.level, block.text);
    if (block.type === 'ordered_list' || block.type === 'unordered_list' || block.type === 'checklist') {
      const list = element(block.type === 'ordered_list' ? 'ol' : 'ul', 'yarbi-content-list' + (block.type === 'checklist' ? ' yarbi-content-checklist' : ''));
      block.items.forEach(item => { const li = element('li', '', item.text); if (block.type === 'checklist') li.setAttribute('data-checked', item.checked ? 'true' : 'false'); list.appendChild(li); });
      return list;
    }
    if (block.type === 'table') {
      const wrap = element('div', 'yarbi-content-table-wrap'); const table = element('table', 'yarbi-content-table'); table.setAttribute('aria-label', block.summary);
      const thead = document.createElement('thead'); const header = document.createElement('tr'); block.columns.forEach(column => header.appendChild(element('th', '', column))); thead.appendChild(header);
      const tbody = document.createElement('tbody'); block.rows.forEach(row => { const tr = document.createElement('tr'); row.forEach(cell => tr.appendChild(element('td', '', cell))); tbody.appendChild(tr); });
      table.append(thead, tbody); wrap.appendChild(table); return wrap;
    }
    if (block.type === 'information_panel' || block.type === 'warning_panel') {
      const panel = element('aside', 'yarbi-content-panel yarbi-content-panel-' + block.severity); panel.setAttribute('role', block.type === 'warning_panel' ? 'alert' : 'note');
      panel.append(element('strong', 'yarbi-content-panel-title', block.title), element('p', '', block.text)); return panel;
    }
    if (block.type === 'status_chip') return element('span', 'yarbi-content-chip yarbi-content-chip-' + block.severity, block.text);
    if (block.type === 'source_citation') { const node = element('p', 'yarbi-content-source', block.label); node.dataset.sourceId = block.source_id; return node; }
    return element('p', 'yarbi-content-future', 'Vista no disponible todavía: ' + block.alt);
  }

  function injectStyles() {
    if (typeof document === 'undefined' || document.getElementById('yarbi-conversation-renderer-styles')) return;
    const style = document.createElement('style'); style.id = 'yarbi-conversation-renderer-styles';
    style.textContent = ':root{--yarbi-font:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}.yarbi-conversation-message{font-family:var(--yarbi-font);max-width:min(760px,92%);padding:14px 16px;border:1px solid #e5e7eb;border-radius:16px;background:#fff;color:#172033;line-height:1.5;overflow-wrap:anywhere}.yarbi-conversation-message[data-role="user"]{align-self:flex-end;background:#eff6ff;border-color:#bfdbfe}.yarbi-conversation-message[data-role="assistant"]{align-self:flex-start}.yarbi-conversation-label{font-size:14px;font-weight:600;color:#526071;margin-bottom:8px}.yarbi-content-paragraph{font-size:16px;font-weight:400;line-height:1.5;margin:0 0 12px}.yarbi-content-paragraph:last-child{margin-bottom:0}.yarbi-content-heading{color:#172033;margin:20px 0 10px;line-height:1.25}.yarbi-content-heading-1{font-size:clamp(26px,5vw,28px);font-weight:700}.yarbi-content-heading-2{font-size:clamp(21px,4vw,22px);font-weight:700}.yarbi-content-heading-3{font-size:clamp(17px,3vw,18px);font-weight:600}.yarbi-content-list{font-size:16px;margin:0 0 12px;padding-left:24px}.yarbi-content-list li{margin:5px 0}.yarbi-content-checklist{list-style:"☐  "}.yarbi-content-checklist li[data-checked="true"]{list-style:"☑  ";text-decoration:line-through;color:#526071}.yarbi-content-table-wrap{overflow-x:auto;border:1px solid #e5e7eb;border-radius:12px;margin:12px 0}.yarbi-content-table{border-collapse:collapse;min-width:100%;font-size:14px}.yarbi-content-table th,.yarbi-content-table td{padding:9px 11px;text-align:left;border-bottom:1px solid #e5e7eb;white-space:nowrap}.yarbi-content-table th{font-weight:700;background:#f8fafc}.yarbi-content-panel{padding:12px 13px;border:1px solid #dbe4ee;border-left:4px solid #4f7cac;border-radius:12px;background:#f8fbff;margin:12px 0}.yarbi-content-panel-warning{border-left-color:#bc7d16;background:#fffaf0}.yarbi-content-panel p{margin:4px 0 0;font-size:16px}.yarbi-content-chip{display:inline-block;padding:4px 9px;border-radius:999px;font-size:14px;font-weight:600;background:#eef2f7;color:#334155}.yarbi-content-chip-success{background:#e8f6ee;color:#166534}.yarbi-content-chip-warning{background:#fff4db;color:#965d00}.yarbi-content-chip-risk{background:#fff0f0;color:#a61b1b}.yarbi-content-source{font-size:14px;color:#526071;border-top:1px solid #edf0f3;padding-top:8px;margin:12px 0 0}@media (max-width:600px){.yarbi-conversation-message{max-width:100%;padding:13px}.yarbi-content-paragraph,.yarbi-content-list,.yarbi-content-panel p{font-size:16px}.yarbi-content-table th,.yarbi-content-table td{padding:8px 10px}}';
    document.head.appendChild(style);
  }

  function renderMessage(message) {
    injectStyles();
    const role = message?.role === 'user' ? 'user' : 'assistant';
    const validated = validateContent(message?.content || message?.text || '');
    const article = element('article', 'yarbi-conversation-message'); article.dataset.role = role; article.dataset.status = message?.status || (validated.ok ? 'complete' : 'partial');
    article.setAttribute('aria-live', role === 'assistant' ? 'polite' : 'off');
    article.appendChild(element('div', 'yarbi-conversation-label', role === 'user' ? 'Tú' : 'Yarbi'));
    const body = element('div', 'yarbi-conversation-content'); validated.blocks.forEach(block => body.appendChild(renderBlock(block))); article.appendChild(body);
    return { element:article, validation:validated };
  }

  function appendMessage(container, message) {
    if (!container || typeof container.appendChild !== 'function') return { ok:false, code:'renderer_container_missing' };
    const rendered = renderMessage(message); container.appendChild(rendered.element); container.scrollTop = container.scrollHeight; return { ok:true, ...rendered };
  }

  return Object.freeze({ SCHEMA, LIMITS, plainTextContent, validateContent, renderMessage, appendMessage });
}));
