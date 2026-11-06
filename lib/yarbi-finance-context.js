'use strict';

// F04 keeps financial facts separate from commercial intent. A quotation is
// never income, and a receivable remains canonical whenever it is available.
// This module is pure: import/sync callers must preview their changes first.
const FINANCE_SCHEMA = 'yarbi.finance-context.v1';

function text(value, limit = 400) { return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit); }
function rows(value) { return Array.isArray(value) ? value : []; }
function number(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : null;
  const raw = text(value, 80).replace(/,/g, '.');
  if (!/^(?:S\/\.?\s*)?\d+(?:\.\d{1,2})?$/.test(raw)) return null;
  const parsed = Number(raw.replace(/^S\/\.?\s*/i, ''));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : null;
}
function dateValue(value) { const parsed = Date.parse(value || ''); return Number.isFinite(parsed) ? parsed : 0; }
function positiveId(value) { const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null; }

function receivableState(row = {}) {
  const explicit = text(row.status, 60).toLowerCase();
  if (/cancel|anulad|void/.test(explicit)) return 'cancelled';
  if (/no.?aplica|not.?applicable/.test(explicit)) return 'not_applicable';
  const agreed = number(row.agreed_amount);
  const paid = number(row.paid_amount) || 0;
  const balance = number(row.balance_amount);
  if (explicit === 'paid' || (agreed != null && balance === 0 && paid >= agreed)) return 'paid';
  if (explicit === 'partial' || paid > 0) return 'partial';
  return 'pending';
}

function paymentKey(row = {}) {
  const contactId = positiveId(row.contact_id) || 0;
  const stable = text(row.external_id || row.receivable_id || row.agenda_event_id || row.dedupe_key || row.id, 120);
  return stable ? `payment:${contactId}:${stable}` : '';
}

function normalizeReceivable(row = {}) {
  const state = receivableState(row);
  return { id: row.id == null ? null : String(row.id), contact_id: positiveId(row.contact_id), agenda_event_id: row.agenda_event_id == null ? null : String(row.agenda_event_id), agreed_amount: number(row.agreed_amount), paid_amount: number(row.paid_amount) || 0, balance_amount: number(row.balance_amount), state, next_action: text(row.next_action, 300) || null, next_action_due: text(row.next_action_due, 40) || null, source: text(row.source, 100) || 'receivable', updated_at: row.updated_at || null, payment_key: paymentKey(row) };
}

function normalizeQuote(row = {}, contactId) {
  const extracted = row.extracted_data && typeof row.extracted_data === 'object' ? row.extracted_data : {};
  const amount = number(extracted.quote_amount ?? extracted.quote ?? extracted.price ?? extracted.amount ?? row.amount);
  if (amount == null) return null;
  const rawStatus = text(extracted.quote_status ?? extracted.status ?? row.quote_status ?? row.status, 60).toLowerCase();
  const status = /reject|declin|cancel|anulad/.test(rawStatus) ? 'rejected' : /accept|approved|ganad/.test(rawStatus) ? 'accepted' : /expire|vencid/.test(rawStatus) ? 'expired' : /draft|borrador/.test(rawStatus) ? 'draft' : 'recorded';
  const sourceId = row.id == null ? null : String(row.id);
  return { id: sourceId, contact_id: positiveId(row.contact_id) || contactId || null, amount, version: positiveId(row.analysis_version) || 1, status, service: text(extracted.service ?? row.service, 160) || null, at: row.completed_at || row.updated_at || row.created_at || null, source: 'analysis', dedupe_key: `quote:${sourceId || [contactId || '', text(extracted.service, 80), amount, row.analysis_version || 1].join(':')}` };
}

function uniqueLatest(items, keyOf) {
  const index = new Map();
  for (const item of items) { const key = keyOf(item); const prior = key && index.get(key); if (key && (!prior || dateValue(item.updated_at || item.at) > dateValue(prior.updated_at || prior.at))) index.set(key, item); }
  return [...index.values()];
}

