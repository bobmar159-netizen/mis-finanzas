const { validateServerRouteConfig } = require('../../lib/yarbi-runtime-config');
const { authenticateScopedOwner, blockedOwnerInput, scopedContact, scopedFilter } = require('../../lib/yarbi-authenticated-route');
let SUPABASE_URL = '';
let SUPABASE_KEY = '';

async function supabaseRequest(path, options = {}) {
  const response = await fetch(SUPABASE_URL + path, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: 'Bearer ' + SUPABASE_KEY,
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  return { response, data };
}

function money(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : NaN;
}

function cleanSteps(value) {
  return Array.isArray(value) ? value.map(item => String(item || '').trim()).filter(Boolean).slice(0, 5) : [];
}

async function syncCanonicalCollectionContext({ event, agendaEventId, row }) {
  const contactId = Number(event?.contact_id);
  if (!Number.isInteger(contactId) || contactId <= 0) throw new Error('El evento no tiene un contacto canónico para actualizar CRM y memoria');
  const now = new Date().toISOString();
  const hasBalance = row.balance_amount > 0;
  const operationalStatus = hasBalance ? 'cobro_pendiente' : 'cerrado';
  const operationalReason = hasBalance
    ? 'Trabajo realizado; saldo pendiente confirmado en la agenda #' + agendaEventId + '.'
    : 'Trabajo realizado y cobro total confirmado en la agenda #' + agendaEventId + '.';
  const crmSaved = await supabaseRequest('/rest/v1/crm_contacts?id=eq.' + encodeURIComponent(String(contactId)), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ operational_status: operationalStatus, operational_reason: operationalReason, operational_event_at: now })
  });
  if (!crmSaved.response.ok || !crmSaved.data?.[0]?.id) throw new Error('No se pudo actualizar el estado operativo del CRM');
  const crmReadBack = await supabaseRequest('/rest/v1/crm_contacts?id=eq.' + encodeURIComponent(String(contactId)) + '&select=id,operational_status,operational_reason,operational_event_at&limit=1');
  const crmConfirmed = Array.isArray(crmReadBack.data) ? crmReadBack.data[0] : null;
  if (!crmReadBack.response.ok || !crmConfirmed || String(crmConfirmed.operational_status || '') !== operationalStatus || String(crmConfirmed.operational_reason || '') !== operationalReason) {
    throw new Error('El CRM se escribió, pero el read-back no confirmó su estado operativo');
  }

  const memoryRead = await supabaseRequest('/rest/v1/ai_conversation_memory?contact_id=eq.' + encodeURIComponent(String(contactId)) + '&select=*&limit=1');
  if (!memoryRead.response.ok) throw new Error('No se pudo consultar la memoria del cliente');
  const current = Array.isArray(memoryRead.data) ? memoryRead.data[0] : null;
  const marker = '[agenda:' + agendaEventId + ']';
  const retainedSteps = cleanSteps(current?.next_steps).filter(step => !step.startsWith(marker));
  const collectionStep = hasBalance
    ? marker + ' Cobrar saldo pendiente de S/ ' + row.balance_amount.toFixed(2) + (row.next_action_due ? ' antes del ' + row.next_action_due : '') + '.'
    : '';
  const nextSteps = (collectionStep ? [collectionStep, ...retainedSteps] : retainedSteps).slice(0, 5);
  const followUpStatus = hasBalance ? 'cobro_pendiente' : 'cerrado';
  const currentSteps = cleanSteps(current?.next_steps);
  const memoryChanged = String(current?.follow_up_status || '') !== followUpStatus || JSON.stringify(currentSteps) !== JSON.stringify(nextSteps);
  let memoryConfirmed = current;
  if (memoryChanged) {
    const version = Math.max(1, Number(current?.customer_summary_version || 0) + 1);
    const memorySaved = await supabaseRequest('/rest/v1/ai_conversation_memory?on_conflict=contact_id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify([{
        contact_id: contactId,
        summary: String(current?.summary || ''),
        last_interaction_at: now,
        last_ai_interaction_at: current?.last_ai_interaction_at || null,
        customer_summary_version: version,
        latest_intent: current?.latest_intent || null,
        latest_service: current?.latest_service || null,
        follow_up_status: followUpStatus,
        next_steps: nextSteps,
        updated_at: now
      }])
    });
    if (!memorySaved.response.ok || !memorySaved.data?.[0]?.id) throw new Error('No se pudo actualizar la memoria del cliente');
    const versionSaved = await supabaseRequest('/rest/v1/ai_memory_versions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates' },
      body: JSON.stringify([{
        memory_id: memorySaved.data[0].id,
        version,
        summary: String(current?.summary || ''),
        source_processing_run_id: null,
        change_reason: 'cierre diario y saldo confirmado para agenda #' + agendaEventId
      }])
    });
    if (!versionSaved.response.ok && versionSaved.response.status !== 409) throw new Error('No se pudo versionar la memoria del cobro');
    const memoryReadBack = await supabaseRequest('/rest/v1/ai_conversation_memory?contact_id=eq.' + encodeURIComponent(String(contactId)) + '&select=id,contact_id,follow_up_status,next_steps,customer_summary_version&limit=1');
    memoryConfirmed = Array.isArray(memoryReadBack.data) ? memoryReadBack.data[0] : null;
    if (!memoryReadBack.response.ok || !memoryConfirmed || String(memoryConfirmed.follow_up_status || '') !== followUpStatus || JSON.stringify(cleanSteps(memoryConfirmed.next_steps)) !== JSON.stringify(nextSteps)) {
      throw new Error('La memoria se escribió, pero el read-back no confirmó el seguimiento');
    }
  }
  if (!memoryConfirmed?.id) throw new Error('No existe memoria canónica para el cliente');
  return {
    verified: true,
    contact_id: contactId,
    operational_status: operationalStatus,
    memory_id: memoryConfirmed.id,
    memory_updated: memoryChanged,
    follow_up_status: followUpStatus,
    next_steps: nextSteps
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Método no permitido' });
  const runtime = validateServerRouteConfig({ requirePublicAuth: true });
  if (!runtime.ok) return res.status(503).json({ error: 'configuration_invalid', code: runtime.code });
  SUPABASE_URL = runtime.supabaseUrl;
  SUPABASE_KEY = runtime.supabaseKey;

  try {
    const source = req.method === 'POST' && typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.method === 'POST' ? (req.body || {}) : (req.query || {}));
    if (blockedOwnerInput(source)) return res.status(400).json({ error: 'owner_scope_client_input_forbidden' });
    const access = await authenticateScopedOwner(req, runtime, supabaseRequest);
    if (!access.ok) return res.status(access.status).json({ error: access.code });
    const scopeFilter = scopedFilter(access.scope);
    if (!scopeFilter) return res.status(200).json({ ok: true, receivables: [] });
    if (req.method === 'GET') {
      const limit = Math.min(Math.max(Number(req.query?.limit || 30), 1), 100);
      const agendaId = Number(req.query?.agenda_event_id);
      const filter = Number.isInteger(agendaId) && agendaId > 0
        ? '?agenda_event_id=eq.' + encodeURIComponent(String(agendaId)) + '&contact_id=' + scopeFilter
        : '?contact_id=' + scopeFilter + '&status=neq.paid&order=updated_at.desc&limit=' + limit;
      const read = await supabaseRequest('/rest/v1/yarbi_receivables' + filter + '&select=*');
      if (!read.response.ok) throw new Error('No se pudieron consultar los saldos');
      return res.status(200).json({ ok: true, receivables: Array.isArray(read.data) ? read.data : [] });
    }

    const body = source;
    const agendaEventId = Number(body.agenda_event_id);
    const agreedAmount = money(body.agreed_amount);
    const balanceAmount = money(body.balance_amount);
    if (!Number.isInteger(agendaEventId) || agendaEventId <= 0) return res.status(400).json({ error: 'agenda_event_id inválido' });
    if (!(agreedAmount > 0) || !(balanceAmount >= 0) || balanceAmount > agreedAmount) {
      return res.status(400).json({ error: 'Montos inválidos' });
    }
    const eventRead = await supabaseRequest('/rest/v1/agenda_events?id=eq.' + encodeURIComponent(String(agendaEventId)) + '&source=eq.yarbi_form&select=id,contact_id,status&limit=1');
    const event = Array.isArray(eventRead.data) ? eventRead.data[0] : null;
    if (!eventRead.response.ok || !event?.id) return res.status(404).json({ error: 'Evento de agenda no encontrado' });
    if (event.status !== 'completed') return res.status(409).json({ error: 'El trabajo todavía no está confirmado como realizado' });
    if (!event.contact_id) return res.status(409).json({ error: 'El evento no tiene un contacto canónico para actualizar CRM y memoria' });
    if (!scopedContact(access.scope, event.contact_id)) return res.status(403).json({ error: 'owner_scope_forbidden' });

    const paidAmount = money(agreedAmount - balanceAmount);
    const status = balanceAmount === 0 ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid';
    const row = {
      agenda_event_id: agendaEventId,
      contact_id: event.contact_id || null,
      client_name: String(body.client_name || '').trim().slice(0, 240) || null,
      agreed_amount: agreedAmount,
      paid_amount: paidAmount,
      balance_amount: balanceAmount,
      status,
      next_action: balanceAmount > 0 ? String(body.next_action || 'cobrar_saldo_pendiente').trim().slice(0, 500) : null,
      next_action_due: balanceAmount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(String(body.next_action_due || '')) ? body.next_action_due : null,
      source: 'yarbi_daily_close',
      updated_at: new Date().toISOString()
    };
    const saved = await supabaseRequest('/rest/v1/yarbi_receivables?on_conflict=agenda_event_id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify([row])
    });
    const receivable = Array.isArray(saved.data) ? saved.data[0] : null;
    if (!saved.response.ok || !receivable?.id) throw new Error('Supabase no confirmó el saldo');
    const readBack = await supabaseRequest('/rest/v1/yarbi_receivables?id=eq.' + encodeURIComponent(String(receivable.id)) + '&select=id,agenda_event_id,contact_id,client_name,agreed_amount,paid_amount,balance_amount,status,next_action,next_action_due,source&limit=1');
    const confirmed = Array.isArray(readBack.data) ? readBack.data[0] : null;
    const readBackMatches = readBack.response.ok && confirmed &&
      String(confirmed.id) === String(receivable.id) &&
      Number(confirmed.agenda_event_id) === agendaEventId &&
      String(confirmed.contact_id || '') === String(event.contact_id || '') &&
      money(confirmed.agreed_amount) === agreedAmount &&
      money(confirmed.paid_amount) === paidAmount &&
      money(confirmed.balance_amount) === balanceAmount &&
      String(confirmed.status || '') === status &&
      String(confirmed.source || '') === 'yarbi_daily_close';
    if (!readBackMatches) throw new Error('Supabase escribió el saldo, pero el read-back no confirmó sus datos');
    const canonicalUpdates = await syncCanonicalCollectionContext({ event, agendaEventId, row: confirmed });
    return res.status(200).json({ ok: true, receivable: confirmed, readback_verified: true, canonical_updates: canonicalUpdates });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'No se pudo guardar el saldo' });
  }
}
