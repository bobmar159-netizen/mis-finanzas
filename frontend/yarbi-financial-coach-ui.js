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
  function localReply(utterance) {
    const value = normalized(utterance);
    if (!/\b(caja|meta|cobrar|cobro|compromiso|gasto|ingreso|finanzas?|dinero)\b/.test(value)) return null;
    const result = currentSummary();
    if (!result) return { handled:true, reply:'No puedo leer el resumen financiero local ahora. No se realizó ninguna consulta externa.' };
    const summary = result.summary;
    if (/por cobrar|cobrar|cobro pendiente/.test(value)) return { handled:true, reply:`Tienes ${soles(summary.pending_receivables)} por cobrar registrado. Lo mantengo separado de la caja hasta que confirmes el cobro.` };
    if (/compromiso|debo|deuda|pagar/.test(value)) return { handled:true, reply:`Hay ${soles(summary.known_commitments_due)} en compromisos locales pendientes. No lo confundí con gastos ya registrados.` };
    if (/meta|falta|faltan/.test(value)) return { handled:true, reply:summary.remaining_to_daily_goal > 0 ? `Faltan ${soles(summary.remaining_to_daily_goal)} para la meta diaria de caja libre. Hoy llevas ${soles(summary.free_cash_today)} registrados.` : `La meta diaria de caja libre está cubierta: hoy llevas ${soles(summary.free_cash_today)} registrados.` };
    return { handled:true, reply:`La caja libre registrada hoy es ${soles(summary.free_cash_today)}. Hay ${soles(summary.pending_receivables)} por cobrar, que no cuento como efectivo hasta registrarlo.` };
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
        <div class="gfc-fc-card"><b>Meta diaria</b><strong>${esc(soles(summary.daily_free_cash_goal))}</strong><small>${esc(goal)}</small></div>
        <div class="gfc-fc-card"><b>Por cobrar</b><strong>${esc(soles(summary.pending_receivables))}</strong><small>No se cuenta como caja hasta registrar el cobro.</small></div>
        <div class="gfc-fc-card"><b>Compromisos conocidos</b><strong>${esc(soles(summary.known_commitments_due))}</strong><small>Se muestran aparte del dinero que ya salió.</small></div>
      </div>
      <section class="gfc-fc-note"><b>Este mes</b><br>Caja libre registrada: <strong>${esc(soles(summary.free_cash_month))}</strong> · Fuente: ${esc(source)}.</section>
      <p class="gfc-fc-foot">Las cotizaciones y cuentas por cobrar no se presentan como ingresos. El resumen no sustituye la revisión de los comprobantes.</p>`;
  }
  function open() {
    document.querySelector('.gfc-fc-shade')?.remove();
    const shell = document.createElement('div');
    shell.className = 'gfc-fc-shade';
    shell.innerHTML = `<section class="gfc-fc-panel" role="dialog" aria-label="Resumen financiero de Yarbi"><button class="gfc-fc-close" aria-label="Cerrar">×</button>${markup(currentSummary())}</section>`;
    document.body.appendChild(shell);
    shell.querySelector('.gfc-fc-close').onclick = () => shell.remove();
    shell.addEventListener('click', event => { if (event.target === shell) shell.remove(); });
  }
  function style() {
    if (document.getElementById('gfc-financial-coach-style')) return;
    const node = document.createElement('style'); node.id = 'gfc-financial-coach-style';
    node.textContent = '.gfc-fc-shade{position:fixed;inset:0;z-index:10055;background:rgba(15,23,42,.38);display:flex;align-items:flex-end}.gfc-fc-panel{position:relative;width:100%;max-width:560px;margin:auto;background:#fff;border-radius:20px 20px 0 0;padding:20px;box-sizing:border-box;color:#172033;font:14px Inter,Arial;max-height:88vh;overflow:auto}.gfc-fc-panel h2{margin:0 32px 6px 0;font-size:20px}.gfc-fc-panel p{line-height:1.45;color:#64748B}.gfc-fc-close{position:absolute;right:15px;top:13px;border:0;background:transparent;font-size:22px;cursor:pointer;color:#475569}.gfc-fc-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:17px 0}.gfc-fc-card{border:1px solid #D8E7DE;border-radius:13px;padding:12px;background:#F8FCF9}.gfc-fc-card b{display:block;font-size:11px;color:#416758}.gfc-fc-card strong{display:block;font-size:18px;margin:5px 0;color:#125D42}.gfc-fc-card small{display:block;color:#64748B;line-height:1.28}.gfc-fc-note{border-radius:12px;padding:12px;background:#F4F7FB;color:#344054;line-height:1.45}.gfc-fc-foot{font-size:12px;margin-bottom:0}@media(max-width:360px){.gfc-fc-grid{grid-template-columns:1fr}}';
    document.head.appendChild(node);
  }
  window.gfcOpenFinancialCoach = function () { style(); open(); };
  window.gfcTryFinancialCoachMessage = localReply;
})();
