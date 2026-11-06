'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFinanceContext, previewNotionImport, receivableState } = require('../lib/yarbi-finance-context');

test('F04: a quotation is never recognized as collected income', () => {
  const context = buildFinanceContext({ contactId: 11, analyses: [{ id: 1, contact_id: 11, analysis_version: 1, completed_at: '2026-11-05T12:00:00Z', extracted_data: { quote: 'S/ 480.00', quote_status: 'accepted', service: 'instalacion_nueva' } }], receivables: [], movements: [] });
  assert.equal(context.summary.latest_quote_amount, 480);
  assert.equal(context.summary.collected_amount, 0);
  assert.equal(context.summary.quote_is_not_income, true);
});

test('F04: partial payment preserves canonical balance and does not double count a linked movement', () => {
  const context = buildFinanceContext({ contactId: 11, analyses: [], receivables: [{ id: 9, contact_id: 11, agenda_event_id: 70, agreed_amount: 500, paid_amount: 200, balance_amount: 300, status: 'partial', updated_at: '2026-11-05T10:00:00Z' }], movements: [{ id: 4, contact_id: 11, agenda_event_id: 70, type: 'ingreso', amount: 200, status: 'confirmed' }] });
  assert.equal(context.summary.collected_amount, 200);
  assert.equal(context.summary.pending_amount, 300);
  assert.equal(context.summary.income_source, 'receivables');
  assert.equal(context.receivables.length, 1);
});

test('F04: cancelled or not-applicable receivables never create an amount pending', () => {
  assert.equal(receivableState({ status: 'cancelled', balance_amount: 900 }), 'cancelled');
  assert.equal(receivableState({ status: 'no aplica', balance_amount: 900 }), 'not_applicable');
  const context = buildFinanceContext({ contactId: 11, analyses: [], receivables: [{ id: 1, contact_id: 11, status: 'cancelled', balance_amount: 900, paid_amount: 0 }], movements: [] });
  assert.equal(context.summary.pending_amount, 0);
});

test('F04: a local Notion import preview accepts explicit mappings and deduplicates external identities', () => {
  const preview = previewNotionImport([{ notion_id: 'page-1', crm_id: 11 }, { notion_id: 'page-1', crm_id: 11 }, { notion_id: '', crm_id: 11 }], { external_id: 'notion_id', contact_id: 'crm_id' });
  assert.deepEqual({ accepted: preview.accepted, duplicates: preview.duplicates, invalid: preview.invalid }, { accepted: 1, duplicates: 1, invalid: 1 });
  assert.equal(preview.rows[0].outcome, 'preview_ready');
});
