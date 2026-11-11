'use strict';

// Financial Coach is a local, deterministic read model. It deliberately
// separates cash already recorded from quotes, receivables and commitments;
// none of the latter are represented as money available today.
const SCHEMA = 'yarbi.financial-coach.v1';
const LIMA_TIME_ZONE = 'America/Lima';
const DEFAULT_POLICY = Object.freeze({ currency: 'PEN', daily_free_cash_goal: 500 });

function array(value) { return Array.isArray(value) ? value : null; }
function text(value, limit = 160) { return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit); }
function amount(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : null;
  const normalized = text(value, 80).replace(/^S\/\.?\s*/i, '').replace(/,/g, '.');
  return /^\d+(?:\.\d{1,2})?$/.test(normalized) ? Math.round(Number(normalized) * 100) / 100 : null;
}
function round(value) { return Math.round(value * 100) / 100; }
function limaDate(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(text(value, 10))) return text(value, 10);
  const instant = typeof value === 'number' ? value : Date.parse(value || '');
  if (!Number.isFinite(instant)) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone:LIMA_TIME_ZONE, year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(new Date(instant));
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}
function monthOf(value) { const date = limaDate(value); return date ? date.slice(0, 7) : null; }
function todayInLima(now = Date.now()) { return limaDate(now); }
function sourceState(rowsValue) { return array(rowsValue) === null ? 'unavailable' : rowsValue.length ? 'available' : 'no_information'; }
function cancelled(row) { return /cancel|void|anulad|revers/.test(text(row?.status, 80).toLowerCase()); }
function business(row) { return row?.negocio !== false && row?.business !== false && row?.scope !== 'personal'; }
function cashAffecting(row) { return row?.noCashFlow !== true && row?.materialUsoServicio !== true && row?.origenServicioMaterial !== true && row?.stockOperacion !== 'uso_valor' && row?.stockOperacion !== 'devolucion_valor'; }
function transactionType(row) {
  const value = text(row?.type ?? row?.tipo, 32).toLowerCase();
  if (['ingreso', 'income'].includes(value)) return 'income';
  if (['egreso', 'expense'].includes(value)) return 'expense';
  return null;
}
function stableId(row) { return text(row?.id ?? row?.external_id ?? row?.dedupe_key, 140); }
function sameTransaction(left, right) {
  return left.type === right.type && left.amount === right.amount && left.date === right.date && left.business === right.business && left.cash_affecting === right.cash_affecting;
}
function normalizeTransactions(rowsValue) {
  const source = array(rowsValue);
  if (source === null) return { rows:[], invalid:0, duplicates:0, conflicts:0 };
  const ids = new Map(); const rows = []; let invalid = 0; let duplicates = 0; let conflicts = 0;
  for (const raw of source) {
    if (!raw || typeof raw !== 'object' || !business(raw) || cancelled(raw) || !cashAffecting(raw)) continue;
    const type = transactionType(raw); const value = amount(raw.amount ?? raw.total ?? raw.monto); const date = limaDate(raw.date ?? raw.occurred_at ?? raw.created_at);
    if (!type || value === null || !date) { invalid += 1; continue; }
    const normalized = { id:stableId(raw) || null, type, amount:value, date, business:true, cash_affecting:true };
    if (!normalized.id) { rows.push(normalized); continue; }
    const prior = ids.get(normalized.id);
    if (!prior) { ids.set(normalized.id, normalized); rows.push(normalized); continue; }
    if (sameTransaction(prior, normalized)) duplicates += 1;
    else conflicts += 1;
  }
  return { rows, invalid, duplicates, conflicts };
}
function normalizeReceivables(rowsValue) {
  const source = array(rowsValue);
  if (source === null) return { pending:0, invalid:0 };
  let pending = 0; let invalid = 0;
  for (const row of source) {
    if (!row || typeof row !== 'object' || cancelled(row) || /no.?aplica|not.?applicable/.test(text(row.status, 80).toLowerCase())) continue;
    const balance = amount(row.balance_amount ?? row.balance ?? row.pending_amount);
    if (balance === null) { invalid += 1; continue; }
    pending += balance;
  }
  return { pending:round(pending), invalid };
}
function normalizeCommitments(rowsValue) {
  const source = array(rowsValue);
  if (source === null) return { due:0, invalid:0 };
  let due = 0; let invalid = 0;
  for (const row of source) {
    if (!row || typeof row !== 'object' || row.paid === true || row.pagado === true || cancelled(row)) continue;
    const value = amount(row.amount ?? row.monto ?? row.cuotaMonto ?? row.due_amount);
    if (value === null) { invalid += 1; continue; }
    due += value;
  }
  return { due:round(due), invalid };
}
function sumFor(rows, filter) { return round(rows.filter(filter).reduce((total, row) => total + row.amount, 0)); }

