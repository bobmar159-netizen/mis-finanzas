/* Yarbi Agenda fast reads. It only formats the local Agenda snapshot. */
(function () {
  'use strict';
  const rows = value => Array.isArray(value) ? value : [];
  const summaryFor = () => {
    const input = typeof window.gfcGetAgendaReadInput === 'function' ? window.gfcGetAgendaReadInput() : null;
    const agenda = window.YarbiAgendaIntelligence;
    return input && agenda ? { input, agenda, summary:agenda.summarizeAgenda(input.events, { now:input.now, limit:80 }) } : null;
  };
  const stateLabel = item => ({
    overdue:'⚠️ vencida',
    without_date:'📌 sin fecha',
    pending_details:'🕒 pendiente de detalle',
    upcoming:'✓ programada',
    today:'● hoy',
    rescheduled:'↻ reprogramada'
  })[item?.state] || '◌ pendiente de revisión';
  const formatDate = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return 'Sin fecha confirmada';
    const parsed = new Date(`${value}T12:00:00.000Z`);
    return new Intl.DateTimeFormat('es-PE', { timeZone:'UTC', weekday:'long', day:'numeric', month:'long' }).format(parsed);
  };
  const describe = item => {
    const title = item.client_name || 'Cliente sin nombre';
    const activity = item.service || item.type || 'Actividad';
    const when = item.date ? formatDate(item.date) : 'Sin fecha confirmada';
    const time = item.time ? ` · ${item.time}` : '';
    return `- **${title}** — ${activity}\n  ${when}${time} · ${stateLabel(item)}`;
  };
  const singular = count => count === 1 ? 'actividad' : 'actividades';
  const responseTitle = kind => kind === 'day' ? '## 📅 Agenda de mañana' : kind === 'follow_up' ? '## 🔔 Seguimientos por revisar' : '## 🛠️ Visitas pendientes';
  const emptyResponse = kind => {
    const text = kind === 'day' ? 'No tengo actividades locales registradas para mañana.' : kind === 'follow_up' ? 'No tengo seguimientos locales pendientes para llamar.' : 'No tengo visitas locales pendientes.';
    return `${responseTitle(kind)}\n\n${text}`;
  };
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
      return { handled:true, reply:emptyResponse(plan.kind), facts:{ agenda_state:'no_information', count:0 }, execute:false };
    }
    const shown = selected.slice(0,4);
    const rest = selected.length - shown.length;
    const overview = plan.kind === 'day' ? `Tienes **${selected.length} ${singular(selected.length)}** registrada para mañana.` : plan.kind === 'follow_up' ? `Hay **${selected.length} ${singular(selected.length)}** que requiere revisión.` : `Hay **${selected.length} ${singular(selected.length)}** aún pendiente.`;
    const more = rest > 0 ? `\n\n_Además hay ${rest} más en tu agenda local._` : '';
    return { handled:true, reply:`${responseTitle(plan.kind)}\n\n${overview}\n\n${shown.map(describe).join('\n')}${more}`, facts:{ agenda_state:'available', count:selected.length, kind:plan.kind }, execute:false };
  }
  window.gfcTryAgendaReadMessage = reply;
})();