function normalizedMovements(rowsValue, contactId) {
  return uniqueLatest(rows(rowsValue).filter(row => positiveId(row.contact_id) === contactId).map(row => ({ id: row.id == null ? null : String(row.id), contact_id: contactId, amount: number(row.amount ?? row.total), type: text(row.type ?? row.kind, 40).toLowerCase(), status: text(row.status, 40).toLowerCase(), at: row.occurred_at || row.date || row.updated_at || null, source: text(row.source, 80) || 'movement', payment_key: paymentKey(row) })).filter(row => row.amount != null), row => row.payment_key || `movement:${row.id || row.at}`);
}

function buildFinanceContext({ contactId, analyses, receivables, movements } = {}) {
  const canonicalContactId = positiveId(contactId);
  if (!canonicalContactId) return { schema: FINANCE_SCHEMA, outcome: 'contact_id_invalid', summary: null, quotes: [], receivables: [], movements: [], source_status: {} };
  const scopedReceivables = uniqueLatest(rows(receivables).filter(row => positiveId(row.contact_id) === canonicalContactId).map(normalizeReceivable), row => row.payment_key || `receivable:${row.id || row.agenda_event_id || ''}`);
  const quotes = uniqueLatest(rows(analyses).filter(row => positiveId(row.contact_id) === canonicalContactId).map(row => normalizeQuote(row, canonicalContactId)).filter(Boolean), row => row.dedupe_key).sort((left, right) => dateValue(right.at) - dateValue(left.at));
  const scopedMovements = normalizedMovements(movements, canonicalContactId);
  const active = scopedReceivables.filter(row => !['cancelled', 'not_applicable'].includes(row.state));
  const canonicalCollected = active.reduce((total, row) => total + row.paid_amount, 0);
  const balance = active.reduce((total, row) => total + (row.balance_amount || 0), 0);
  const linkedPaymentKeys = new Set(active.map(row => row.payment_key).filter(Boolean));
  const standaloneIncome = scopedMovements.filter(row => /^(income|ingreso)$/.test(row.type) && !/cancel|void|anulad/.test(row.status) && (!row.payment_key || !linkedPaymentKeys.has(row.payment_key)));
  const movementIncome = standaloneIncome.reduce((total, row) => total + row.amount, 0);
  const incomeSource = active.length ? 'receivables' : (scopedMovements.length ? 'movements' : 'unavailable');
  const latestQuote = quotes[0] || null;
  const overdue = active.filter(row => row.balance_amount > 0 && row.next_action_due && dateValue(row.next_action_due) < Date.now()).length;
  return { schema: FINANCE_SCHEMA, outcome: 'finance_context_found', contact_id: canonicalContactId, quotes, receivables: scopedReceivables, movements: scopedMovements, summary: { latest_quote_amount: latestQuote?.amount ?? null, latest_quote_status: latestQuote?.status ?? 'unavailable', collected_amount: Math.round((active.length ? canonicalCollected : movementIncome) * 100) / 100, pending_amount: Math.round(balance * 100) / 100, overdue_receivables: overdue, income_source: incomeSource, quote_is_not_income: true }, source_status: { quotes: quotes.length ? 'available' : 'no_information', receivables: Array.isArray(receivables) ? 'available' : 'unavailable', movements: Array.isArray(movements) ? 'available' : 'unavailable' } };
}

function previewNotionImport(rowsValue, mapping = {}) {
  const externalField = text(mapping.external_id, 80); const contactField = text(mapping.contact_id, 80);
  if (!externalField || !contactField) return { outcome: 'mapping_incomplete', rows: [], accepted: 0, duplicates: 0, invalid: 0 };
  const seen = new Set(); const result = [];
  for (const source of rows(rowsValue)) { const externalId = text(source?.[externalField], 160); const contactId = positiveId(source?.[contactField]); if (!externalId || !contactId) result.push({ outcome: 'invalid', external_id: externalId || null }); else if (seen.has(externalId)) result.push({ outcome: 'duplicate', external_id: externalId, contact_id: contactId }); else { seen.add(externalId); result.push({ outcome: 'preview_ready', external_id: externalId, contact_id: contactId }); } }
  return { outcome: 'preview_complete', rows: result, accepted: result.filter(row => row.outcome === 'preview_ready').length, duplicates: result.filter(row => row.outcome === 'duplicate').length, invalid: result.filter(row => row.outcome === 'invalid').length };
}

module.exports = { FINANCE_SCHEMA, buildFinanceContext, normalizeQuote, normalizeReceivable, paymentKey, previewNotionImport, receivableState };
