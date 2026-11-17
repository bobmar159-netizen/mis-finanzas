/* Client dossier FAST read adapter.
   It reads only the already-authorized local mirror and never creates,
   modifies, sends, or synchronizes commercial data. */
(function attachClientContextReadUi(root) {
  'use strict';

  function isReadQuestion(text) {
    return typeof root.YarbiClientContextRead?.requestedReadKind === 'function'
      ? root.YarbiClientContextRead.requestedReadKind(text)
      : null;
  }

  function focusForRead() {
    const focus = typeof root.gfcYarbiConversationFocusRead === 'function'
      ? root.gfcYarbiConversationFocusRead({ allowStale: true })
      : null;
    return focus?.confirmed !== false && (focus?.phone || focus?.contact_id || focus?.client_name) ? focus : null;
  }

  function clientPresentation(result, context) {
    const renderer = root.YarbiConversationRenderer;
    if (!renderer?.SCHEMA || !result?.reply) return undefined;
    if (result.outcome !== 'client_context_found' && result.outcome !== 'client_balance_found') {
      return typeof renderer.markdownToContent === 'function' ? renderer.markdownToContent(result.reply, 'client-read') : undefined;
    }
    const dossier = context?.dossier || {};
    const name = String(dossier.client_name || context?.contact?.display_name || context?.contact?.full_name || 'Cliente');
    const blocks = [{ id:'client-read-heading', type:'heading', version:1, level:2, text:result.kind === 'activity' ? `📅 Seguimiento de ${name}` : result.kind === 'profile' ? `👤 Perfil de ${name}` : `🧾 Expediente de ${name}` }];
    if (result.outcome === 'client_balance_found' && Number.isFinite(Number(result.facts?.pending_amount)) && Number(result.facts.pending_amount) > 0) {
      blocks.push({ id:'client-read-balance', type:'finance_card', version:1, title:'Saldo pendiente verificado', summary:'Dato de la proyección local de cobranzas.', tone:'warning', fields:[{ label:'Cliente', value:name, tone:'neutral' },{ label:'Pendiente', value:`S/ ${Number(result.facts.pending_amount).toFixed(2)}`, tone:'warning' }] });
      return { schema:renderer.SCHEMA, blocks };
    }
    const fields = [];
    const add = (label,value) => { if (value !== undefined && value !== null && String(value).trim()) fields.push({ label, value:String(value).replace(/[\u0000-\u001f]/g,' ').trim().slice(0,240), tone:'neutral' }); };
    add('Servicio', dossier.service);
    add('Estado comercial', dossier.commercial_status);
    add('Estado operativo', dossier.operational_status);
    if (result.kind === 'activity') add('Actividad programada', [dossier.appointment_date, dossier.appointment_time].filter(Boolean).join(' · '));
    if (result.kind === 'profile') { add('Distrito', dossier.district); add('Ubicación', dossier.location); }
    if (['history','activity'].includes(result.kind)) add('Contexto verificado', dossier.conversation_brief);
    blocks.push({ id:'client-read-card', type:'client_card', version:1, title:name, summary:result.kind === 'history' ? 'Información disponible en el expediente local.' : 'Datos del expediente local verificado.', fields:fields.slice(0,14), tone:'neutral' });
    if (result.kind === 'history') {
      const events = Array.isArray(context?.timeline) ? context.timeline.slice(0,3) : [];
      const eventItems = events.map(event => {
        const at = String(event?.at || '').match(/^(20\d{2})-(\d{2})-(\d{2})/);
        const date = at ? `${at[3]}/${at[2]}/${at[1]}` : '';
        return [date, event?.title, event?.detail].filter(Boolean).map(value=>String(value).slice(0,220)).join(' · ');
      }).filter(Boolean);
      if (eventItems.length) blocks.push({ id:'client-read-history-heading', type:'heading', version:1, level:3, text:'Últimos registros verificados' },{ id:'client-read-history', type:'unordered_list', version:1, items:eventItems });
      const observations = Array.isArray(context?.historical_context?.observations) ? context.historical_context.observations.slice(-4).reverse() : [];
      const observationItems = observations.map(item => [item?.type, item?.service].filter(Boolean).map(value=>String(value).slice(0,200)).join(' · ')).filter(Boolean);
      if (observationItems.length) blocks.push({ id:'client-read-observations', type:'information_panel', version:1, title:'Contexto histórico revisado', text:'Estas observaciones aportan contexto; por sí solas no confirman pagos, visitas ni cierres.', severity:'info' },{ id:'client-read-observations-list', type:'unordered_list', version:1, items:observationItems });
    }
    return { schema:renderer.SCHEMA, blocks };
  }

  async function resolvedLocalContext(text) {
    const explicit = typeof root.gfcYarbiLiveClientQueryIntent === 'function'
      ? root.gfcYarbiLiveClientQueryIntent(text)
      : null;
    const focus = focusForRead();
    const requestedName = explicit?.client_name || '';
    if (!requestedName && !focus) return { context: null, explicit: false };
    if (typeof root.gfcYarbiLocalFindMemory !== 'function') return { context: null, explicit: Boolean(requestedName) };
    const context = await root.gfcYarbiLocalFindMemory({
      phone: requestedName ? '' : (focus?.phone || ''),
      client_name: requestedName || focus?.client_name || ''
    });
    if (context && !context.requires_disambiguation && requestedName && typeof root.gfcYarbiConversationFocusFromMemory === 'function') {
      root.gfcYarbiConversationFocusFromMemory(context, { client_name: requestedName }, 'client-context-local-read');
    }
    if (!context) return { context:null, explicit:Boolean(requestedName) };
    const contactId = context?.contact?.id || context?.contact?.contact_id || focus?.contact_id || '';
    const historicalContext = contactId && typeof root.gfcYarbiHistoricalContactContext === 'function'
      ? root.gfcYarbiHistoricalContactContext(contactId)
      : null;
    return { context:{ ...context, focus, historical_context:historicalContext || null }, explicit:Boolean(requestedName) };
  }

  root.gfcTryClientContextReadMessage = async function gfcTryClientContextReadMessage(text) {
    if (!isReadQuestion(text) || !root.YarbiClientContextRead?.replyForContext) return null;
    const resolved = await resolvedLocalContext(text);
    if (!resolved.context) {
      if (!resolved.explicit) return null;
      const reply = 'No tengo una copia local verificable de ese cliente todavía. Dame una pista como distrito, servicio o una conversación reciente; no usaré otro entorno ni inventaré datos.';
      const renderer = root.YarbiConversationRenderer;
      return { handled: true, kind: 'client_context_read', reply, presentation:renderer?.markdownToContent?.(reply, 'client-read-missing') };
    }
    if (resolved.context.requires_disambiguation && typeof root.gfcAgendaDisambiguationReply === 'function') {
      const reply = root.gfcAgendaDisambiguationReply(resolved.context.candidates || [], '');
      const renderer = root.YarbiConversationRenderer;
      return { handled: true, kind: 'client_context_read', reply, presentation:renderer?.markdownToContent?.(reply, 'client-read-ambiguous') };
    }
    const result = root.YarbiClientContextRead.replyForContext({ utterance: text, context: resolved.context });
    return result ? { handled: true, kind: 'client_context_read', reply: result.reply, presentation:clientPresentation(result, resolved.context), outcome: result.outcome, facts: result.facts || null } : null;
  };
})(window);
