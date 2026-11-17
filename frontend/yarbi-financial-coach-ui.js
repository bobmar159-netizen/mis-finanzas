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
  function structuredReply(reply, title, metrics, notes = [], fields) {
    const renderer = window.YarbiConversationRenderer;
    if (!renderer?.SCHEMA) return { handled:true, reply };
    const blocks = [{ id:'finance-title', type:'heading', version:1, level:2, text:title }];
    (Array.isArray(metrics) ? metrics : []).slice(0,6).forEach((metric,index) => blocks.push({
      id:'finance-metric-'+(index+1), type:'metric_card', version:1,
      label:metric.label, value:metric.value, tone:metric.tone||'neutral', ...(metric.detail?{detail:metric.detail}:{})
    }));
    if (Array.isArray(fields) && fields.length) blocks.push({ id:'finance-details', type:'finance_card', version:1, title:'Detalle verificado', fields:fields.slice(0,12) });
    if (notes.length) blocks.push({ id:'finance-note', type:'information_panel', version:1, title:'Cómo leer este dato', text:notes.join(' '), severity:'info' });
    return { handled:true, reply, presentation:{ schema:renderer.SCHEMA, blocks } };
  }
  function matchingService(summary, utterance) {
    const requested = normalized(utterance);
    const rows = Array.isArray(summary?.collected_by_service_month) ? summary.collected_by_service_month : [];
    if (/\binstalacion(?:es)?\b/.test(requested)) return rows.filter(row => /instalacion/.test(normalized(row.service)));
    return [];
  }
  function localReply(utterance) {
    const value = normalized(utterance);
    if (!/\b(caja|balance|saldo|resultado|meta|cobrar|cobro|compromiso|vencimiento|vence|debo|debe|deben|deudor|deudores|deuda|pagar|gasto|ingreso|finanzas?|dinero|proyeccion|proyecta|este mes|mensual|mes)\b/.test(value)) return null;
    const result = currentSummary();
    if (!result) return { handled:true, reply:'No puedo leer el resumen financiero local ahora. No se realizó ninguna consulta externa.' };
    const summary = result.summary;
    const quality = result.quality || {};
    const unavailable = (title, message) => structuredReply(richReply('⚠️ ' + title, message, ['No voy a completar montos con datos ausentes, sin identidad o conflictivos.']), title, [], ['Fuente local no verificable.']);
    const pendingLabel = quality.receivables_complete ? soles(summary.pending_receivables) : 'No disponible';
    if (/\b(cobrado|cobramos|ingreso|ingresos)\b/.test(value) && /\binstalacion(?:es)?\b/.test(value)) {
      if (!quality.transactions_complete) return unavailable('Cobros por instalaciones no disponibles', 'No puedo verificar los movimientos locales necesarios para sumar este mes.');
      const matches = matchingService(summary, value);
      if (!matches.length) return structuredReply(richReply('🔧 Cobros por instalaciones', 'No hay cobros vinculados de forma estructurada este mes.', ['No usaré una descripción libre como prueba de servicio.']), 'Cobros por instalaciones', [], ['No encontré movimientos locales vinculados con evidencia estructurada.']);
      const total = matches.reduce((sum, row) => sum + Number(row.collected || 0), 0);
      return structuredReply(richReply('🔧 Cobros por instalaciones', `${soles(total)} cobrados este mes.`, ['Solo se incluyeron movimientos vinculados al servicio.', 'No se incluyeron cotizaciones ni cuentas por cobrar.']), 'Cobros por instalaciones', [{label:'Cobrado este mes',value:soles(total),tone:'success'}], ['Solo se sumaron movimientos vinculados al servicio; no se incluyeron cotizaciones ni cuentas por cobrar.']);
    }
    if (/quien me debe|quién me debe|deudores|quienes deben|quiénes deben/.test(value)) {
      if (!quality.receivables_complete) return unavailable('Cobros pendientes no disponibles', 'No puedo verificar la fuente local de cuentas por cobrar.');
      const people = Array.isArray(summary.top_named_receivables) ? summary.top_named_receivables : [];
      if (!people.length) return structuredReply(richReply('📥 Cobros pendientes', 'No hay nombres verificados asociados a los cobros pendientes locales.', ['El total continúa separado de la caja.']), 'Cobros pendientes', [{label:'Por cobrar',value:soles(summary.pending_receivables),tone:'warning'}], ['No hay nombres verificados asociados a esos saldos. El total se mantiene separado de la caja.']);
      const entries = people.map(row => `${row.name}: ${soles(row.balance_amount)}`);
      return structuredReply(richReply('📥 Cobros pendientes', `${soles(summary.pending_receivables)} por cobrar en total.`, [...entries, 'No se cuenta como efectivo hasta registrar el cobro.']), 'Cobros pendientes', [{label:'Total por cobrar',value:soles(summary.pending_receivables),tone:'warning'}], ['No se cuenta como efectivo hasta registrar el cobro.'], people.slice(0,12).map(row=>({label:String(row.name||'Cliente').slice(0,100),value:soles(row.balance_amount),tone:'neutral'})));
    }
    if (/por cobrar|cobrar|cobro pendiente/.test(value)) {
      if (!quality.receivables_complete) return unavailable('Cobros pendientes no disponibles', 'No puedo verificar la fuente local de cuentas por cobrar.');
      return structuredReply(richReply('📥 Cobros pendientes', `${soles(summary.pending_receivables)} por cobrar registrado.`, ['Lo mantengo separado de la caja hasta que confirmes el cobro.']), 'Cobros pendientes', [{label:'Saldo por cobrar',value:soles(summary.pending_receivables),tone:'warning'}], ['Se mantiene separado de la caja hasta que el cobro esté registrado.']);
    }
    if (/vencimiento|vence|proximo|próximo/.test(value)) {
      if (!quality.commitments_complete) return unavailable('Compromisos no disponibles', 'No puedo verificar la fuente local de vencimientos.');
      const next = summary.next_known_commitment;
      if (!next) return structuredReply(richReply('📅 Próximo compromiso', 'No hay un vencimiento con fecha registrada.', ['No voy a inventar una fecha.']), 'Próximo compromiso', [], ['No hay una fecha de vencimiento verificada.']);
      const amount = next.scheduled_amount === null ? ' El monto de esa cuota no está confirmado en los registros locales.' : ` La cuota registrada es ${soles(next.scheduled_amount)}.`;
      return structuredReply(next.status === 'overdue' ? richReply('⚠️ Compromiso vencido', `Vencido desde ${next.due_at}.`, [amount.trim()]) : next.status === 'due_today' ? richReply('📅 Compromiso de hoy', 'Tienes un compromiso que vence hoy.', [amount.trim()]) : richReply('📅 Próximo compromiso', `Vence el ${next.due_at}.`, [amount.trim()]), next.status === 'overdue' ? 'Compromiso vencido' : next.status === 'due_today' ? 'Compromiso de hoy' : 'Próximo compromiso', [], [amount.trim()], [{label:'Fecha',value:String(next.due_at||'Sin fecha confirmada'),tone:next.status==='overdue'?'warning':'neutral'},...(next.scheduled_amount===null?[]:[{label:'Cuota registrada',value:soles(next.scheduled_amount),tone:'neutral'}])]);
    }
    if (/compromiso|debo|deuda|pagar/.test(value)) {
      if (!quality.commitments_complete) return unavailable('Compromisos no disponibles', 'No puedo verificar la fuente local de compromisos.');
      return structuredReply(richReply('📌 Compromisos', `${soles(summary.known_commitments_due)} en compromisos locales pendientes.`, ['No lo confundí con gastos ya registrados.']), 'Compromisos', [{label:'Pendiente registrado',value:soles(summary.known_commitments_due),tone:'warning'}], ['No se confunde con gastos ya registrados.']);
    }
    if (/\b(balance|saldo|resultado|caja)\b/.test(value) && /\b(mes|mensual)\b/.test(value) && !/proyeccion|proyecta/.test(value)) {
      if (!quality.transactions_complete) return unavailable('Balance del mes no disponible', 'Los movimientos locales están ausentes o contienen registros incompletos/conflictivos.');
      return structuredReply(richReply('💰 Balance del mes', `${soles(summary.free_cash_month)} de caja libre registrada.`, [
        `✅ Ingresos cobrados: **${soles(summary.collected_cash_month)}**`,
        `➖ Egresos registrados: **${soles(summary.operating_expenses_month)}**`,
        `📥 Por cobrar, fuera de caja: **${pendingLabel}**`,
        `Fuente local: ${quality.accepted_transactions_month || 0} movimientos locales válidos del mes; ${quality.duplicate_transactions || 0} duplicados y ${quality.incomplete_records || 0} registros incompletos/conflictivos omitidos. No convierte cotizaciones ni cuentas por cobrar en efectivo.`
      ]), 'Balance del mes', [
        {label:'Caja libre',value:soles(summary.free_cash_month),tone:'success'},
        {label:'Ingresos cobrados',value:soles(summary.collected_cash_month),tone:'neutral'},
        {label:'Egresos registrados',value:soles(summary.operating_expenses_month),tone:'warning'},
        {label:'Por cobrar',value:pendingLabel,tone:'info',detail:'No se cuenta como efectivo.'}
      ], [`Fuente local: ${quality.accepted_transactions_month || 0} movimientos locales válidos del mes; ${quality.duplicate_transactions || 0} duplicados y ${quality.incomplete_records || 0} incompletos/conflictivos omitidos. Las cotizaciones y cuentas por cobrar no son efectivo.`]);
    }
    if (/proyeccion|proyecta|este mes|mensual/.test(value)) {
      if (!quality.transactions_complete) return unavailable('Proyección no disponible', 'Los movimientos locales no permiten un cálculo completo y verificable.');
      if (summary.projected_free_cash_month === null) return structuredReply(richReply('📈 Proyección del mes', 'No hay movimientos locales suficientes para proyectar el mes.', ['No convertiré cuentas por cobrar ni cotizaciones en efectivo estimado.']), 'Proyección del mes', [], ['No hay datos locales suficientes. No se convierten cotizaciones ni cuentas por cobrar en efectivo.']);
      return structuredReply(richReply('📈 Proyección del mes', `${soles(summary.projected_free_cash_month)} de caja libre estimada.`, ['Se calcula con el promedio registrado por día transcurrido.', 'Es una estimación, no una garantía.', quality.receivables_complete ? `Excluye ${pendingLabel} por cobrar.` : 'Las cuentas por cobrar no se incluyen; su fuente local no está disponible para informar el saldo.']), 'Proyección del mes', [{label:'Caja libre estimada',value:soles(summary.projected_free_cash_month),tone:'info',detail:'Estimación, no garantía.'}], ['Usa el promedio registrado por día transcurrido y no incluye cuentas por cobrar.']);
    }
    if (/meta|falta|faltan/.test(value)) {
      if (!quality.transactions_complete) return unavailable('Meta diaria no disponible', 'No puedo verificar los movimientos locales de hoy.');
      return structuredReply(summary.remaining_to_daily_goal > 0 ? richReply('🎯 Meta diaria', `Faltan ${soles(summary.remaining_to_daily_goal)} para la meta de caja libre.`, [`Hoy llevas ${soles(summary.free_cash_today)} registrados.`]) : richReply('🎯 Meta diaria', 'La meta de caja libre está cubierta.', [`Hoy llevas ${soles(summary.free_cash_today)} registrados.`]), 'Meta diaria de caja libre', [{label:'Avance hoy',value:soles(summary.free_cash_today),tone:'success'},{label:'Falta',value:soles(summary.remaining_to_daily_goal),tone:summary.remaining_to_daily_goal>0?'warning':'success'}], ['Los cobros pendientes no se cuentan como efectivo.']);
    }
    if (!quality.transactions_complete) return unavailable('Caja libre no disponible', 'No puedo verificar los movimientos locales de hoy.');
    return structuredReply(richReply('💰 Caja libre', `${soles(summary.free_cash_today)} registrados hoy.`, [`${pendingLabel} por cobrar no se cuentan como efectivo hasta registrar el cobro.`]), 'Caja libre de hoy', [{label:'Caja libre',value:soles(summary.free_cash_today),tone:'success'},{label:'Por cobrar',value:pendingLabel,tone:'info',detail:'Fuera de caja.'}], ['Por cobrar no se cuenta como efectivo hasta registrar el cobro.']);
  }
  function markup(result) {
    if (!result) return '<p>No pude preparar el resumen financiero local. No se realizó ninguna consulta externa.</p>';
    const summary = result.summary;
    const quality = result.quality || {};
    const cashVerified = quality.transactions_complete === true;
    const receivablesVerified = quality.receivables_complete === true;
    const commitmentsVerified = quality.commitments_complete === true;
    const shown = (verified, value) => verified ? soles(value) : 'No disponible';
    const gap = summary.remaining_to_daily_goal;
    const goal = !cashVerified ? 'No hay movimientos verificables para medir el avance.' : gap > 0 ? `Faltan ${soles(gap)} para la meta diaria de caja libre.` : 'La meta diaria de caja libre está cubierta con movimientos registrados.';
    const source = result.source_status.transactions === 'available' ? 'Registros locales del negocio' : result.source_status.transactions === 'no_information' ? 'Aún no hay movimientos locales registrados' : 'Movimientos locales no disponibles';
    return `<h2>Resumen financiero</h2>
      <p>Lectura local de tu negocio. No envía datos ni ejecuta cobros, pagos o mensajes.</p>
      <div class="gfc-fc-grid">
        <div class="gfc-fc-card"><b>Caja libre hoy</b><strong>${esc(shown(cashVerified,summary.free_cash_today))}</strong><small>Ingresos registrados menos egresos registrados.</small></div>
        <div class="gfc-fc-card"><b>Meta diaria</b><strong>${esc(soles(summary.daily_free_cash_goal))}</strong><small>${esc(goal)}</small><label class="gfc-fc-goal-label">Nueva meta<input class="gfc-fc-goal-input" type="number" inputmode="decimal" min="0.01" max="1000000" step="0.01" value="${esc(summary.daily_free_cash_goal)}"></label><button class="gfc-fc-goal-button" type="button">Cambiar meta</button></div>
        <div class="gfc-fc-card"><b>Por cobrar</b><strong>${esc(shown(receivablesVerified,summary.pending_receivables))}</strong><small>No se cuenta como caja hasta registrar el cobro.</small></div>
        <div class="gfc-fc-card"><b>Compromisos conocidos</b><strong>${esc(shown(commitmentsVerified,summary.known_commitments_due))}</strong><small>Se muestran aparte del dinero que ya salió.</small></div>
      </div>
      <section class="gfc-fc-note"><b>Este mes</b><br>Caja libre registrada: <strong>${esc(shown(cashVerified,summary.free_cash_month))}</strong> · Fuente: ${esc(source)}.<br><small>Movimientos válidos del mes: ${esc(quality.accepted_transactions_month || 0)} · Duplicados omitidos de la fuente: ${esc(quality.duplicate_transactions || 0)} · Incompletos/conflictivos excluidos de la fuente: ${esc(quality.incomplete_records || 0)}.</small></section>
      <section class="gfc-fc-note"><b>Proyección conservadora</b><br>${!cashVerified ? 'No disponible: la fuente de movimientos no está verificada.' : summary.projected_free_cash_month === null ? 'Aún no hay movimientos suficientes para proyectar el mes.' : '<strong>'+esc(soles(summary.projected_free_cash_month))+'</strong> usando el promedio de caja libre por día transcurrido. Es una estimación y excluye cobros pendientes.'}</section>
      <section class="gfc-fc-note"><b>Próximo compromiso</b><br>${!commitmentsVerified ? 'No disponible: la fuente local de compromisos no está verificada.' : !summary.next_known_commitment ? 'No hay una fecha de vencimiento registrada.' : summary.next_known_commitment.status === 'overdue' ? 'Vencido desde <strong>'+esc(summary.next_known_commitment.due_at)+'</strong>.' : summary.next_known_commitment.status === 'due_today' ? 'Vence <strong>hoy</strong>.' : 'Vence el <strong>'+esc(summary.next_known_commitment.due_at)+'</strong>.'}${commitmentsVerified && summary.next_known_commitment?.scheduled_amount === null ? ' El monto de la cuota no está confirmado.' : commitmentsVerified && summary.next_known_commitment ? ' Cuota registrada: <strong>'+esc(soles(summary.next_known_commitment.scheduled_amount))+'</strong>.' : ''}</section>
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
