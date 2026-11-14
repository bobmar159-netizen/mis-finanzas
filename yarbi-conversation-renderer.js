/* Yarbi Conversation Renderer v1: declarative, dependency-free and safe by default. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YarbiConversationRenderer = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const SCHEMA = 'yarbi.conversation-content.v1';
  const LIMITS = Object.freeze({ runChars:2048, runsPerParagraph:64, blocksPerMessage:100, tableRows:50, tableColumns:12, tableCells:600, messageChars:30000, scrollFollowThreshold:72 });
  const MARKS = new Set(['bold', 'italic']);
  const BLOCKS = new Set(['paragraph','heading','ordered_list','unordered_list','checklist','table','information_panel','warning_panel','status_chip','source_citation','image','document_preview','document_excerpt','diagram','chart']);
  const SECURITY_PATTERN = /<\/?[a-z][^>]*>|\bon\w+\s*=|javascript\s*:/i;
  const ROOT_KEYS = new Set(['schema', 'blocks']);

  // Limits are measured in Unicode code points. Array.from preserves surrogate pairs.
  const codePoints = value => Array.from(String(value));
  const characterCount = value => codePoints(value).length;
  const isBlank = value => typeof value !== 'string' || value.trim().length === 0;
  const id = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(value) ? value : null;
  const issue = (code, index) => ({ code, index:Number.isInteger(index) ? index : null });
  function text(value, maximum) {
    return typeof value === 'string' && !isBlank(value) && characterCount(value) <= maximum && !SECURITY_PATTERN.test(value) ? value : null;
  }
  function exactKeys(value, allowed) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.has(key)); }
  function fallbackBlock(message) { return { id:'fallback-' + Math.random().toString(36).slice(2,10), type:'information_panel', version:1, title:'Contenido no disponible', text:message || 'Una parte de la respuesta no se pudo mostrar de forma segura.', severity:'neutral', fallback:true }; }
  function emptyResult() { return { ok:false, blocks:[], issues:[issue('content_empty')], characterCount:0, status:'empty', truncated:false, empty:true }; }
  function truncationResult() { return { ok:false, blocks:[fallbackBlock('La respuesta superó el límite de presentación y no se muestra como completa.')], issues:[issue('message_truncated')], characterCount:LIMITS.messageChars, status:'partial', truncated:true, empty:false }; }
  function base(value, type) { return value && value.type === type && value.version === 1 && id(value.id) ? { id:value.id, type, version:1 } : null; }

  function validateRun(value) {
    if (!exactKeys(value, new Set(['text','marks']))) return null;
    const valueText = text(value.text, LIMITS.runChars); const marks = value.marks === undefined ? [] : value.marks;
    return valueText && Array.isArray(marks) && marks.length <= MARKS.size && new Set(marks).size === marks.length && marks.every(mark => MARKS.has(mark)) ? { text:valueText, marks:[...marks] } : null;
  }
  function validateParagraph(value) {
    const common = base(value,'paragraph');
    if (!common || !exactKeys(value,new Set(['id','type','version','runs'])) || !Array.isArray(value.runs) || !value.runs.length || value.runs.length > LIMITS.runsPerParagraph) return null;
    const runs = []; for (const run of value.runs) { const safe = validateRun(run); if (!safe) return null; runs.push(safe); } return { ...common, runs };
  }
  function validateHeading(value) {
    const common = base(value,'heading'), valueText = value && text(value.text,LIMITS.runChars);
    return common && exactKeys(value,new Set(['id','type','version','level','text'])) && [1,2,3].includes(value.level) && valueText ? { ...common, level:value.level, text:valueText } : null;
  }
  function validateList(value, type) {
    const common = base(value,type); if (!common || !exactKeys(value,new Set(['id','type','version','items'])) || !Array.isArray(value.items) || !value.items.length || value.items.length > 100) return null;
    const items=[]; for (const item of value.items) {
      if (type === 'checklist') { if (!exactKeys(item,new Set(['text','checked'])) || typeof item.checked !== 'boolean' || !text(item.text,LIMITS.runChars)) return null; items.push({text:item.text,checked:item.checked}); }
      else { const valueText=text(item,LIMITS.runChars); if (!valueText) return null; items.push({text:valueText}); }
    } return { ...common, items };
  }
  function validateTable(value) {
    const common=base(value,'table');
    if (!common || !exactKeys(value,new Set(['id','type','version','columns','rows','summary'])) || !Array.isArray(value.columns) || !Array.isArray(value.rows) || value.columns.length < 1 || value.columns.length > LIMITS.tableColumns || value.rows.length > LIMITS.tableRows || value.rows.length * value.columns.length > LIMITS.tableCells || value.rows.some(row => !Array.isArray(row) || row.length !== value.columns.length)) return null;
    const columns=[]; for (const column of value.columns) { const safe=text(column,160); if (!safe) return null; columns.push(safe); }
    const rows=[]; for (const row of value.rows) { const cells=[]; for (const cell of row) { const safe=text(cell,LIMITS.runChars); if (!safe) return null; cells.push(safe); } rows.push(cells); }
    const summary=text(value.summary,500); return summary ? {...common,columns,rows,summary} : null;
  }
  function validatePanel(value,type) { const common=base(value,type), title=value && text(value.title,240), body=value && text(value.text,LIMITS.runChars); return common && exactKeys(value,new Set(['id','type','version','title','text','severity'])) && title && body && ['neutral','info','warning'].includes(value.severity) ? {...common,title,text:body,severity:value.severity} : null; }
  function validateChip(value) { const common=base(value,'status_chip'), valueText=value && text(value.text,120); return common && exactKeys(value,new Set(['id','type','version','text','severity'])) && valueText && ['neutral','info','success','warning','risk'].includes(value.severity) ? {...common,text:valueText,severity:value.severity} : null; }
  function validateCitation(value) { const common=base(value,'source_citation'), sourceId=value && id(value.source_id), label=value && text(value.label,240); return common && exactKeys(value,new Set(['id','type','version','source_id','label'])) && sourceId && label ? {...common,source_id:sourceId,label} : null; }
  function validateFutureMedia(value) { const common=base(value,value && value.type), sourceId=value && id(value.source_id), alt=value && text(value.alt || value.label,240); return common && ['image','document_preview','document_excerpt','diagram','chart'].includes(value.type) && exactKeys(value,new Set(['id','type','version','source_id','alt','label'])) && sourceId && alt ? {...common,source_id:sourceId,alt} : null; }
  function validateBlock(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !BLOCKS.has(value.type) || value.version !== 1) return null;
    if (value.type === 'paragraph') return validateParagraph(value); if (value.type === 'heading') return validateHeading(value);
    if (value.type === 'ordered_list' || value.type === 'unordered_list' || value.type === 'checklist') return validateList(value,value.type);
    if (value.type === 'table') return validateTable(value); if (value.type === 'information_panel' || value.type === 'warning_panel') return validatePanel(value,value.type);
    if (value.type === 'status_chip') return validateChip(value); if (value.type === 'source_citation') return validateCitation(value); return validateFutureMedia(value);
  }
  function visibleCharacters(block) {
    if (block.type === 'paragraph') return block.runs.reduce((total,run) => total + characterCount(run.text),0);
    if (block.type === 'heading' || block.type === 'status_chip') return characterCount(block.text);
    if (block.type === 'ordered_list' || block.type === 'unordered_list' || block.type === 'checklist') return block.items.reduce((total,item) => total + characterCount(item.text),0);
    if (block.type === 'table') return characterCount(block.summary) + block.columns.reduce((total,column) => total + characterCount(column),0) + block.rows.reduce((total,row) => total + row.reduce((sum,cell) => sum + characterCount(cell),0),0);
    if (block.type === 'information_panel' || block.type === 'warning_panel') return characterCount(block.title) + characterCount(block.text);
    return characterCount(block.label || block.alt || '');
  }

  function appendRunChunks(target, value, marks) { const points=codePoints(value); for(let offset=0; offset<points.length; offset+=LIMITS.runChars) target.push({text:points.slice(offset,offset+LIMITS.runChars).join(''),marks:marks || []}); }
  function inlineRuns(value) {
    const runs=[]; let plain=''; const flush=() => { if (plain) { appendRunChunks(runs,plain,[]); plain=''; } };
    for(let index=0; index<value.length;) {
      const marker=value.startsWith('***',index) ? '***' : value.startsWith('**',index) ? '**' : value[index] === '*' ? '*' : '';
      const end=marker ? value.indexOf(marker,index+marker.length) : -1;
      if (!marker || end <= index+marker.length) { plain += marker || value[index]; index += marker ? marker.length : 1; continue; }
      flush(); appendRunChunks(runs,value.slice(index+marker.length,end),marker==='***'?['bold','italic']:marker==='**'?['bold']:['italic']); index=end+marker.length;
    } flush(); return runs.length ? runs : [{text:value,marks:[]}];
  }
  function tableCells(line) { const raw=String(line).trim(); if (!raw.includes('|')) return null; const cells=raw.replace(/^\|/,'').replace(/\|$/,'').split('|').map(cell=>cell.trim()); return cells.length && cells.every(Boolean) ? cells : null; }
  function isTableSeparator(cells) { return cells && cells.every(cell => /^:?-{3,}:?$/.test(cell)); }
  // Conservative Markdown subset: unsupported/incomplete constructs remain literal text.
  function markdownToContent(value,idPrefix) {
    const lines=String(value).replace(/\r\n?/g,'\n').split('\n'), blocks=[], prefix=idPrefix || 'plain'; let paragraph=[];
    const flush=() => { const joined=paragraph.join('\n'); paragraph=[]; if (!isBlank(joined)) blocks.push({id:prefix+'-p'+(blocks.length+1),type:'paragraph',version:1,runs:inlineRuns(joined)}); };
    for(let lineIndex=0; lineIndex<lines.length;) {
      const line=lines[lineIndex]; if (isBlank(line)) { flush(); lineIndex+=1; continue; }
      const heading=/^(#{1,3})\s+(.+)$/.exec(line); if (heading && !isBlank(heading[2])) { flush(); blocks.push({id:prefix+'-h'+(blocks.length+1),type:'heading',version:1,level:heading[1].length,text:heading[2]}); lineIndex+=1; continue; }
      const quote=/^>\s?(.*)$/.exec(line); if (quote) { flush(); const quoted=[]; while(lineIndex<lines.length) { const next=/^>\s?(.*)$/.exec(lines[lineIndex]); if(!next) break; quoted.push(next[1]); lineIndex+=1; } let title='Nota de Yarbi'; if(/^\[[^\]]+\]$/.test(quoted[0]||'')) title=quoted.shift().slice(1,-1).trim()||title; const body=quoted.join('\n').trim(); if(body) blocks.push({id:prefix+'-q'+(blocks.length+1),type:'information_panel',version:1,title,text:body,severity:/importante|atenci[oó]n|riesgo/i.test(title)?'warning':'info'}); continue; }
      const header=tableCells(line), separator=tableCells(lines[lineIndex+1] || ''); if (header && separator && header.length===separator.length && isTableSeparator(separator)) { flush(); const rows=[]; lineIndex+=2; while(lineIndex<lines.length) { const row=tableCells(lines[lineIndex]); if (!row || row.length!==header.length) break; rows.push(row); lineIndex+=1; } blocks.push({id:prefix+'-t'+(blocks.length+1),type:'table',version:1,columns:header,rows,summary:'Tabla de respuesta de Yarbi'}); continue; }
      const checklist=/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/.exec(line), list=/^\s*(?:([-+*])\s+|(\d+)\.\s+)(.+)$/.exec(line); if (checklist || list) { flush(); const ordered=Boolean(list && list[2]), items=[]; while(lineIndex<lines.length) { const nextChecklist=/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/.exec(lines[lineIndex]), nextList=/^\s*(?:([-+*])\s+|(\d+)\.\s+)(.+)$/.exec(lines[lineIndex]); if (checklist ? !nextChecklist : (!nextList || Boolean(nextList[2])!==ordered || Boolean(nextChecklist))) break; if (checklist) items.push({text:nextChecklist[2],checked:nextChecklist[1].toLowerCase()==='x'}); else items.push(nextList[3]); lineIndex+=1; } blocks.push({id:prefix+'-l'+(blocks.length+1),type:checklist?'checklist':ordered?'ordered_list':'unordered_list',version:1,items}); continue; }
      paragraph.push(line); lineIndex+=1;
    } flush(); return {schema:SCHEMA,blocks};
  }
  function plainTextContent(value,idPrefix) { return markdownToContent(typeof value === 'string' ? value : '',idPrefix || 'plain'); }
  function validateContent(value) {
    if (typeof value === 'string') { if (isBlank(value)) return emptyResult(); if (characterCount(value)>LIMITS.messageChars) return truncationResult(); }
    const content=typeof value === 'string' ? plainTextContent(value) : value;
    if (!exactKeys(content,ROOT_KEYS) || content.schema!==SCHEMA || !Array.isArray(content.blocks) || content.blocks.length>LIMITS.blocksPerMessage) return {ok:false,blocks:[fallbackBlock()],issues:[issue('content_schema_invalid')],characterCount:0,status:'partial',truncated:false,empty:false};
    if (!content.blocks.length) return emptyResult();
    const issues=[], blocks=[]; let total=0;
    for(let index=0; index<content.blocks.length; index+=1) { const safe=validateBlock(content.blocks[index]); if (!safe) { issues.push(issue('block_invalid_or_unknown',index)); blocks.push(fallbackBlock()); continue; } const size=visibleCharacters(safe); if (total+size>LIMITS.messageChars) return truncationResult(); total+=size; blocks.push(safe); }
    return {ok:issues.length===0,blocks,issues,characterCount:total,status:issues.length?'partial':'complete',truncated:false,empty:false};
  }

  function element(tag,className,value) { const node=document.createElement(tag); if(className) node.className=className; if(value!==undefined) node.textContent=value; return node; }
  function appendInlineRuns(target,value) { inlineRuns(String(value||'')).forEach(run=>{ let current=document.createTextNode(run.text); if(run.marks.includes('bold')) { const strong=element('strong'); strong.appendChild(current); current=strong; } if(run.marks.includes('italic')) { const em=element('em'); em.appendChild(current); current=em; } target.appendChild(current); }); return target; }
  function renderBlock(block) {
    if (block.type==='paragraph') { const node=element('p','yarbi-content-paragraph'); block.runs.forEach(run=>{ let current=document.createTextNode(run.text); if(run.marks.includes('bold')) { const strong=element('strong'); strong.appendChild(current); current=strong; } if(run.marks.includes('italic')) { const em=element('em'); em.appendChild(current); current=em; } node.appendChild(current); }); return node; }
    if (block.type==='heading') return element('h'+block.level,'yarbi-content-heading yarbi-content-heading-'+block.level,block.text);
    if (block.type==='ordered_list'||block.type==='unordered_list'||block.type==='checklist') { const list=element(block.type==='ordered_list'?'ol':'ul','yarbi-content-list'+(block.type==='checklist'?' yarbi-content-checklist':'')); block.items.forEach(item=>{ const li=element('li'); appendInlineRuns(li,item.text); if(block.type==='checklist') li.setAttribute('data-checked',item.checked?'true':'false'); list.appendChild(li); }); return list; }
    if (block.type==='table') { const wrap=element('div','yarbi-content-table-wrap'), table=element('table','yarbi-content-table'); table.setAttribute('aria-label',block.summary); const thead=document.createElement('thead'), header=document.createElement('tr'); block.columns.forEach(column=>header.appendChild(element('th','',column))); thead.appendChild(header); const tbody=document.createElement('tbody'); block.rows.forEach(row=>{ const tr=document.createElement('tr'); row.forEach(cell=>tr.appendChild(element('td','',cell))); tbody.appendChild(tr); }); table.append(thead,tbody); wrap.appendChild(table); return wrap; }
    if (block.type==='information_panel'||block.type==='warning_panel') { const panel=element('aside','yarbi-content-panel yarbi-content-panel-'+block.severity); panel.setAttribute('role',block.type==='warning_panel'?'alert':'note'); panel.append(element('strong','yarbi-content-panel-title',block.title),element('p','',block.text)); return panel; }
    if (block.type==='status_chip') return element('span','yarbi-content-chip yarbi-content-chip-'+block.severity,block.text);
    if (block.type==='source_citation') { const node=element('p','yarbi-content-source',block.label); node.dataset.sourceId=block.source_id; return node; }
    return element('p','yarbi-content-future','Vista no disponible todavía: '+block.alt);
  }
  function injectStyles() {
    if(typeof document==='undefined'||document.getElementById('yarbi-conversation-renderer-styles')) return;
    const style=document.createElement('style'); style.id='yarbi-conversation-renderer-styles';
    style.textContent=':root{--yarbi-font:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}.yarbi-conversation-message{font-family:var(--yarbi-font);max-width:min(760px,92%);padding:14px 16px;border:1px solid #e5e7eb;border-radius:16px;background:#fff;color:#172033;line-height:1.5;overflow-wrap:anywhere}.yarbi-conversation-message[data-role="user"]{align-self:flex-end;background:#eff6ff;border-color:#bfdbfe}.yarbi-conversation-message[data-role="assistant"]{align-self:flex-start}.yarbi-conversation-message[data-status="partial"]{border-color:#d99b38}.yarbi-conversation-label{font-size:14px;font-weight:600;color:#526071;margin-bottom:8px}.yarbi-content-paragraph{font-size:16px;font-weight:400;line-height:1.5;margin:0 0 12px;white-space:pre-wrap}.yarbi-content-paragraph:last-child{margin-bottom:0}.yarbi-content-heading{color:#172033;margin:20px 0 10px;line-height:1.25}.yarbi-content-heading-1{font-size:clamp(26px,5vw,28px);font-weight:700}.yarbi-content-heading-2{font-size:clamp(21px,4vw,22px);font-weight:700}.yarbi-content-heading-3{font-size:clamp(17px,3vw,18px);font-weight:600}.yarbi-content-list{font-size:16px;margin:0 0 12px;padding-left:24px}.yarbi-content-list li{margin:5px 0}.yarbi-content-checklist{list-style:"☐  "}.yarbi-content-checklist li[data-checked="true"]{list-style:"☑  ";text-decoration:line-through;color:#526071}.yarbi-content-table-wrap{overflow-x:auto;border:1px solid #e5e7eb;border-radius:12px;margin:12px 0}.yarbi-content-table{border-collapse:collapse;min-width:100%;font-size:14px}.yarbi-content-table th,.yarbi-content-table td{padding:9px 11px;text-align:left;border-bottom:1px solid #e5e7eb;white-space:nowrap}.yarbi-content-table th{font-weight:700;background:#f8fafc}.yarbi-content-panel{padding:12px 13px;border:1px solid #dbe4ee;border-left:4px solid #4f7cac;border-radius:12px;background:#f8fbff;margin:12px 0}.yarbi-content-panel-warning{border-left-color:#bc7d16;background:#fffaf0}.yarbi-content-panel p{margin:4px 0 0;font-size:16px}.yarbi-content-chip{display:inline-block;padding:4px 9px;border-radius:999px;font-size:14px;font-weight:600;background:#eef2f7;color:#334155}.yarbi-content-chip-success{background:#e8f6ee;color:#166534}.yarbi-content-chip-warning{background:#fff4db;color:#965d00}.yarbi-content-chip-risk{background:#fff0f0;color:#a61b1b}.yarbi-content-source{font-size:14px;color:#526071;border-top:1px solid #edf0f3;padding-top:8px;margin:12px 0 0}@media (max-width:600px){.yarbi-conversation-message{max-width:100%;padding:13px}.yarbi-content-paragraph,.yarbi-content-list,.yarbi-content-panel p{font-size:16px}.yarbi-content-table th,.yarbi-content-table td{padding:8px 10px}}'; document.head.appendChild(style);
  }
  function messageValue(message) { return message && typeof message==='object' && Object.prototype.hasOwnProperty.call(message,'content') ? message.content : message?.text; }
  function renderMessage(message) { const validation=validateContent(messageValue(message)); if(validation.empty) return {element:null,validation}; injectStyles(); const role=message?.role==='user'?'user':'assistant', article=element('article','yarbi-conversation-message'); article.dataset.role=role; article.dataset.status=message?.status==='partial'||validation.status==='partial'?'partial':'complete'; if(validation.truncated) article.dataset.truncated='true'; article.setAttribute('aria-live',role==='assistant'?'polite':'off'); article.appendChild(element('div','yarbi-conversation-label',role==='user'?'Tú':'Yarbi')); const body=element('div','yarbi-conversation-content'); validation.blocks.forEach(block=>body.appendChild(renderBlock(block))); article.appendChild(body); return {element:article,validation}; }
  function isNearBottom(container) { return Number(container.scrollHeight||0)-Number(container.scrollTop||0)-Number(container.clientHeight||0) <= LIMITS.scrollFollowThreshold; }
  function appendMessage(container,message) { if(!container||typeof container.appendChild!=='function') return {ok:false,code:'renderer_container_missing'}; const follow=isNearBottom(container), rendered=renderMessage(message); if(!rendered.element) return {ok:false,code:'content_empty',...rendered}; container.appendChild(rendered.element); if(follow) { container.scrollTop=container.scrollHeight; delete container.dataset.yarbiNewMessages; } else container.dataset.yarbiNewMessages='true'; return {ok:true,...rendered,followed:follow}; }

  return Object.freeze({SCHEMA,LIMITS,plainTextContent,markdownToContent,validateContent,renderMessage,appendMessage,isNearBottom,characterCount});
}));
