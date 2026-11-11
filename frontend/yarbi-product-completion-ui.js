/* Yarbi Product Completion UI. Sin secretos, sin proveedores y sin efectos comerciales. */
(function () {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-PE').replace(/[^a-z0-9ñ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const tokens = value => [...new Set(norm(value).split(' ').filter(Boolean))];
  const synonyms = { instalacion:['instalacion','instalar','nueva'], reparacion:['reparacion','reparar','arreglo'], punto:['punto','adicional','extension'], visita:['visita','agenda','coordinar'] };

  function currentOwner() { return String(window.gfcYarbiOwnerId || window.gfcOwnerAccountId || '').trim(); }
  function safeCode(value) { return String(value || '').trim().replace(/[^a-z0-9_.:-]/gi, '').slice(0, 96); }
  // La Bandeja puede cargarse antes que el script principal en algunos WebViews.
  // Conserva el contrato de la función global, pero recupera la sesión aislada
  // directamente como respaldo seguro para no confundir una sesión válida con
  // una sesión ausente. El token nunca se renderiza ni se registra.
  function accountToken() {
    const fromGlobal = typeof window.gfcAccountAccessToken === 'function' ? window.gfcAccountAccessToken() : '';
    if (fromGlobal) return fromGlobal;
    try {
      return window.localStorage.getItem('gfc_supabase_access_token_v1')
        || window.sessionStorage.getItem('gfc_supabase_access_token_v1')
        || '';
    } catch (_) {
      return '';
    }
  }
  async function freshAccountToken(force) {
    if (typeof window.gfcAccountFreshAccessToken === 'function') {
      return String(await window.gfcAccountFreshAccessToken({ force: force === true }) || '');
    }
    return accountToken();
  }
  async function authenticatedRequest(url, init) {
    let token = await freshAccountToken(false);
    if (!token) return null;
    const request = bearer => ({ ...(init || {}), headers:{ ...((init && init.headers) || {}), Authorization:'Bearer '+bearer } });
    let response = await fetch(url, request(token));
    if (response.status === 401 && typeof window.gfcAccountFreshAccessToken === 'function') {
      token = await freshAccountToken(true);
      if (token) response = await fetch(url, request(token));
    }
    return response;
  }
  function apiOrigin() { return typeof window.gfcRuntimeApiOrigin === 'function' ? window.gfcRuntimeApiOrigin() : window.location.origin; }
  function localContacts() {
    const state = window.state || {};
    const options = [window.gfcYarbiLocalContacts, state.crmContacts, state.clientes, state.clients, window.gfcCrmContacts];
    return options.find(Array.isArray) || [];
  }
  function termsFor(query) {
    const selected = new Set(tokens(query));
    Object.values(synonyms).forEach(group => { if (group.some(word => selected.has(word))) group.forEach(word => selected.add(word)); });
    return [...selected];
  }
  function contactText(row) {
    return norm([
      row.display_name, row.full_name, row.name, row.phone, ...(Array.isArray(row.phones) ? row.phones : []),
      row.address, row.location, row.district, row.service, row.latest_service, row.installation_type,
      row.commercial_status, row.operational_status, row.pending_step, row.conversation_summary,
      ...(Array.isArray(row.history) ? row.history.map(item => item?.text || item?.summary || item) : [])
    ].filter(Boolean).join(' '));
  }
  function search(query) {
    const owner = currentOwner();
    if (!owner) return { reason:'owner_scope_missing', rows:[] };
    const terms = termsFor(query);
    const deduped = new Map();
    localContacts().forEach(raw => {
      const id = Number(raw?.contact_id || raw?.id);
      if (!Number.isSafeInteger(id) || id <= 0 || String(raw?.owner_id || '') !== owner || deduped.has(id)) return;
      const haystack = contactText(raw);
      const hits = terms.filter(term => haystack.includes(term));
      if (terms.length && !hits.length) return;
      const name = norm(raw.display_name || raw.full_name || raw.name);
      const phone = norm(raw.phone || (Array.isArray(raw.phones) ? raw.phones.join(' ') : ''));
      const score = hits.reduce((sum, term) => sum + (phone.includes(term) ? 120 : name.includes(term) ? 100 : 35), 0);
      deduped.set(id, { id, name:raw.display_name || raw.full_name || raw.name || 'Sin nombre', district:raw.district || raw.location || '', service:raw.latest_service || raw.service || '', status:raw.commercial_status || 'frío', score, hits });
    });
    return { reason:'ok', rows:[...deduped.values()].sort((a,b) => b.score-a.score || a.id-b.id).slice(0,12) };
  }
  async function searchCrm(query, options) {
    const source=options&&typeof options==='object'?options:{};
    try {
      const response=await authenticatedRequest(new URL('/api/assistant/crm-search',apiOrigin()).toString(),{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({query:String(query||'').slice(0,240),filters:source.filters||{},page:source.page||1,limit:12})
      });
      if(!response) return { reason:'session_required', rows:[] };
      const payload=await response.json().catch(()=>({}));
      if(!response.ok||payload.ok!==true) return { reason:payload.error==='owner_reference_unauthorized'?'session_required':'crm_unavailable',code:safeCode(payload.error),rows:[] };
      return { reason:'ok',rows:(Array.isArray(payload.results)?payload.results:[]).map(row=>({id:row.contact_id,name:row.display_name||'Sin nombre',district:row.district||'',service:row.latest_service||'',status:row.commercial_status||'frío',hits:Array.isArray(row.matched_fields)?row.matched_fields:[]})),pagination:payload.pagination||null };
    } catch (_) { return { reason:'crm_unavailable',code:'crm_request_failed',rows:[] }; }
  }
  async function loadDossier(contactId) {
    try {
      const response=await authenticatedRequest(new URL('/api/assistant/crm-dossier',apiOrigin()).toString(),{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contact_id:Number(contactId)})
      });
      if(!response) return {reason:'session_required'};
      const payload=await response.json().catch(()=>({}));
      if(!response.ok||payload.ok!==true) return {reason:payload.error==='owner_reference_unauthorized'?'session_required':'crm_unavailable'};
      if(payload.outcome!=='dossier_found'||!payload.dossier) return {reason:payload.outcome||'crm_unavailable'};
      return {reason:'ok',dossier:payload.dossier,activities:payload.activities||null,finance:payload.finance||null,timeline:Array.isArray(payload.timeline)?payload.timeline:[],conversationToken:typeof payload.conversation_token==='string'?payload.conversation_token:''};
    } catch (_) { return {reason:'crm_unavailable'}; }
  }
  function style() {
    if (document.getElementById('yarbi-product-completion-style')) return;
    const node = document.createElement('style'); node.id='yarbi-product-completion-style';
    node.textContent = '.gfc-pc-launch{position:fixed;right:14px;bottom:84px;z-index:10002;border:1px solid #BFD9CE;border-radius:999px;background:#F0FAF5;color:#15684A;padding:9px 12px;font:800 12px Inter,Arial;box-shadow:0 5px 18px rgba(0,0,0,.12)}.gfc-pc-shade{position:fixed;inset:0;z-index:10030;background:rgba(15,23,42,.36);display:flex;align-items:flex-end}.gfc-pc-panel{width:100%;max-width:520px;max-height:88vh;overflow:auto;background:#fff;border-radius:20px 20px 0 0;margin:auto;padding:17px;font:14px Inter,Arial;color:#172033}.gfc-pc-panel h2{margin:0 0 4px;font-size:18px}.gfc-pc-panel p{color:#64748B;line-height:1.4}.gfc-pc-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:13px 0}.gfc-pc-grid button,.gfc-pc-search button,.gfc-pc-dossier-back{padding:10px;border:1px solid #D8E2E9;border-radius:10px;background:#F8FBFC;color:#172033;font-weight:800}.gfc-pc-search{display:flex;gap:7px;margin:10px 0}.gfc-pc-search input{min-width:0;flex:1;padding:10px;border:1px solid #BFCFDB;border-radius:10px}.gfc-pc-result{padding:9px 0;border-top:1px solid #EEF1F3}.gfc-pc-result small{color:#667085}.gfc-pc-close{float:right;border:0;background:none;font-size:18px;cursor:pointer}.gfc-pc-timeline{border-left:2px solid #D8E2E9;margin:13px 0 0 5px;padding-left:11px}.gfc-pc-event{padding:0 0 11px}.gfc-pc-event small{display:block;color:#667085;margin-top:2px}.gfc-pc-facts{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin:12px 0}.gfc-pc-fact{padding:8px;border-radius:9px;background:#F8FBFC;color:#344054}.gfc-pc-fact b{display:block;color:#172033;font-size:11px;margin-bottom:2px}';
    document.head.appendChild(node);
  }
  function renderResults(root, result) {
    const target = root.querySelector('[data-results]');
    if (result.reason === 'session_required') {
      target.innerHTML='<p>Inicia sesión con el propietario autorizado para consultar el CRM.</p><button data-open-account style="padding:8px 10px;border:1px solid #BFD9CE;border-radius:9px;background:#F0FAF5;color:#15684A;font-weight:800">Activar cuenta de Preview</button>';
      target.querySelector('[data-open-account]').onclick=()=>{ root.remove(); if(typeof window.gfcOpenYarbiAccount==='function') window.gfcOpenYarbiAccount(); };
      return;
    }
    if (result.reason === 'crm_unavailable') { target.innerHTML='<p>La consulta CRM no está disponible ahora. No se usó ningún fallback hacia otro entorno.</p><small style="display:block;color:#667085;margin-top:6px">Diagnóstico seguro: '+esc(result.code || 'crm_unavailable')+'</small>'; return; }
    target.innerHTML = result.rows.length ? result.rows.map(row => '<article class="gfc-pc-result"><b>'+esc(row.name)+'</b><br><small>'+esc([row.district,row.service,row.status].filter(Boolean).join(' · '))+' · coincidencias: '+esc(row.hits.join(', '))+'</small><br><button data-contact="'+esc(row.id)+'" style="margin-top:7px;padding:5px 7px;border:1px solid #D8E2E9;border-radius:7px;background:#fff;font-weight:800">Ver expediente</button></article>').join('') : '<p>No hay coincidencias en tu alcance CRM autorizado.</p>';
    target.querySelectorAll('[data-contact]').forEach(button=>button.onclick=()=>window.gfcOpenYarbiCrmDossier(button.dataset.contact));
  }
  function dossierMarkup(result) {
    const dossier=result.dossier||{};
    const facts=[['Teléfono',dossier.phone],['Servicio',dossier.service],['Estado comercial',dossier.commercial_status],['Último paso',dossier.conversation_brief],['Ubicación',dossier.location||dossier.district],['Pendiente',Array.isArray(dossier.missing)&&dossier.missing.length?dossier.missing.join(', '):'Sin datos obligatorios pendientes']];
    const timeline=(result.timeline||[]).map(event=>'<div class="gfc-pc-event"><b>'+esc(event.label||'Registro')+'</b><small>'+esc(event.at||'Sin fecha')+(event.detail?' · '+esc(event.detail):'')+'</small></div>').join('')||'<p>No hay historial verificable disponible todavía.</p>';
    const activities=result.activities||{}; const activityText=(rows,empty)=>Array.isArray(rows)&&rows.length?rows.slice(0,4).map(row=>'<div class="gfc-pc-event"><b>'+esc(row.service||row.type||'Actividad')+'</b><small>'+esc([row.date,row.time,row.state].filter(Boolean).join(' · '))+'</small></div>').join(''):('<p>'+esc(empty)+'</p>');
    const finance=result.finance&&result.finance.summary?result.finance.summary:null; const soles=value=>value==null?'No disponible':'S/ '+Number(value).toFixed(2); const financeText=finance?'<div class="gfc-pc-facts"><div class="gfc-pc-fact"><b>Última cotización</b>'+esc(soles(finance.latest_quote_amount))+' · '+esc(finance.latest_quote_status||'No disponible')+'</div><div class="gfc-pc-fact"><b>Cobrado</b>'+esc(soles(finance.collected_amount))+'</div><div class="gfc-pc-fact"><b>Por cobrar</b>'+esc(soles(finance.pending_amount))+'</div><div class="gfc-pc-fact"><b>Vencidos</b>'+esc(String(finance.overdue_receivables||0))+'</div></div><p style="font-size:12px">Cotizar no se registra como ingreso. Fuente de cobro: '+esc(finance.income_source||'no disponible')+'.</p>':'<p>No hay información financiera disponible todavía.</p>';
    return '<button class="gfc-pc-dossier-back">← Volver a resultados</button><h2 style="margin-top:14px">'+esc(dossier.client_name||'Expediente')+'</h2><p>Expediente de solo lectura dentro del alcance del propietario autenticado.</p><div class="gfc-pc-facts">'+facts.filter(item=>item[1]).map(item=>'<div class="gfc-pc-fact"><b>'+esc(item[0])+'</b>'+esc(item[1])+'</div>').join('')+'</div><h3 style="font-size:14px;margin:16px 0 4px">Cotizaciones y cobranzas</h3>'+financeText+'<h3 style="font-size:14px;margin:16px 0 4px">Agenda y seguimiento</h3><div class="gfc-pc-facts"><div class="gfc-pc-fact"><b>Próximas</b>'+activityText(activities.upcoming,'Sin próximas actividades.')+'</div><div class="gfc-pc-fact"><b>Pendientes</b>'+activityText(activities.pending,'Sin pendientes.')+'</div></div><h3 style="font-size:14px;margin:16px 0 4px">Historial reciente</h3><div class="gfc-pc-timeline">'+timeline+'</div>';
  }
  function open() {
    style(); document.querySelector('.gfc-pc-shade')?.remove();
    const root=document.createElement('div'); root.className='gfc-pc-shade';
    root.innerHTML='<section class="gfc-pc-panel" role="dialog" aria-label="Funciones de Yarbi"><button class="gfc-pc-close" aria-label="Cerrar">×</button><h2>Funciones de Yarbi</h2><p>Consulta CRM con tu sesión autenticada y accede a herramientas ya disponibles. Esta pantalla no envía mensajes ni ejecuta acciones comerciales.</p><div class="gfc-pc-grid"><button data-open="orders">Instrucciones guardadas</button><button data-open="learning">Entrenar Yarbi</button><button data-open="memory">Memoria operativa</button><button data-open="personal">WhatsApp personal · prueba</button></div><label><b>Buscar clientes</b><span style="display:block;color:#667085;font-size:12px;margin-top:3px">Nombre, teléfono, distrito, servicio, historial o estado.</span></label><div class="gfc-pc-search"><input data-query autocomplete="off" placeholder="Ej. reparación en Comas"><button data-search>Buscar</button></div><div data-results><p>La búsqueda respeta el propietario autenticado y nunca usa un fallback de producción.</p></div></section>';
    document.body.appendChild(root);
    root.querySelector('.gfc-pc-close').onclick=()=>root.remove();
    root.addEventListener('click', event=>{ if(event.target===root) root.remove(); });
    const runSearch=async()=>{const target=root.querySelector('[data-results]');target.innerHTML='<p>Buscando en el CRM autorizado…</p>';renderResults(root,await searchCrm(root.querySelector('[data-query]').value));};
    root.querySelector('[data-search]').onclick=runSearch;
    root.querySelector('[data-query]').addEventListener('keydown', event=>{ if(event.key==='Enter') runSearch(); });
    root.querySelectorAll('[data-open]').forEach(button=>button.onclick=()=>{
      const target=button.dataset.open; root.remove();
      if(target==='orders') return window.gfcOpenCopilotModal?.('ordenes');
      if(target==='learning') return window.gfcOpenCopilotModal?.('learning');
      if(target==='memory') return window.gfcOpenCopilotModal?.('tools');
      alert('WhatsApp personal está preparado solo en pruebas locales: requiere un número dedicado, autorización del propietario y configuración aislada antes de activarse.');
    });
  }
  function install() {
    style(); if(document.querySelector('.gfc-pc-launch')) return;
    const button=document.createElement('button'); button.className='gfc-pc-launch'; button.type='button'; button.textContent='✦ Funciones de Yarbi'; button.onclick=open; document.body.appendChild(button);
  }
  window.gfcOpenYarbiProductCompletionPanel=open;
  window.gfcSearchYarbiLocalClients=search;
  window.gfcSearchYarbiCrm=searchCrm;
  window.gfcOpenYarbiCrmDossier=function(contactId){
    const id=Number(contactId); if(!Number.isSafeInteger(id)||id<=0) return;
    if(typeof window.gfcOpenClientDossier==='function') return window.gfcOpenClientDossier(id);
    if(typeof window.openClientDossier==='function') return window.openClientDossier(id);
    style(); document.querySelector('.gfc-pc-shade')?.remove();
    const root=document.createElement('div'); root.className='gfc-pc-shade'; root.innerHTML='<section class="gfc-pc-panel" role="dialog" aria-label="Expediente CRM"><button class="gfc-pc-close" aria-label="Cerrar">×</button><p>Cargando expediente autorizado…</p></section>'; document.body.appendChild(root);
    root.querySelector('.gfc-pc-close').onclick=()=>root.remove(); root.addEventListener('click',event=>{if(event.target===root)root.remove();});
    loadDossier(id).then(result=>{
      const panel=root.querySelector('.gfc-pc-panel'); if(!panel||result.reason!=='ok'){ if(panel) panel.innerHTML='<button class="gfc-pc-close" aria-label="Cerrar">×</button><p>'+(result.reason==='session_required'?'Inicia sesión con el propietario autorizado para abrir el expediente.':'No se pudo abrir el expediente CRM. No se utilizó otro entorno.')+'</p>'; panel?.querySelector('.gfc-pc-close')?.addEventListener('click',()=>root.remove()); return; }
      // El token solo procede de un expediente que el servidor ya autorizó para
      // este propietario. No se construye a partir del contacto del DOM.
      if(result.conversationToken&&typeof window.gfcSetOwnerConversationToken==='function') window.gfcSetOwnerConversationToken(result.conversationToken);
      if(typeof window.gfcYarbiConversationFocusSet==='function') window.gfcYarbiConversationFocusSet({contact_id:id,client_name:result.dossier.client_name||'',confirmed:true},'crm-dossier-authorized');
      panel.innerHTML='<button class="gfc-pc-close" aria-label="Cerrar">×</button>'+dossierMarkup(result); panel.querySelector('.gfc-pc-close').onclick=()=>root.remove(); panel.querySelector('.gfc-pc-dossier-back').onclick=()=>{root.remove();open();};
    });
  };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',install,{once:true}); else install();
})();
