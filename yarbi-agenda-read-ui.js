/* Yarbi Agenda fast reads. It only formats the local Agenda snapshot. */
(function () {
  'use strict';
  const rows = value => Array.isArray(value) ? value : [];
  const summaryFor = async () => {
    const input = typeof window.gfcGetAgendaReadInput === 'function' ? await window.gfcGetAgendaReadInput() : null;
    const agenda = window.YarbiAgendaIntelligence;
    if (!input || !agenda) return null;
    let events = rows(input.events);
    if (typeof window.gfcYarbiLocalRows === 'function') {
      try {
        const [mirroredRows, contactRows] = await Promise.all([
          window.gfcYarbiLocalRows('agenda'),
          window.gfcYarbiLocalRows('contact').catch(() => [])
        ]);
        const contactNames = new Map(rows(contactRows).map(contact => [String(contact.id), String(contact.display_name || contact.full_name || '')]));
        events = events.map(item => ({ ...item, client_name:item?.client_name || contactNames.get(String(item?.contact_id)) || '' }));
        const mirrored = rows(mirroredRows).map(item => ({ ...item, client_name:item?.client_name || contactNames.get(String(item?.contact_id)) || '' }));
        const known = new Set(events.filter(item => item?.id != null).map(item => String(item.id)));
        events = [...events, ...mirrored.filter(item => item?.id == null || !known.has(String(item.id)))];
      } catch (_) { /* La agenda local existente sigue disponible si falla IndexedDB. */ }
    }
    return { input, agenda, summary:agenda.summarizeAgenda(events, { now:input.now, limit:80 }) };
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
  const presentationFor = (kind, selected, reply) => {
    const renderer = window.YarbiConversationRenderer;
    if (!renderer?.SCHEMA) return undefined;
    const title = responseTitle(kind).replace(/^##\s+/, '');
    const blocks = [{ id:'agenda-read-heading', type:'heading', version:1, level:2, text:title }];
    if (!selected.length) {
      blocks.push({ id:'agenda-read-empty', type:'information_panel', version:1, title:'Agenda local', text:reply.split('\n\n').slice(1).join(' ').trim(), severity:'info' });
      return { schema:renderer.SCHEMA, blocks };
    }
    const overview = kind === 'day' ? `Tienes ${selected.length} ${singular(selected.length)} registrada(s) para mañana.` : kind === 'follow_up' ? `${selected.length} ${singular(selected.length)} requiere(n) revisión.` : `${selected.length} ${singular(selected.length)} sigue(n) pendiente(s).`;
    blocks.push({ id:'agenda-read-summary', type:'information_panel', version:1, title:'Resumen', text:overview, severity:'info' });
    selected.slice(0,4).forEach((item,index) => {
      const fields = [
        { label:'Actividad', value:String(item.service || item.type || 'Actividad') },
        { label:'Fecha', value:item.date ? formatDate(item.date) : 'Sin fecha confirmada' },
        ...(item.time ? [{ label:'Hora', value:String(item.time) }] : []),
        { label:'Estado', value:stateLabel(item) },
        ...(item.district ? [{ label:'Distrito', value:String(item.district) }] : [])
      ];
      blocks.push({ id:`agenda-read-item-${index+1}`, type:'appointment_card', version:1, title:String(item.client_name || 'Cliente sin nombre'), fields:fields.slice(0,14), tone:item.state==='overdue'?'warning':'neutral' });
    });
    if (selected.length > 4) blocks.push({ id:'agenda-read-more', type:'information_panel', version:1, title:'Más actividades', text:`Hay ${selected.length-4} actividades adicionales en la agenda local.`, severity:'neutral' });
    return { schema:renderer.SCHEMA, blocks };
  };
  async function reply(utterance) {
    const context = await summaryFor();
    if (!context) return null;
    const plan = context.agenda.planAgendaRead(utterance, context.input.now);
    if (plan.outcome !== 'agenda_read_ready') return null;
    let selected = [];
    if (plan.kind === 'day') selected = rows(context.summary.upcoming).filter(item => item.date === plan.date);
    if (plan.kind === 'pending_visits') selected = rows(context.summary.pending).filter(item => /^visita(?:_|\s|$)/i.test(String(item.type || '')));
    if (plan.kind === 'follow_up') selected = [...rows(context.summary.pending), ...rows(context.summary.upcoming)].filter(item => /seguimiento|llamar|contact/.test(`${item.type} ${item.service} ${item.status}`.toLowerCase()));
    if (plan.kind === 'contact_history') return null;
    if (!selected.length) {
      const text = emptyResponse(plan.kind);
      return { handled:true, reply:text, presentation:presentationFor(plan.kind, [], text), facts:{ agenda_state:'no_information', count:0 }, execute:false };
    }
    const shown = selected.slice(0,4);
    const rest = selected.length - shown.length;
    const overview = plan.kind === 'day' ? `Tienes **${selected.length} ${singular(selected.length)}** registrada para mañana.` : plan.kind === 'follow_up' ? `Hay **${selected.length} ${singular(selected.length)}** que requiere revisión.` : `Hay **${selected.length} ${singular(selected.length)}** aún pendiente.`;
    const more = rest > 0 ? `\n\n_Además hay ${rest} más en tu agenda local._` : '';
    const text = `${responseTitle(plan.kind)}\n\n${overview}\n\n${shown.map(describe).join('\n')}${more}`;
    return { handled:true, reply:text, presentation:presentationFor(plan.kind, selected, text), facts:{ agenda_state:'available', count:selected.length, kind:plan.kind }, execute:false };
  }
  window.gfcTryAgendaReadMessage = reply;
})();
