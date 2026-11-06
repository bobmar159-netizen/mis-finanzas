/* Yarbi Product Completion UI. Sin secretos, sin proveedores y sin efectos comerciales. */
(function () {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-PE').replace(/[^a-z0-9ñ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const tokens = value => [...new Set(norm(value).split(' ').filter(Boolean))];
  const synonyms = { instalacion:['instalacion','instalar','nueva'], reparacion:['reparacion','reparar','arreglo'], punto:['punto','adicional','extension'], visita:['visita','agenda','coordinar'] };

  function currentOwner() { return String(window.gfcYarbiOwnerId || window.gfcOwnerAccountId || '').trim(); }
  function accountToken() { return typeof window.gfcAccountAccessToken === 'function' ? window.gfcAccountAccessToken() : ''; }
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
    const token=accountToken();
    if(!token) return { reason:'session_required', rows:[] };
    const source=options&&typeof options==='object'?options:{};
    try {
      const response=await fetch(new URL('/api/assistant/crm-search',apiOrigin()).toString(),{
        method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
        body:JSON.stringify({query:String(query||'').slice(0,240),filters:source.filters||{},page:source.page||1,limit:12})
      });
      const payload=await response.json().catch(()=>({}));
      if(!response.ok||payload.ok!==true) return { reason:payload.error==='owner_reference_unauthorized'?'session_required':'crm_unavailable',rows:[] };
      return { reason:'ok',rows:(Array.isArray(payload.results)?payload.results:[]).map(row=>({id:row.contact_id,name:row.display_name||'Sin nombre',district:row.district||'',service:row.latest_service||'',status:row.commercial_status||'frío',hits:Array.isArray(row.matched_fields)?row.matched_fields:[]})),pagination:payload.pagination||null };
    } catch (_) { return { reason:'crm_unavailable',rows:[] }; }
  }
  function style() {
    if (document.getElementById('yarbi-product-completion-style')) return;
    const node = document.createElement('style'); node.id='yarbi-product-completion-style';
    node.textContent = '.gfc-pc-launch{position:fixed;right:14px;bottom:84px;z-index:10002;border:1px solid #BFD9CE;border-radius:999px;background:#F0FAF5;color:#15684A;padding:9px 12px;font:800 12px Inter,Arial;box-shadow:0 5px 18px rgba(0,0,0,.12)}.gfc-pc-shade{position:fixed;inset:0;z-index:10030;background:rgba(15,23,42,.36);display:flex;align-items:flex-end}.gfc-pc-panel{width:100%;max-width:520px;max-height:88vh;overflow:auto;background:#fff;border-radius:20px 20px 0 0;margin:auto;padding:17px;font:14px Inter,Arial;color:#172033}.gfc-pc-panel h2{margin:0 0 4px;font-size:18px}.gfc-pc-panel p{color:#64748B;line-height:1.4}.gfc-pc-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:13px 0}.gfc-pc-grid button,.gfc-pc-search button{padding:10px;border:1px solid #D8E2E9;border-radius:10px;background:#F8FBFC;color:#172033;font-weight:800}.gfc-pc-search{display:flex;gap:7px;margin:10px 0}.gfc-pc-search input{min-width:0;flex:1;padding:10px;border:1px solid #BFCFDB;border-radius:10px}.gfc-pc-result{padding:9px 0;border-top:1px solid #EEF1F3}.gfc-pc-result small{color:#667085}.gfc-pc-close{float:right;border:0;background:none;font-size:18px;cursor:pointer}';
    document.head.appendChild(node);
  }
  function renderResults(root, result) {
    const target = root.querySelector('[data-results]');
    if (result.reason === 'session_required') { target.innerHTML='<p>Inicia sesión con el propietario autorizado para consultar el CRM.</p>'; return; }
    if (result.reason === 'crm_unavailable') { target.innerHTML='<p>La consulta CRM no está disponible ahora. No se usó ningún fallback hacia otro entorno.</p>'; return; }
    target.innerHTML = result.rows.length ? result.rows.map(row => '<article class="gfc-pc-result"><b>'+esc(row.name)+'</b><br><small>'+esc([row.district,row.service,row.status].filter(Boolean).join(' · '))+' · coincidencias: '+esc(row.hits.join(', '))+'</small><br><button data-contact="'+esc(row.id)+'" style="margin-top:7px;padding:5px 7px;border:1px solid #D8E2E9;border-radius:7px;background:#fff;font-weight:800">Ver expediente</button></article>').join('') : '<p>No hay coincidencias en tu alcance CRM autorizado.</p>';
    target.querySelectorAll('[data-contact]').forEach(button=>button.onclick=()=>window.gfcOpenYarbiCrmDossier(button.dataset.contact));
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
    if(typeof window.toast==='function') window.toast('El expediente se abrirá desde CRM para el contacto seleccionado.','info');
  };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',install,{once:true}); else install();
})();
