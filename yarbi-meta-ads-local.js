/* Local-only Meta Ads metrics. No Meta API, network client, or campaign write. */
(function(root, factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root){root.YarbiMetaAdsLocal=api;root.gfcYarbiMetaAdsHtml=api.html;root.gfcYarbiMetaAdsAttach=api.attach;root.gfcYarbiMetaAdsImport=api.importFromUi;root.gfcYarbiMetaAdsSetStatus=api.setStatusUi;root.gfcYarbiMetaAdsDelete=api.removeUi;root.gfcTryMetaAdsMessage=api.answer;}
}(typeof window==='undefined'?null:window,function(){
  'use strict';
  const DB='yarbi_meta_ads_local_v1',STORE='imports',MAX=24;let dbPromise=null;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clean=v=>String(v??'').replace(/\u0000/g,'').trim();
  const norm=v=>clean(v).toLocaleLowerCase('es-PE').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
  const money=v=>'S/ '+Number(v||0).toLocaleString('es-PE',{minimumFractionDigits:2,maximumFractionDigits:2});
  const num=v=>{const n=Number(clean(v).replace(/S\/|PEN|\s/g,'').replace(/\.(?=\d{3}(?:\D|$))/g,'').replace(',','.'));return Number.isFinite(n)&&n>=0?n:0;};
  function parseRecords(text){
    const source=clean(text);if(source.length>2_000_000)throw new Error('csv_too_large');
    let delimiter=',',quoted=false,commas=0,semicolons=0;
    for(let i=0;i<source.length;i++){const ch=source[i];if(ch==='"'){if(quoted&&source[i+1]==='"'){i++;continue;}quoted=!quoted;continue;}if(!quoted&&(ch==='\n'||ch==='\r'))break;if(!quoted&&ch===',')commas++;if(!quoted&&ch===';')semicolons++;}
    if(semicolons>commas)delimiter=';';
    const records=[];let record=[],field='',inside=false,started=false;
    for(let i=0;i<source.length;i++){
      const ch=source[i];
      if(inside){if(ch==='"'&&source[i+1]==='"'){field+='"';i++;}else if(ch==='"')inside=false;else field+=ch;continue;}
      if(ch==='"'&&!started){inside=true;started=true;continue;}
      if(ch===delimiter){record.push(field);field='';started=false;continue;}
      if(ch==='\n'||ch==='\r'){if(ch==='\r'&&source[i+1]==='\n')i++;record.push(field);if(record.some(value=>clean(value)))records.push(record);record=[];field='';started=false;continue;}
      field+=ch;started=true;
    }
    if(inside)throw new Error('csv_unclosed_quote');
    record.push(field);if(record.some(value=>clean(value)))records.push(record);
    return records;
  }
  function parseMetric(value){
    const raw=clean(value).replace(/(?:S\/|PEN|\s)/gi,'');if(!raw)return 0;
    if(!/^[+-]?(?:\d+|\d{1,3}(?:[.,]\d{3})+)(?:[.,]\d+)?$/.test(raw))return null;
    const comma=raw.lastIndexOf(','),dot=raw.lastIndexOf('.');let normalized=raw;
    if(comma>=0&&dot>=0){normalized=raw.replace(/[.,]/g,'');normalized=normalized.slice(0,-(raw.length-Math.max(comma,dot)-1))+'.'+raw.slice(Math.max(comma,dot)+1);}
    else if(comma>=0||dot>=0){const sep=comma>=0?',':'.',parts=raw.split(sep);if(parts.length>2)normalized=parts.join('');else if(parts[1]?.length===3)normalized=parts.join('');else normalized=parts[0]+'.'+(parts[1]||'');}
    const parsed=Number(normalized);return Number.isFinite(parsed)&&parsed>=0?parsed:null;
  }
  function parseCsv(text){
    const records=parseRecords(text);if(records.length<2)return[];
    const header=records[0].map(clean),field=(raw,names)=>raw[Object.keys(raw).find(k=>names.includes(norm(k)))]||'';
    return records.slice(1).map(cells=>{if(cells.length!==header.length)return null;const raw={};cells.forEach((v,i)=>raw[header[i]]=v);const campaign=field(raw,['campaign','campaign name','campana','nombre de campana']);if(!campaign)return null;const spend=parseMetric(field(raw,['spend','amount spent','importe gastado','gasto','inversion'])),impressions=parseMetric(field(raw,['impressions','impresiones'])),clicks=parseMetric(field(raw,['clicks','clics'])),leads=parseMetric(field(raw,['leads','clientes potenciales','prospectos'])),reportedRevenue=parseMetric(field(raw,['reported revenue','revenue reported','ingreso reportado','confirmed revenue','revenue confirmed','ingreso confirmado','venta confirmada','revenue']));if([spend,impressions,clicks,leads,reportedRevenue].some(value=>value===null))return null;return{campaign:campaign.slice(0,140),date:field(raw,['date','fecha']).slice(0,32),spend,impressions,clicks,leads,reportedRevenue};}).filter(Boolean).slice(0,2000);
  }
  function summarize(rows){
    const totals=(Array.isArray(rows)?rows:[]).reduce((all,row)=>({spend:all.spend+num(row.spend),impressions:all.impressions+num(row.impressions),clicks:all.clicks+num(row.clicks),leads:all.leads+num(row.leads),reportedRevenue:all.reportedRevenue+num(row.reportedRevenue??row.confirmedRevenue)}),{spend:0,impressions:0,clicks:0,leads:0,reportedRevenue:0});
    return {...totals,rowCount:Array.isArray(rows)?rows.length:0,roas:null,reportedRoas:totals.spend>0&&totals.reportedRevenue>0?totals.reportedRevenue/totals.spend:null,reportedRoiPercent:totals.spend>0&&totals.reportedRevenue>0?((totals.reportedRevenue-totals.spend)/totals.spend)*100:null,cpl:totals.leads>0?totals.spend/totals.leads:null};
  }
  const requested=value=>/\b(?:meta ads|campan(?:a|as)|roas|roi|publicidad|anuncios?)\b/i.test(String(value||''));
  function answerFromSummary(s){if(!s?.rowCount)return'## 📣 Meta Ads local\n\nNo hay métricas aprobadas para analizar. Importa un CSV local y revísalo antes de aprobarlo; Yarbi no consultará Meta ni inventará ROAS.';const reported=s.reportedRoas===null?'No hay ingresos reportados suficientes para calcular una razón.':'Ingresos reportados por el archivo: **'+money(s.reportedRevenue)+'** · ROAS reportado: **'+s.reportedRoas.toFixed(2)+'x** · ROI reportado: **'+s.reportedRoiPercent.toFixed(1)+' %**.';return'## 📣 Meta Ads local\n\n- Inversión del reporte: **'+money(s.spend)+'**.\n- Leads reportados: **'+s.leads+'**'+(s.cpl===null?'.':' · CPL reportado: **'+money(s.cpl)+'**.')+'\n- '+reported+'\n- **ROAS atribuido a cobros CRM/Finanzas:** no disponible; falta conciliar campañas con conversiones y cobros verificables.\n\n_Lectura local aprobada. Las cifras de ingresos proceden del archivo importado; no se confirman contra CRM/Finanzas y no modifican campañas ni presupuesto._';}
  function open(){if(dbPromise)return dbPromise;if(!root?.indexedDB)return Promise.reject(new Error('storage_unavailable'));dbPromise=new Promise((ok,no)=>{const r=root.indexedDB.open(DB,1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE,{keyPath:'id'});};r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error||new Error('storage_unavailable'));});return dbPromise;}
  function tx(mode,work){return open().then(db=>new Promise((ok,no)=>{const transaction=db.transaction(STORE,mode),store=transaction.objectStore(STORE);let value;Promise.resolve(work(store)).then(v=>value=v).catch(error=>{try{transaction.abort();}catch(_){}no(error);});transaction.oncomplete=()=>ok(value);transaction.onerror=()=>no(transaction.error||new Error('storage_failed'));}));}
  const get=r=>new Promise((ok,no)=>{r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error||new Error('storage_failed'));});
  const list=async()=>(await tx('readonly',store=>get(store.getAll()))).sort((a,b)=>Number(b.updatedAt||0)-Number(a.updatedAt||0));
  async function importCsv(title,text){const rows=parseCsv(text);if(!rows.length)throw new Error('csv_no_rows');if((await list()).length>=MAX)throw new Error('import_limit');const item={id:'meta_'+Date.now().toString(36),title:clean(title).slice(0,140)||'Importación Meta Ads',status:'draft',rows,updatedAt:Date.now()};await tx('readwrite',store=>store.put(item));return item;}
  async function setStatus(id,status){return tx('readwrite',async store=>{const item=await get(store.get(String(id)));if(!item)throw new Error('not_found');item.status=status==='approved'?'approved':'draft';item.updatedAt=Date.now();store.put(item);return item;});}
  const remove=id=>tx('readwrite',store=>{store.delete(String(id));return true;});
  async function answer(value){if(!requested(value))return null;try{return{handled:true,reply:answerFromSummary(summarize((await list()).filter(item=>item.status==='approved').flatMap(item=>item.rows||[])))}}catch(_){return{handled:true,reply:'## 📣 Meta Ads local\n\nNo puedo abrir las métricas locales ahora. No consulté Meta ni otro servicio externo.'};}}
  function html(){return'<main class="gfc-yarbi-tool-page"><div class="gfc-yarbi-tool-card"><div class="gfc-yarbi-tool-title">Meta Ads local</div><div class="gfc-yarbi-tool-copy">Importa un CSV de métricas para revisarlo localmente. Esta pantalla no conecta Meta ni modifica campañas. Las ventas del archivo son cifras reportadas; la atribución real requiere conciliarlas con CRM y Finanzas.</div><div class="gfc-knowledge-import"><input id="gfc-meta-title" maxlength="140" placeholder="Nombre del reporte (opcional)"><textarea id="gfc-meta-csv" rows="7" placeholder="campaign,date,spend,impressions,clicks,leads,reported_revenue"></textarea><button class="gfc-yarbi-primary" onclick="gfcYarbiMetaAdsImport()">Guardar CSV como borrador</button><small id="gfc-meta-status">Solo importaciones aprobadas responden en el chat.</small></div><div id="gfc-meta-list"><p>Cargando importaciones locales…</p></div></div></main>';}
  function card(item){const s=summarize(item.rows);return'<article class="gfc-knowledge-source"><div><b>'+esc(item.title)+'</b><small>'+(item.status==='approved'?'✓ Aprobada':'Borrador: requiere aprobación')+' · '+s.rowCount+' filas</small></div><p>Inversión reportada: '+esc(money(s.spend))+' · Leads: '+s.leads+' · Ingreso reportado: '+esc(money(s.reportedRevenue))+'</p><small>ROAS atribuido CRM/Finanzas: no disponible hasta conciliar ventas.</small><div class="gfc-knowledge-actions">'+(item.status==='approved'?'<button onclick="gfcYarbiMetaAdsSetStatus(\''+esc(item.id)+'\',\'draft\')">Quitar aprobación</button>':'<button class="primary" onclick="gfcYarbiMetaAdsSetStatus(\''+esc(item.id)+'\',\'approved\')">Aprobar métricas</button>')+'<button class="danger" onclick="gfcYarbiMetaAdsDelete(\''+esc(item.id)+'\')">Eliminar copia local</button></div></article>';}
  function status(text,error){const node=root?.document?.getElementById('gfc-meta-status');if(node){node.textContent=text;node.style.color=error?'#B91C1C':'#166534';}}
  async function render(){const target=root?.document?.getElementById('gfc-meta-list');if(!target)return;try{const rows=await list();target.innerHTML=rows.length?rows.map(card).join(''):'<p>Aún no hay importaciones de Meta Ads locales.</p>';}catch(_){target.innerHTML='<p>El almacenamiento local no está disponible.</p>';}}
  async function importFromUi(){try{await importCsv(root.document.getElementById('gfc-meta-title')?.value||'',root.document.getElementById('gfc-meta-csv')?.value||'');root.document.getElementById('gfc-meta-csv').value='';status('Importación guardada como borrador local.');await render();}catch(_){status('El CSV no tiene campañas válidas.',true);}}
  async function setStatusUi(id,next){try{await setStatus(id,next);status(next==='approved'?'Métricas aprobadas para lectura local.':'Importación devuelta a borrador.');await render();}catch(_){status('No pude actualizar la importación.',true);}}
  async function removeUi(id){if(!root.confirm('Se eliminará solo la copia local. ¿Continuar?'))return;try{await remove(id);status('Copia local eliminada.');await render();}catch(_){status('No pude eliminar la copia.',true);}}
  return Object.freeze({parseCsv,summarize,requested,answerFromSummary,html,attach:render,importCsv,setStatus,remove,answer,importFromUi,setStatusUi,removeUi});
}));
