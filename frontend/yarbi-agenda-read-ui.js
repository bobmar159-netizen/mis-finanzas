/* Yarbi Agenda fast reads. It only formats the local Agenda snapshot. */
(function () {
  'use strict';
  const rows = value => Array.isArray(value) ? value : [];
  const summaryFor = () => {
    const input = typeof window.gfcGetAgendaReadInput === 'function' ? window.gfcGetAgendaReadInput() : null;
    const agenda = window.YarbiAgendaIntelligence;
    return input && agenda ? { input, agenda, summary:agenda.summarizeAgenda(input.events, { now:input.now, limit:80 }) } : null;
  };
  const describe = item => [item.client_name || 'Cliente sin nombre', item.service || item.type || 'Actividad', item.date || 'Sin fecha', item.time || ''].filter(Boolean).join(' · ');
  function reply(utterance) {
    const context = summaryFor();
    if (!context) return null;
    const plan = context.agenda.planAgendaRead(utterance, context.input.now);
    if (plan.outcome !== 'agenda_read_ready') return null;
    let selected = [];
    if (plan.kind === 'day') selected = rows(context.summary.upcoming).filter(item => item.date === plan.date);
    if (plan.kind === 'pending_visits') selected = rows(context.summary.pending).filter(item => item.type === 'visita' || item.type === 'visita_tecnica');
    if (plan.kind === 'follow_up') selected = [...rows(context.summary.pending), ...rows(context.summary.upcoming)].filter(item => /seguimiento|llamar|contact/.test(`${item.type} ${item.service} ${item.status}`.toLowerCase()));
    if (plan.kind === 'contact_history') return null;
    if (!selected.length) {
      const empty = plan.kind === 'day' ? 'No tengo actividades locales registradas para mañana.' : plan.kind === 'follow_up' ? 'No tengo seguimientos locales pendientes para llamar.' : 'No tengo visitas locales pendientes.';
      return { handled:true, reply:empty, facts:{ agenda_state:'no_information', count:0 }, execute:false };
    }
    const label = plan.kind === 'day' ? 'Mañana tienes' : plan.kind === 'follow_up' ? 'Estos seguimientos requieren revisión' : 'Estas visitas siguen pendientes';
    return { handled:true, reply:`${label}: ${selected.slice(0,4).map(describe).join('; ')}${selected.length > 4 ? `; y ${selected.length - 4} más.` : '.'}`, facts:{ agenda_state:'available', count:selected.length, kind:plan.kind }, execute:false };
  }
  window.gfcTryAgendaReadMessage = reply;
})();
