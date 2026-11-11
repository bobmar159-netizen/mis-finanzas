/* Yarbi Financial Coach UI. Local read-only presentation; no egress or writes. */
(function () {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const soles = value => `S/ ${Number(value || 0).toLocaleString('es-PE', { minimumFractionDigits:2, maximumFractionDigits:2 })}`;

  function currentSummary() {
    const coach = window.YarbiFinancialCoach;
    const input = typeof window.gfcGetFinancialCoachInput === 'function' ? window.gfcGetFinancialCoachInput() : null;
    return coach && input ? coach.buildFinancialCoach(input) : null;
  }
  function normalized(value) {
    return String(value || '').toLocaleLowerCase('es-PE').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  function richReply(title, highlight, details) {
    const rows = Array.isArray(details) ? details.filter(Boolean) : [];
    return `## ${title}\n\n**${highlight}**${rows.length ? '\n\n' + rows.map(row => '- ' + row).join('\n') : ''}`;
  }
  function matchingService(summary, utterance) {
    const requested = normalized(utterance);
    const rows = Array.isArray(summary?.collected_by_service_month) ? summary.collected_by_service_month : [];
    if (/\binstalacion(?:es)?\b/.test(requested)) return rows.filter(row => /instalacion/.test(normalized(row.service)));
    return [];
  }
  function localReply(utterance) {
    const value = normalized(utterance);
    if (!/\b(caja|meta|cobrar|cobro|compromiso|vencimiento|vence|debo|debe|deben|deudor|deudores|deuda|pagar|gasto|ingreso|finanzas?|dinero|proyeccion|proyecta|este mes|mensual)\b/.test(value)) return null;
    const result = currentSummary();
    if (!result) return { handled:true, reply:'No puedo leer el resumen financiero local ahora. No se realizó ninguna consulta externa.' };
    const summary = result.summary;
    if (/\b(cobrado|cobramos|ingreso|ingresos)\b/.test(value) && /\binstalacion(?:es)?\b/.test(value)) {
      const matches = matchingService(summary, value);
      if (!matches.length) return { handled:true, reply:richReply('🔧 Cobros por instalaciones', 'No hay cobros vinculados de forma estructurada este mes.', ['No usaré una descripción libre como prueba de servicio.']) };
      const total = matches.reduce((sum, row) => sum + Number(row.collected || 0), 0);
      return { handled:true, reply:richReply('🔧 Cobros por instalaciones', `${soles(total)} cobrados este mes.`, ['Solo se incluyeron movimientos vinculados al servicio.', 'No se incluyeron cotizaciones ni cuentas por cobrar.']) };
    }
    if (/quien me debe|quién me debe|deudores|quienes deben|quiénes deben/.test(value)) {
      const people = Array.isArray(summary.top_named_receivables) ? summary.top_named_receivables : [];
      if (!people.length) return { handled:true, reply:richReply('📥 Cobros pendientes', 'No hay nombres verificados asociados a los cobros pendientes locales.', ['El total continúa separado de la caja.']) };
      const entries = people.map(row => `${row.name}: ${soles(row.balance_amount)}`);
      return { handled:true, reply:richReply('📥 Cobros pendientes', `${soles(summary.pending_receivables)} por cobrar en total.`, [...entries, 'No se cuenta como efectivo hasta registrar el cobro.']) };
    }
    if (/por cobrar|cobrar|cobro pendiente/.test(value)) return { handled:true, reply:richReply('📥 Cobros pendientes', `${soles(summary.pending_receivables)} por cobrar registrado.`, ['Lo mantengo separado de la caja hasta que confirmes el cobro.']) };
    if (/vencimiento|vence|proximo|próximo/.test(value)) {
      const next = summary.next_known_commitment;
      if (!next) return { handled:true, reply:richReply('📅 Próximo compromiso', 'No hay un vencimiento con fecha registrada.', ['No voy a inventar una fecha.']) };
      const amount = next.scheduled_amount === null ? ' El monto de esa cuota no está confirmado en los registros locales.' : ` La cuota registrada es ${soles(next.scheduled_amount)}.`;
      return { handled:true, reply:next.status === 'overdue' ? richReply('⚠️ Compromiso vencido', `Vencido desde ${next.due_at}.`, [amount.trim()]) : next.status === 'due_today' ? richReply('📅 Compromiso de hoy', 'Tienes un compromiso que vence hoy.', [amount.trim()]) : richReply('📅 Próximo compromiso', `Vence el ${next.due_at}.`, [amount.trim()]) };
    }
    if (/compromiso|debo|deuda|pagar/.test(value)) return { handled:true, reply:richReply('📌 Compromisos', `${soles(summary.known_commitments_due)} en compromisos locales pendientes.`, ['No lo confundí con gastos ya registrados.']) };
    if (/proyeccion|proyecta|este mes|mensual/.test(value)) {
      if (summary.projected_free_cash_month === null) return { handled:true, reply:richReply('📈 Proyección del mes', 'No hay movimientos locales suficientes para proyectar el mes.', ['No convertiré cuentas por cobrar ni cotizaciones en efectivo estimado.']) };
      return { handled:true, reply:richReply('📈 Proyección del mes', `${soles(summary.projected_free_cash_month)} de caja libre estimada.`, ['Se calcula con el promedio registrado por día transcurrido.', 'Es una estimación, no una garantía.', `Excluye ${soles(summary.pending_receivables)} por cobrar.`]) };
    }
    if (/meta|falta|faltan/.test(value)) return { handled:true, reply:summary.remaining_to_daily_goal > 0 ? richReply('🎯 Meta diaria', `Faltan ${soles(summary.remaining_to_daily_goal)} para la meta de caja libre.`, [`Hoy llevas ${soles(summary.free_cash_today)} registrados.`]) : richReply('🎯 Meta diaria', 'La meta de caja libre está cubierta.', [`Hoy llevas ${soles(summary.free_cash_today)} registrados.`]) };
    return { handled:true, reply:richReply('💰 Caja libre', `${soles(summary.free_cash_today)} registrados hoy.`, [`${soles(summary.pending_receivables)} por cobrar no se cuentan como efectivo hasta registrar el cobro.`]) };
  }
  function markup(result) {
    if (!result) return '<p>No pude preparar el resumen financiero local. No se realizó ninguna consulta externa.</p>';
    const summary = result.summary;
    const gap = summary.remaining_to_daily_goal;
    const goal = gap > 0 ? `Faltan ${soles(gap)} para la meta diaria de caja libre.` : 'La meta diaria de caja libre está cubierta con movimientos registrados.';
    const source = result.source_status.transactions === 'available' ? 'Registros locales del negocio' : result.source_status.transactions === 'no_information' ? 'Aún no hay movimientos locales registrados' : 'Movimientos locales no disponibles';
    return `<h2>Resumen financiero</h2>
      <p>Lectura local de tu negocio. No envía datos ni ejecuta cobros, pagos o mensajes.</p>
      <div class="gfc-fc-grid">
        <div class="gfc-fc-card"><b>Caja libre hoy</b><strong>${esc(soles(summary.free_cash_today))}</strong><small>Ingresos registrados menos egresos registrados.</small></div>
        <div class="gfc-fc-card"><b>Meta diaria</b><strong>${esc(soles(summary.daily_free_cash_goal))}</strong><small>${esc(goal)}</small><label class="gfc-fc-goal-label">Nueva meta<input class="gfc-fc-goal-input" type="number" inputmode="decimal" min="0.01" max="1000000" step="0.01" value="${esc(summary.daily_free_cash_goal)}"></label><button class="gfc-fc-goal-button" type="button">Cambiar meta</button></div>
        <div class="gfc-fc-card"><b>Por cobrar</b><strong>${esc(soles(summary.pending_receivables))}</strong><small>No se cuenta como caja hasta registrar el cobro.</small></div>
        <div class="gfc-fc-card"><b>Compromisos conocidos</b><strong>${esc(soles(summary.known_commitments_due))}</strong><small>Se muestran aparte del dinero que ya salió.</small></div>
      </div>
      <section class="gfc-fc-note"><b>Este mes</b><br>Caja libre registrada: <strong>${esc(soles(summary.free_cash_month))}</strong> · Fuente: ${esc(source)}.</section>
      <section class="gfc-fc-note"><b>Proyección conservadora</b><br>${summary.projected_free_cash_month === null ? 'Aún no hay movimientos suficientes para proyectar el mes.' : '<strong>'+esc(soles(summary.projected_free_cash_month))+'</strong> usando el promedio de caja libre por día transcurrido. Es una estimación y excluye cobros pendientes.'}</section>
      <section class="gfc-fc-note"><b>Próximo compromiso</b><br>${!summary.next_known_commitment ? 'No hay una fecha de vencimiento registrada.' : summary.next_known_commitment.status === 'overdue' ? 'Vencido desde <strong>'+esc(summary.next_known_commitment.due_at)+'</strong>.' : summary.next_known_commitment.status === 'due_today' ? 'Vence <strong>hoy</strong>.' : 'Vence el <strong>'+esc(summary.next_known_commitment.due_at)+'</strong>.'}${summary.next_known_commitment?.scheduled_amount === null ? ' El monto de la cuota no está confirmado.' : summary.next_known_commitment ? ' Cuota registrada: <strong>'+esc(soles(summary.next_known_commitment.scheduled_amount))+'</strong>.' : ''}</section>
      <p class="gfc-fc-foot">Las cotizaciones y cuentas por cobrar no se presentan como ingresos. El resumen no sustituye la revisión de los comprobantes.</p>`;
  }
  function open() {
    document.querySelector('.gfc-fc-shade')?.remove();
    const shell = document.createElement('div');
    shell.className = 'gfc-fc-shade';
    shell.innerHTML = `<section class="gfc-fc-panel" role="dialog" aria-label="Resumen financiero de Yarbi"><button class="gfc-fc-close" aria-label="Cerrar">×</button>${markup(currentSummary())}</section>`;
    document.body.appendChild(shell);
    shell.querySelector('.gfc-fc-close').onclick = () => shell.remove();
    shell.querySelector('.gfc-fc-goal-button')?.addEventListener('click', () => {
      const input = shell.querySelector('.gfc-fc-goal-input');
      if (!input || typeof window.gfcSetFinancialCoachDailyGoal !== 'function') return;
      const saved = window.gfcSetFinancialCoachDailyGoal(input.value);
      if (saved?.ok) { shell.remove(); open(); }
      else if (saved?.code === 'financial_goal_invalid') window.alert('Escribe una meta diaria válida.');
      else if (saved?.code === 'financial_goal_storage_unavailable') window.alert('No se pudo guardar la meta en este dispositivo.');
    });
    shell.addEventListener('click', event => { if (event.target === shell) shell.remove(); });
  }
  function style() {
    if (document.getElementById('gfc-financial-coach-style')) return;
    const node = document.createElement('style'); node.id = 'gfc-financial-coach-style';
    node.textContent = '.gfc-fc-shade{position:fixed;inset:0;z-index:10055;background:rgba(15,23,42,.38);display:flex;align-items:flex-end}.gfc-fc-panel{position:relative;width:100%;max-width:560px;margin:auto;background:#fff;border-radius:20px 20px 0 0;padding:20px;box-sizing:border-box;color:#172033;font:14px Inter,Arial;max-height:88vh;overflow:auto}.gfc-fc-panel h2{margin:0 32px 6px 0;font-size:20px}.gfc-fc-panel p{line-height:1.45;color:#64748B}.gfc-fc-close{position:absolute;right:15px;top:13px;border:0;background:transparent;font-size:22px;cursor:pointer;color:#475569}.gfc-fc-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:17px 0}.gfc-fc-card{border:1px solid #D8E7DE;border-radius:13px;padding:12px;background:#F8FCF9}.gfc-fc-card b{display:block;font-size:11px;color:#416758}.gfc-fc-card strong{display:block;font-size:18px;margin:5px 0;color:#125D42}.gfc-fc-card small{display:block;color:#64748B;line-height:1.28}.gfc-fc-goal-label{display:block;margin-top:9px;color:#416758;font-size:10px;font-weight:800}.gfc-fc-goal-input{display:block;box-sizing:border-box;width:100%;margin-top:4px;border:1px solid #BFD8C9;border-radius:8px;padding:6px;background:#fff;color:#172033}.gfc-fc-goal-button{display:block;margin-top:7px;border:1px solid #9ACCB1;background:#fff;color:#125D42;border-radius:8px;padding:6px 8px;font-weight:800;font-size:11px}.gfc-fc-note{border-radius:12px;padding:12px;background:#F4F7FB;color:#344054;line-height:1.45}.gfc-fc-foot{font-size:12px;margin-bottom:0}@media(max-width:360px){.gfc-fc-grid{grid-template-columns:1fr}}';
    document.head.appendChild(node);
  }
  window.gfcOpenFinancialCoach = function () { style(); open(); };
  window.gfcTryFinancialCoachMessage = localReply;
})();
