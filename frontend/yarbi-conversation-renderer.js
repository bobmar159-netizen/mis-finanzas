/* Yarbi Conversation Renderer v2: declarative, dependency-free and safe by default. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YarbiConversationRenderer = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const SCHEMA = 'yarbi.conversation-content.v2';
  const LEGACY_SCHEMA = 'yarbi.conversation-content.v1';
  const LIMITS = Object.freeze({ runChars:2048, runsPerParagraph:64, blocksPerMessage:100, tableRows:50, tableColumns:12, tableCells:600, messageChars:30000, scrollFollowThreshold:72, fieldsPerCard:14, sourcesPerMessage:12 });
  const MARKS = new Set(['bold','italic','highlight','code']);
  const PRIORITIES = new Set(['subtle','normal','important']);
  const SEVERITIES = new Set(['neutral','info','success','warning','risk']);
  const TYPES = new Set(['paragraph','heading','subheading','ordered_list','numbered_list','unordered_list','bullet_list','checklist','table','information_panel','info_panel','warning_panel','success_panel','status_chip','source_citation','source_reference','document_excerpt','image_reference','image','document_preview','diagram','chart','metric_card','summary_card','client_card','appointment_card','finance_card','recommendation_block','example_block','next_steps_block','quote']);
  const SECURITY_PATTERN = /<\/?[a-z][^>]*>|\bon\w+\s*=|javascript\s*:/i;
  const ROOT_KEYS = new Set(['schema','blocks']);
  const METADATA_KEYS = new Set(['sourceId','sourceHash','page','section','verified','origin','confidence','ownerScoped']);
  const ALIASES = Object.freeze({ subheading:'heading', numbered_list:'ordered_list', bullet_list:'unordered_list', info_panel:'information_panel', image:'image_reference', document_preview:'source_reference', diagram:'image_reference', chart:'image_reference' });

  const codePoints = value => Array.from(String(value));
  const characterCount = value => codePoints(value).length;
  const isBlank = value => typeof value !== 'string' || value.trim().length === 0;
  const id = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(value) ? value : null;
  const issue = (code,index) => ({ code, index:Number.isInteger(index) ? index : null });
  function safeText(value, maximum) { return typeof value === 'string' && !isBlank(value) && characterCount(value) <= maximum && !SECURITY_PATTERN.test(value) ? value : null; }
  function exactKeys(value, allowed) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.has(key)); }
  function makeId(prefix, suffix) { const safe = String(prefix || 'reply').replace(/[^A-Za-z0-9._:-]/g,'-').slice(0,80) || 'reply'; return safe + '-' + suffix; }
  function fallbackBlock(message,index) { return { id:makeId('fallback',String(index ?? 0)), type:'information_panel', version:1, title:'Contenido no disponible', text:message || 'Una parte de la respuesta no se pudo mostrar de forma segura.', severity:'neutral', fallback:true }; }
  function emptyResult() { return { ok:false, blocks:[], issues:[issue('content_empty')], characterCount:0, status:'empty', truncated:false, empty:true }; }
  function truncationResult() { return { ok:false, blocks:[fallbackBlock('La respuesta superó el límite de presentación y no se muestra como completa.',0)], issues:[issue('message_truncated')], characterCount:LIMITS.messageChars, status:'partial', truncated:true, empty:false }; }

  function common(value,type,fields) {
    if (!value || value.type !== type || value.version !== 1 || !id(value.id)) return null;
    const allowed = new Set(['id','type','version','priority','metadata',...fields]);
    if (!exactKeys(value,allowed)) return null;
    const result = { id:value.id, type, version:1 };
    if (value.priority !== undefined) { if (!PRIORITIES.has(value.priority)) return null; result.priority=value.priority; }
    if (value.metadata !== undefined) { const metadata=validateMetadata(value.metadata); if (!metadata) return null; result.metadata=metadata; }
    return result;
  }
  function validateMetadata(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length>8 || !exactKeys(value,METADATA_KEYS)) return null;
    const output={};
    for (const [key,item] of Object.entries(value)) {
      if (key==='page') { if (!Number.isSafeInteger(item) || item<1 || item>25000) return null; output.page=item; continue; }
      if (key==='confidence') { if (typeof item!=='number' || !Number.isFinite(item) || item<0 || item>1) return null; output.confidence=item; continue; }
      if (key==='verified' || key==='ownerScoped') { if (typeof item!=='boolean') return null; output[key]=item; continue; }
      const limit=key==='sourceHash'?64:240, valueText=safeText(item,limit);
      if (!valueText || key==='sourceHash' && !/^[a-f0-9]{32,64}$/i.test(valueText)) return null;
      output[key]=valueText;
    }
    return output;
  }
  function validateRun(value) {
    if (!exactKeys(value,new Set(['text','marks']))) return null;
    const valueText=safeText(value.text,LIMITS.runChars), marks=value.marks===undefined?[]:value.marks;
    return valueText && Array.isArray(marks) && marks.length<=MARKS.size && new Set(marks).size===marks.length && marks.every(mark=>MARKS.has(mark)) ? {text:valueText,marks:[...marks]} : null;
  }
  function validateParagraph(value) {
    const base=common(value,'paragraph',['runs']);
    if (!base || !Array.isArray(value.runs) || !value.runs.length || value.runs.length>LIMITS.runsPerParagraph) return null;
    const runs=[]; for (const run of value.runs) { const valid=validateRun(run); if(!valid)return null; runs.push(valid); }
    return {...base,runs};
  }
  function validateHeading(value) {
    const base=common(value,'heading',['level','text']), text=safeText(value?.text,LIMITS.runChars);
    return base && [1,2,3].includes(value.level) && text ? {...base,level:value.level===1&&value.priority==='subtle'?2:value.level,text} : null;
  }
  function validateList(value,type) {
    const base=common(value,type,['items']);
    if(!base||!Array.isArray(value.items)||!value.items.length||value.items.length>100)return null;
    const items=[];
    for(const item of value.items) {
      if(type==='checklist') { if(!exactKeys(item,new Set(['text','checked']))||typeof item.checked!=='boolean')return null; const text=safeText(item.text,LIMITS.runChars); if(!text)return null; items.push({text,checked:item.checked}); }
      else { const text=safeText(typeof item==='string'?item:item?.text,LIMITS.runChars); if(!text)return null; items.push({text}); }
    }
    return {...base,items};
  }
  function validateTable(value) {
    const base=common(value,'table',['columns','rows','summary']);
    if(!base||!Array.isArray(value.columns)||!Array.isArray(value.rows)||value.columns.length<1||value.columns.length>LIMITS.tableColumns||value.rows.length>LIMITS.tableRows||value.rows.length*value.columns.length>LIMITS.tableCells||value.rows.some(row=>!Array.isArray(row)||row.length!==value.columns.length))return null;
    const columns=value.columns.map(cell=>safeText(cell,160)); if(columns.some(cell=>!cell))return null;
    const rows=value.rows.map(row=>row.map(cell=>safeText(String(cell??''),LIMITS.runChars))); if(rows.some(row=>row.some(cell=>!cell)))return null;
    const summary=safeText(value.summary,500); return summary?{...base,columns,rows,summary}:null;
  }
  function validatePanel(value,type) {
    const base=common(value,type,['title','text','severity']), title=safeText(value?.title,240), body=safeText(value?.text,LIMITS.runChars);
    const severity=value?.severity || (type==='warning_panel'?'warning':type==='success_panel'?'success':'info');
    return base&&title&&body&&SEVERITIES.has(severity)?{...base,title,text:body,severity}:null;
  }
  function validateChip(value) { const base=common(value,'status_chip',['text','severity']), text=safeText(value?.text,120), severity=value?.severity||'info'; return base&&text&&SEVERITIES.has(severity)?{...base,text,severity}:null; }
  function validateFields(value) {
    if(!Array.isArray(value)||value.length>LIMITS.fieldsPerCard)return null;
    const fields=[];
    for(const field of value) {
      if(!exactKeys(field,new Set(['label','value','detail','tone'])))return null;
      const label=safeText(String(field.label??''),100), fieldValue=safeText(String(field.value??''),240), detail=field.detail===undefined?undefined:safeText(String(field.detail),180), tone=field.tone===undefined?'neutral':field.tone;
      if(!label||!fieldValue||field.detail!==undefined&&!detail||!SEVERITIES.has(tone))return null;
      fields.push({label,value:fieldValue,...(detail?{detail}:{}),tone});
    }
    return fields;
  }
  function validateCard(value,type) {
    const base=common(value,type,['title','summary','text','label','value','detail','unit','trend','tone','fields','items']);
    const title=safeText(value?.title||value?.label,180), summary=value?.summary===undefined?undefined:safeText(value.summary,800), body=value?.text===undefined?undefined:safeText(value.text,1200);
    const tone=value?.tone===undefined?'neutral':value.tone;
    if(!base||!title||summary===null||body===null||!SEVERITIES.has(tone))return null;
    let fields; if(value.fields!==undefined){fields=validateFields(value.fields);if(!fields)return null;}
    let metric;
    if(type==='metric_card') {
      const metricValue=safeText(String(value.value??''),100), detail=value.detail===undefined?undefined:safeText(String(value.detail),240), unit=value.unit===undefined?undefined:safeText(String(value.unit),40), trend=value.trend===undefined?undefined:safeText(String(value.trend),100);
      if(!metricValue||value.detail!==undefined&&!detail||value.unit!==undefined&&!unit||value.trend!==undefined&&!trend)return null;
      metric={value:metricValue,...(detail?{detail}:{}),...(unit?{unit}:{}),...(trend?{trend}:{})};
    }
    let items; if(value.items!==undefined){items=validateItems(value.items);if(!items)return null;}
    return {...base,title,tone,...(summary?{summary}:{}),...(body?{text:body}:{}),...(fields?{fields}:{}),...(metric||{}),...(items?{items}:{})};
  }
  function validateItems(value) {
    if(!Array.isArray(value)||!value.length||value.length>30)return null;
    const items=[];
    for(const item of value){const entry=typeof item==='string'?{text:item}:item;if(!exactKeys(entry,new Set(['text','detail'])) )return null;const text=safeText(entry.text,500),detail=entry.detail===undefined?undefined:safeText(entry.detail,300);if(!text||entry.detail!==undefined&&!detail)return null;items.push({text,...(detail?{detail}:{})});}
    return items;
  }
  function validateCitation(value,type) {
    const fields=['source_id','label','file_name','section','page','excerpt','quotation'];
    const base=common(value,type,fields), sourceId=id(value?.source_id), label=safeText(value?.label,240);
    const fileName=value?.file_name===undefined?undefined:safeText(value.file_name,240), section=value?.section===undefined?undefined:safeText(value.section,240), excerpt=value?.excerpt===undefined?undefined:safeText(value.excerpt,1600);
    if(!base||!sourceId||!label||type==='document_excerpt'&&!excerpt||value.file_name!==undefined&&!fileName||value.section!==undefined&&!section||value.excerpt!==undefined&&!excerpt)return null;
    if(value.page!==undefined&&(!Number.isSafeInteger(value.page)||value.page<1||value.page>25000))return null;
    const quotation=value.quotation===undefined?'literal':value.quotation;
    if(!['literal','summary','interpretation'].includes(quotation))return null;
    return {...base,source_id:sourceId,label,...(fileName?{file_name:fileName}:{}),...(section?{section}:{}),...(value.page?{page:value.page}:{}),...(excerpt?{excerpt}:{}),...(type==='document_excerpt'?{quotation}:{})};
  }
  function validateQuote(value) {
    const base=common(value,'quote',['text','attribution','source_id','page']), body=safeText(value?.text,1600), attribution=value?.attribution===undefined?undefined:safeText(value.attribution,240), sourceId=value?.source_id===undefined?undefined:id(value.source_id);
    if(!base||!body||value.attribution!==undefined&&!attribution||value.source_id!==undefined&&!sourceId||value.page!==undefined&&(!Number.isSafeInteger(value.page)||value.page<1))return null;
    return {...base,text:body,...(attribution?{attribution}:{}),...(sourceId?{source_id:sourceId}:{}),...(value.page?{page:value.page}:{})};
  }
  function validateImageReference(value) {
    const base=common(value,'image_reference',['source_id','alt','label','file_name','page']), sourceId=id(value?.source_id), alt=safeText(value?.alt||value?.label,240), label=value?.label===undefined?undefined:safeText(value.label,180), fileName=value?.file_name===undefined?undefined:safeText(value.file_name,240);
    if(!base||!sourceId||!alt||value.label!==undefined&&!label||value.file_name!==undefined&&!fileName||value.page!==undefined&&(!Number.isSafeInteger(value.page)||value.page<1))return null;
    return {...base,source_id:sourceId,alt,...(label?{label}:{}),...(fileName?{file_name:fileName}:{}),...(value.page?{page:value.page}:{})};
  }
  function validateBlock(raw) {
    if(!raw||typeof raw!=='object'||Array.isArray(raw)||!TYPES.has(raw.type)||raw.version!==1)return null;
    const type=ALIASES[raw.type]||raw.type, value=raw.type===type?raw:{...raw,type};
    if(type==='paragraph')return validateParagraph(value);
    if(type==='heading')return validateHeading(value);
    if(type==='ordered_list'||type==='unordered_list'||type==='checklist')return validateList(value,type);
    if(type==='table')return validateTable(value);
    if(['information_panel','warning_panel','success_panel'].includes(type))return validatePanel(value,type);
    if(type==='status_chip')return validateChip(value);
    if(type==='source_citation'||type==='source_reference'||type==='document_excerpt')return validateCitation(value,type);
    if(['metric_card','summary_card','client_card','appointment_card','finance_card','recommendation_block','example_block','next_steps_block'].includes(type))return validateCard(value,type);
    if(type==='quote')return validateQuote(value);
    return validateImageReference(value);
  }
  function visibleCharacters(block) {
    if(block.type==='paragraph')return block.runs.reduce((n,run)=>n+characterCount(run.text),0);
    if(block.type==='heading'||block.type==='status_chip')return characterCount(block.text);
    if(['ordered_list','unordered_list','checklist','next_steps_block'].includes(block.type))return (block.items||[]).reduce((n,item)=>n+characterCount(item.text),0);
    if(block.type==='table')return characterCount(block.summary)+block.columns.reduce((n,v)=>n+characterCount(v),0)+block.rows.reduce((n,row)=>n+row.reduce((sum,v)=>sum+characterCount(v),0),0);
    if(['information_panel','warning_panel','success_panel'].includes(block.type))return characterCount(block.title)+characterCount(block.text);
    if(block.type==='document_excerpt'||block.type==='source_citation'||block.type==='source_reference')return characterCount(block.label)+characterCount(block.excerpt||'');
    if(block.type==='quote')return characterCount(block.text);
    return characterCount(block.title||block.label||'')+characterCount(block.summary||block.text||block.value||'')+(block.fields||[]).reduce((n,f)=>n+characterCount(f.label)+characterCount(f.value),0)+(block.items||[]).reduce((n,item)=>n+characterCount(item.text),0);
  }
  function appendRunChunks(target,value,marks) { const points=codePoints(value); for(let offset=0;offset<points.length;offset+=LIMITS.runChars)target.push({text:points.slice(offset,offset+LIMITS.runChars).join(''),marks:marks||[]}); }
  function inlineRuns(value) {
    const runs=[];let plain='';const flush=()=>{if(plain){appendRunChunks(runs,plain,[]);plain='';}};
    for(let index=0;index<value.length;) {
      const marker=value.startsWith('***',index)?'***':value.startsWith('**',index)?'**':value.startsWith('==',index)?'==':value[index]==='*'?'*':value[index]==='`'?'`':'';
      const end=marker?value.indexOf(marker,index+marker.length):-1;
      if(!marker||end<=index+marker.length){plain+=marker||value[index];index+=marker?marker.length:1;continue;}
      flush();const marks=marker==='***'?['bold','italic']:marker==='**'?['bold']:marker==='=='?['highlight']:marker==='`'?['code']:['italic'];appendRunChunks(runs,value.slice(index+marker.length,end),marks);index=end+marker.length;
    }
    flush();return runs.length?runs:[{text:value,marks:[]}];
  }
  function tableCells(line) { const raw=String(line).trim();if(!raw.includes('|'))return null;const cells=raw.replace(/^\|/,'').replace(/\|$/,'').split('|').map(cell=>cell.trim());return cells.length&&cells.every(Boolean)?cells:null; }
  function isTableSeparator(cells) { return cells&&cells.every(cell=>/^:?-{3,}:?$/.test(cell)); }
  function markdownToContent(value,idPrefix) {
    const lines=String(value).replace(/\r\n?/g,'\n').split('\n'),blocks=[],prefix=id(idPrefix)?idPrefix:'plain';let paragraph=[];
    const flush=()=>{const joined=paragraph.join('\n');paragraph=[];if(!isBlank(joined))blocks.push({id:makeId(prefix,'p'+(blocks.length+1)),type:'paragraph',version:1,runs:inlineRuns(joined)});};
    for(let index=0;index<lines.length;) {
      const line=lines[index];if(isBlank(line)){flush();index+=1;continue;}
      const heading=/^(#{1,3})\s+(.+)$/.exec(line);if(heading){flush();blocks.push({id:makeId(prefix,'h'+(blocks.length+1)),type:'heading',version:1,level:heading[1].length,text:heading[2]});index+=1;continue;}
      const quote=/^>\s?(.*)$/.exec(line);if(quote){flush();const quoted=[];while(index<lines.length){const next=/^>\s?(.*)$/.exec(lines[index]);if(!next)break;quoted.push(next[1]);index+=1;}let title='Nota de Yarbi';if(/^\[[^\]]+\]$/.test(quoted[0]||''))title=quoted.shift().slice(1,-1).trim()||title;const body=quoted.join('\n').trim();if(body)blocks.push({id:makeId(prefix,'q'+(blocks.length+1)),type:'information_panel',version:1,title,text:body,severity:/importante|atenci[oó]n|riesgo/i.test(title)?'warning':'info'});continue;}
      const header=tableCells(line),separator=tableCells(lines[index+1]||'');if(header&&separator&&header.length===separator.length&&isTableSeparator(separator)){flush();const rows=[];index+=2;while(index<lines.length){const row=tableCells(lines[index]);if(!row||row.length!==header.length)break;rows.push(row);index+=1;}blocks.push({id:makeId(prefix,'t'+(blocks.length+1)),type:'table',version:1,columns:header,rows,summary:'Tabla de respuesta de Yarbi'});continue;}
      const check=/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/.exec(line),list=/^\s*(?:([-+*])\s+|(\d+)\.\s+)(.+)$/.exec(line);if(check||list){flush();const ordered=Boolean(list&&list[2]),items=[];while(index<lines.length){const c=/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/.exec(lines[index]),l=/^\s*(?:([-+*])\s+|(\d+)\.\s+)(.+)$/.exec(lines[index]);if(check?!c:(!l||Boolean(l[2])!==ordered||Boolean(c)))break;if(check)items.push({text:c[2],checked:c[1].toLowerCase()==='x'});else items.push(l[3]);index+=1;}blocks.push({id:makeId(prefix,'l'+(blocks.length+1)),type:check?'checklist':ordered?'ordered_list':'unordered_list',version:1,items});continue;}
      paragraph.push(line);index+=1;
    }
    flush();return {schema:SCHEMA,blocks};
  }
  function plainTextContent(value,idPrefix) { return markdownToContent(typeof value==='string'?value:'',idPrefix||'plain'); }
  function normalizedSourceId(source,index) {
    const candidate=source?.source_id||source?.sourceId||source?.assetId||source?.asset_id||source?.sha256||source?.sourceHash;
    const valid=id(String(candidate||''));return valid||makeId('source',String(index+1));
  }
  function contentFromResponse(response,idPrefix) {
    if(typeof response==='string')return markdownToContent(response,idPrefix||'reply');
    if(!response||typeof response!=='object')return markdownToContent('',idPrefix||'reply');
    const candidate=response.presentation||response.content;
    if(candidate&&typeof candidate==='object'&&candidate.schema&&Array.isArray(candidate.blocks))return candidate;
    if(response.schema&&Array.isArray(response.blocks))return response;
    const reply=String(response.reply||response.text||response.answer||'');
    const content=markdownToContent(reply,idPrefix||'reply');
    const sources=Array.isArray(response.citations)?response.citations:Array.isArray(response.evidence)?response.evidence:Array.isArray(response.sources)?response.sources:[];
    sources.slice(0,LIMITS.sourcesPerMessage).forEach((source,index)=>{
      const sourceId=normalizedSourceId(source,index), fileName=String(source?.fileName||source?.file_name||source?.title||source?.label||'Fuente documental').slice(0,240);
      const page=Number.isSafeInteger(Number(source?.page))&&Number(source.page)>0?Number(source.page):Number.isSafeInteger(Number(source?.page_number))&&Number(source.page_number)>0?Number(source.page_number):undefined;
      const sourceText=String(source?.source||'').trim();
      const section=String(source?.section||source?.reference||source?.sectionLabel||(sourceText.length<=180?sourceText:'')).slice(0,240);
      const excerpt=String(source?.excerpt||source?.quote||source?.supportingText||source?.text||(sourceText.length>180?sourceText:'')).trim().slice(0,1600);
      const sourceHash=String(source?.sourceHash||source?.sha256||'').toLowerCase();
      const metadata=/^[a-f0-9]{32,64}$/.test(sourceHash)?{sourceHash,verified:source?.verified===true}:undefined;
      const citation={id:makeId(idPrefix||'reply','source'+(index+1)),type:excerpt&&!reply.toLocaleLowerCase().includes(excerpt.slice(0,Math.min(80,excerpt.length)).toLocaleLowerCase())?'document_excerpt':'source_citation',version:1,source_id:sourceId,label:fileName,file_name:fileName,...(section?{section}:{}),...(page?{page}:{}),...(excerpt?{excerpt}:{}),...(metadata?{metadata}:{})};
      content.blocks.push(citation);
    });
    return content;
  }
  function validateContent(input) {
    if(typeof input==='string'){if(isBlank(input))return emptyResult();if(characterCount(input)>LIMITS.messageChars)return truncationResult();}
    const content=typeof input==='string'?plainTextContent(input):input&&typeof input==='object'&&(!input.schema||!Array.isArray(input.blocks))?contentFromResponse(input):input;
    if(!exactKeys(content,ROOT_KEYS)||![SCHEMA,LEGACY_SCHEMA].includes(content.schema)||!Array.isArray(content.blocks)||content.blocks.length>LIMITS.blocksPerMessage)return {ok:false,blocks:[fallbackBlock('La respuesta no cumple el formato visual esperado.',0)],issues:[issue('content_schema_invalid')],characterCount:0,status:'partial',truncated:false,empty:false};
    if(!content.blocks.length)return emptyResult();
    const issues=[],blocks=[];let total=0;
    for(let index=0;index<content.blocks.length;index+=1){const safe=validateBlock(content.blocks[index]);if(!safe){issues.push(issue('block_invalid_or_unknown',index));blocks.push(fallbackBlock('Esta parte llegó incompleta y se muestra como contenido seguro.',index));continue;}const size=visibleCharacters(safe);if(total+size>LIMITS.messageChars)return truncationResult();total+=size;blocks.push(safe);}
    return {ok:issues.length===0,blocks,issues,characterCount:total,status:issues.length?'partial':'complete',truncated:false,empty:false};
  }

  function element(tag,className,value) { const node=document.createElement(tag);if(className)node.className=className;if(value!==undefined)node.textContent=value;return node; }
  function renderRuns(parent,runs) {
    for(const run of runs||[]){let node=document.createTextNode(run.text);for(const mark of run.marks||[]){const tag=mark==='bold'?'strong':mark==='italic'?'em':mark==='highlight'?'mark':'code',wrapper=element(tag,mark==='highlight'?'yarbi-content-highlight':mark==='code'?'yarbi-content-inline-code':'');wrapper.appendChild(node);node=wrapper;}parent.appendChild(node);}
  }
  function renderFields(fields) {
    const list=element('dl','yarbi-content-card-fields');
    (fields||[]).forEach(field=>{const row=element('div','yarbi-content-field');row.dataset.tone=field.tone;row.append(element('dt','',field.label),element('dd','',field.value));if(field.detail)row.appendChild(element('small','',field.detail));list.appendChild(row);});
    return list;
  }
  function renderItems(items,ordered) {
    const list=element(ordered?'ol':'ul','yarbi-content-card-list');
    (items||[]).forEach(item=>{const row=element('li');renderRuns(row,inlineRuns(item.text));if(item.detail)row.appendChild(element('small','yarbi-content-item-detail',item.detail));list.appendChild(row);});
    return list;
  }
  function renderBlock(block) {
    if(block.type==='paragraph'){const node=element('p','yarbi-content-paragraph');renderRuns(node,block.runs);return node;}
    if(block.type==='heading')return element('h'+block.level,'yarbi-content-heading yarbi-content-heading-'+block.level,block.text);
    if(['ordered_list','unordered_list','checklist'].includes(block.type)){const list=element(block.type==='ordered_list'?'ol':'ul','yarbi-content-list'+(block.type==='checklist'?' yarbi-content-checklist':''));block.items.forEach(item=>{const li=element('li');renderRuns(li,inlineRuns(item.text));if(block.type==='checklist')li.setAttribute('data-checked',item.checked?'true':'false');list.appendChild(li);});return list;}
    if(block.type==='table'){const wrap=element('div','yarbi-content-table-wrap'),table=element('table','yarbi-content-table');table.setAttribute('aria-label',block.summary);const thead=document.createElement('thead'),header=document.createElement('tr');block.columns.forEach(column=>header.appendChild(element('th','',column)));thead.appendChild(header);const tbody=document.createElement('tbody');block.rows.forEach(row=>{const tr=document.createElement('tr');row.forEach(cell=>tr.appendChild(element('td','',cell)));tbody.appendChild(tr);});table.append(thead,tbody);wrap.appendChild(table);return wrap;}
    if(['information_panel','warning_panel','success_panel'].includes(block.type)){const aside=element('aside','yarbi-content-panel yarbi-content-panel-'+(block.type==='warning_panel'?'warning':block.severity));aside.setAttribute('role',block.type==='warning_panel'?'alert':'note');aside.append(element('strong','yarbi-content-panel-title',block.title),element('p','',block.text));return aside;}
    if(block.type==='status_chip'){const chip=element('span','yarbi-content-chip yarbi-content-chip-'+block.severity,block.text);return chip;}
    if(block.type==='source_citation'||block.type==='source_reference'){const card=element('aside','yarbi-content-source-card');card.dataset.sourceId=block.source_id;card.append(element('strong','yarbi-content-source-title',block.file_name||block.label));const meta=[block.section,block.page?'pág. '+block.page:''].filter(Boolean).join(' · ');if(meta)card.appendChild(element('span','yarbi-content-source-meta',meta));if(block.type==='source_citation')card.appendChild(element('span','yarbi-content-source-label',block.label));return card;}
    if(block.type==='document_excerpt'){const figure=element('figure','yarbi-content-document-excerpt');figure.dataset.sourceId=block.source_id;const quote=element('blockquote','',block.excerpt||block.label);figure.appendChild(quote);const caption=[block.file_name||block.label,block.section,block.page?'pág. '+block.page:''].filter(Boolean).join(' · ');figure.appendChild(element('figcaption','',caption));if(block.quotation==='interpretation')figure.dataset.quotation='interpretation';return figure;}
    if(block.type==='quote'){const figure=element('figure','yarbi-content-quote');figure.appendChild(element('blockquote','',block.text));const caption=[block.attribution,block.page?'pág. '+block.page:''].filter(Boolean).join(' · ');if(caption)figure.appendChild(element('figcaption','',caption));return figure;}
    if(block.type==='image_reference'){const figure=element('figure','yarbi-content-image-reference');figure.dataset.sourceId=block.source_id;figure.append(element('div','yarbi-content-image-placeholder','▧'),element('figcaption','',block.label||block.alt));if(block.file_name||block.page)figure.appendChild(element('small','', [block.file_name,block.page?'pág. '+block.page:''].filter(Boolean).join(' · ')));return figure;}
    if(block.type==='metric_card'){const card=element('section','yarbi-content-card yarbi-content-metric-card');card.dataset.tone=block.tone;card.append(element('span','yarbi-content-card-kicker',block.title),element('strong','yarbi-content-metric-value',block.value+(block.unit?' '+block.unit:'')));if(block.detail)card.appendChild(element('p','',block.detail));if(block.trend)card.appendChild(element('small','',block.trend));return card;}
    if(['summary_card','client_card','appointment_card','finance_card'].includes(block.type)){const card=element('section','yarbi-content-card yarbi-content-'+block.type.replace('_','-'));card.dataset.tone=block.tone;card.appendChild(element('h3','yarbi-content-card-title',block.title));if(block.summary)card.appendChild(element('p','yarbi-content-card-summary',block.summary));if(block.text)card.appendChild(element('p','yarbi-content-card-summary',block.text));if(block.fields)card.appendChild(renderFields(block.fields));return card;}
    if(block.type==='recommendation_block'||block.type==='example_block'||block.type==='next_steps_block'){const card=element('section','yarbi-content-card yarbi-content-'+block.type.replace('_','-'));card.dataset.tone=block.tone;card.appendChild(element('h3','yarbi-content-card-title',block.title));if(block.summary)card.appendChild(element('p','yarbi-content-card-summary',block.summary));if(block.text)card.appendChild(element('p','yarbi-content-card-summary',block.text));if(block.items)card.appendChild(renderItems(block.items,block.type==='next_steps_block'));return card;}
    return element('p','yarbi-content-fallback','No se pudo presentar esta parte de la respuesta.');
  }
  function injectStyles() {
    if(typeof document==='undefined'||document.getElementById('yarbi-conversation-renderer-styles'))return;
    const style=document.createElement('style');style.id='yarbi-conversation-renderer-styles';
    style.textContent = `
      .yarbi-conversation-content{display:grid;gap:8px;min-width:0}
      .yarbi-conversation-content>.yarbi-content-heading{margin:10px 0 2px;color:#263C32;line-height:1.24;letter-spacing:-.02em}
      .yarbi-conversation-content>.yarbi-content-heading:first-child{margin-top:1px}
      .yarbi-content-card,.yarbi-content-source-card,.yarbi-content-document-excerpt,.yarbi-content-quote,.yarbi-content-panel{box-sizing:border-box;max-width:100%;margin:3px 0;padding:13px 14px;border:1px solid #E3EAE5;border-radius:16px;background:#FBFDFC;box-shadow:0 2px 10px rgba(35,55,45,.035)}
      .yarbi-content-card[data-tone="success"]{border-color:#D5E9DD;background:#F6FBF7}
      .yarbi-content-card[data-tone="warning"],.yarbi-content-card[data-tone="risk"]{border-color:#F0E1BE;background:#FFFCF5}
      .yarbi-content-card[data-tone="info"]{border-color:#DCE8F0;background:#F8FBFD}
      .yarbi-content-card-title{margin:0 0 5px;color:#263C32;font-size:15px;font-weight:800;line-height:1.35}
      .yarbi-content-card-summary{margin:3px 0 8px;color:#53615A;font-size:13px;line-height:1.5;overflow-wrap:anywhere}
      .yarbi-content-card-fields{display:grid;gap:0;margin:8px 0 0}
      .yarbi-content-field{display:grid;grid-template-columns:minmax(80px,.7fr) minmax(0,1.3fr);gap:4px 10px;padding:8px 0;border-top:1px solid #EAF0EC}
      .yarbi-content-field dt{color:#748078;font-size:11px;font-weight:700}
      .yarbi-content-field dd{margin:0;color:#27372F;font-size:13px;font-weight:700;text-align:right;overflow-wrap:anywhere}
      .yarbi-content-field[data-tone="warning"] dd,.yarbi-content-field[data-tone="risk"] dd{color:#986511}
      .yarbi-content-field[data-tone="success"] dd{color:#28734F}
      .yarbi-content-field small{grid-column:1/-1;color:#7B8780;font-size:11px;line-height:1.4}
      .yarbi-content-metric-card{display:grid;grid-template-columns:1fr auto;align-items:center;gap:2px 12px;background:linear-gradient(130deg,#F5FAF6,#FCFDFC)}
      .yarbi-content-card-kicker{color:#708078;font-size:11px;font-weight:750}
      .yarbi-content-metric-value{grid-column:2;grid-row:1/3;color:#23704F;font-size:21px;font-weight:850;letter-spacing:-.03em;text-align:right}
      .yarbi-content-metric-card p,.yarbi-content-metric-card small{grid-column:1/-1;margin:5px 0 0;color:#68766E;font-size:11px;line-height:1.45}
      .yarbi-content-panel{padding:11px 13px;border-color:#DCE8E0;border-left:3px solid #79A68D;background:#F7FAF8;box-shadow:none}
      .yarbi-content-panel-warning{border-color:#F0DCAA;border-left-color:#C58A22;background:#FFF9EA}
      .yarbi-content-panel-success{border-color:#D5E9DD;border-left-color:#4E9B71;background:#F4FAF6}
      .yarbi-content-panel-title{display:block;color:#35483D;font-size:12px;font-weight:800}
      .yarbi-content-panel p{margin:4px 0 0;color:#59665F;font-size:13px;line-height:1.5;overflow-wrap:anywhere}
      .yarbi-content-source-card{display:grid;gap:4px;background:#F8FAF9}
      .yarbi-content-source-title{color:#334B3D;font-size:12px;font-weight:800;overflow-wrap:anywhere}
      .yarbi-content-source-meta,.yarbi-content-source-label{color:#748078;font-size:11px;line-height:1.4}
      .yarbi-content-document-excerpt,.yarbi-content-quote{border-left:3px solid #8CA998;background:#F8FAF9}
      .yarbi-content-document-excerpt blockquote,.yarbi-content-quote blockquote{margin:0;color:#35433B;font-size:13px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}
      .yarbi-content-document-excerpt figcaption,.yarbi-content-quote figcaption{margin-top:8px;color:#748078;font-size:10px;line-height:1.4}
      .yarbi-content-image-reference{display:grid;justify-items:start;gap:6px;margin:8px 0;color:#68766E;font-size:11px}
      .yarbi-content-image-placeholder{display:grid;place-items:center;width:100%;min-height:90px;border:1px dashed #CCD8D0;border-radius:13px;background:#F7FAF8;color:#8A9A90;font-size:24px}
      .yarbi-content-chip{display:inline-flex;align-items:center;min-height:26px;padding:3px 9px;border:1px solid #DAE8DF;border-radius:999px;background:#F2F8F4;color:#41634F;font-size:11px;font-weight:750}
      .yarbi-conversation-content>[data-priority="important"]{border-color:#C8DDD0;box-shadow:0 3px 12px rgba(40,80,58,.08)}
      @media(max-width:430px){.yarbi-content-card,.yarbi-content-source-card,.yarbi-content-document-excerpt,.yarbi-content-quote,.yarbi-content-panel{padding:11px 12px;border-radius:14px}.yarbi-content-field{grid-template-columns:minmax(72px,.72fr) minmax(0,1.28fr);gap:4px 8px}.yarbi-content-metric-value{font-size:19px}}
    `;
    document.head.appendChild(style);
  }
  function renderMessage(message) {
    const input=message&&Object.prototype.hasOwnProperty.call(message,'content')?message.content:message?.presentation||message?.text;
    const validation=validateContent(input);if(validation.empty)return {element:null,validation};injectStyles();
    const role=message?.role==='user'?'user':'assistant',article=element('article','yarbi-conversation-message');article.dataset.role=role;article.dataset.status=message?.status==='partial'||validation.status==='partial'?'partial':'complete';if(validation.truncated)article.dataset.truncated='true';article.setAttribute('aria-live',role==='assistant'?'polite':'off');
    article.appendChild(element('div','yarbi-conversation-label',role==='user'?'Tú':'Yarbi'));const body=element('div','yarbi-conversation-content');validation.blocks.forEach(block=>{const node=renderBlock(block);if(block.priority)node.dataset.priority=block.priority;body.appendChild(node);});article.appendChild(body);return {element:article,validation};
  }
  function isNearBottom(container) { return Number(container.scrollHeight||0)-Number(container.scrollTop||0)-Number(container.clientHeight||0)<=LIMITS.scrollFollowThreshold; }
  function appendMessage(container,message) {
    if(!container||typeof container.appendChild!=='function')return {ok:false,code:'renderer_container_missing'};
    const follow=isNearBottom(container),rendered=renderMessage(message);if(!rendered.element)return {ok:false,code:'content_empty',...rendered};container.appendChild(rendered.element);
    if(follow){container.scrollTop=container.scrollHeight;delete container.dataset.yarbiNewMessages;}else container.dataset.yarbiNewMessages='true';return {ok:true,...rendered,followed:follow};
  }
  return Object.freeze({SCHEMA,LEGACY_SCHEMA,LIMITS,plainTextContent,markdownToContent,contentFromResponse,validateContent,renderMessage,appendMessage,isNearBottom,characterCount});
}));