function buildFinancialCoach({ transactions, receivables, commitments, policy = {}, now = Date.now() } = {}) {
  const requestedGoal = amount(policy.daily_free_cash_goal);
  const dailyGoal = requestedGoal === null ? DEFAULT_POLICY.daily_free_cash_goal : requestedGoal;
  const currency = text(policy.currency || DEFAULT_POLICY.currency, 12) || DEFAULT_POLICY.currency;
  const today = todayInLima(now); const month = today?.slice(0, 7) || null;
  const transactionResult = normalizeTransactions(transactions);
  const receivableResult = normalizeReceivables(receivables);
  const commitmentResult = normalizeCommitments(commitments);
  const incomeToday = sumFor(transactionResult.rows, row => row.type === 'income' && row.date === today);
  const expenseToday = sumFor(transactionResult.rows, row => row.type === 'expense' && row.date === today);
  const incomeMonth = sumFor(transactionResult.rows, row => row.type === 'income' && monthOf(row.date) === month);
  const expenseMonth = sumFor(transactionResult.rows, row => row.type === 'expense' && monthOf(row.date) === month);
  const freeToday = round(incomeToday - expenseToday);
  const freeMonth = round(incomeMonth - expenseMonth);
  const remainingGoal = round(Math.max(0, dailyGoal - freeToday));
  const sourceStatus = { transactions:sourceState(transactions), receivables:sourceState(receivables), commitments:sourceState(commitments) };
  const dataIssues = transactionResult.invalid + receivableResult.invalid + commitmentResult.invalid + transactionResult.conflicts;
  const recommendations = [];
  if (sourceStatus.transactions === 'unavailable') recommendations.push({ kind:'source_unavailable', execute:false, message:'No hay movimientos disponibles para calcular caja libre.' });
  else if (remainingGoal > 0) recommendations.push({ kind:'daily_goal_gap', execute:false, amount:remainingGoal, message:`Faltan S/ ${remainingGoal.toFixed(2)} para la meta diaria de caja libre.` });
  else recommendations.push({ kind:'daily_goal_met', execute:false, message:'La meta diaria de caja libre está cubierta con movimientos registrados.' });
  if (receivableResult.pending > 0) recommendations.push({ kind:'pending_receivables', execute:false, amount:receivableResult.pending, message:'Hay cobros pendientes; no se cuentan como dinero disponible hasta registrarse.' });
  if (commitmentResult.due > 0) recommendations.push({ kind:'known_commitments', execute:false, amount:commitmentResult.due, message:'Hay compromisos conocidos pendientes; se muestran aparte del dinero ya gastado.' });
  if (dataIssues) recommendations.push({ kind:'data_incomplete', execute:false, message:'Hay registros incompletos o conflictivos que no se usaron en los cálculos.' });
  return {
    schema:SCHEMA, execute:false, time_zone:LIMA_TIME_ZONE, currency, date:today,
    source_status:sourceStatus,
    summary:{
      collected_cash_today:incomeToday, operating_expenses_today:expenseToday, free_cash_today:freeToday,
      collected_cash_month:incomeMonth, operating_expenses_month:expenseMonth, free_cash_month:freeMonth,
      pending_receivables:receivableResult.pending, known_commitments_due:commitmentResult.due,
      projected_free_after_known_commitments:round(freeToday - commitmentResult.due),
      daily_free_cash_goal:dailyGoal, remaining_to_daily_goal:remainingGoal,
      quote_or_receivable_is_not_cash:true
    },
    quality:{ accepted_transactions:transactionResult.rows.length, duplicate_transactions:transactionResult.duplicates, conflicting_transaction_ids:transactionResult.conflicts, incomplete_records:dataIssues },
    recommendations
  };
}

const api = Object.freeze({ SCHEMA, LIMA_TIME_ZONE, DEFAULT_POLICY, buildFinancialCoach, normalizeTransactions, normalizeReceivables, normalizeCommitments });

// The exact same deterministic read model is included in the generated
// frontend build. It has no browser storage, network, or commercial side
// effects; the UI provides a local snapshot explicitly when the owner asks.
if (typeof globalThis !== 'undefined') globalThis.YarbiFinancialCoach = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
