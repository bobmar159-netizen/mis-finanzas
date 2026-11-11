'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const coach = require('../lib/yarbi-financial-coach');

function uiWith(input) {
  const window = { YarbiFinancialCoach:coach, gfcGetFinancialCoachInput:() => input };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'frontend', 'yarbi-financial-coach-ui.js'), 'utf8'), { window, Number, String, Intl });
  return window;
}

test('Financial Coach chat replies locally without treating receivables as cash', () => {
  const window = uiWith({
    now:Date.parse('2026-11-10T15:00:00Z'),
    transactions:[{ id:'income', type:'ingreso', amount:380, date:'2026-11-10' }],
    receivables:[{ id:'receivable', balance_amount:220 }],
    commitments:[]
  });
  const response = window.gfcTryFinancialCoachMessage('¿Cómo va mi caja y cuánto tengo por cobrar?');
  assert.equal(response.handled, true);
  assert.match(response.reply, /S\/ 220\.00/);
  assert.match(response.reply, /separado de la caja/i);
  assert.equal(window.gfcTryFinancialCoachMessage('¿Qué pasó con Carlos?'), null);
});

test('Financial Coach UI contains no network client or commercial write path', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'yarbi-financial-coach-ui.js'), 'utf8');
  assert.equal(/fetch\s*\(|XMLHttpRequest|navigator\.sendBeacon|localStorage\.setItem|sessionStorage\.setItem/i.test(source), false);
});

test('the final local chat dispatcher preserves the Financial Coach fast read', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'index.html'), 'utf8');
  const finalDispatcher = source.slice(source.lastIndexOf('window.gfcHandleYarbiLocalCommand = async function'));
  assert.match(finalDispatcher, /gfcTryFinancialCoachMessage/);
  assert.match(finalDispatcher, /kind:'financial_coach'/);
  assert.match(finalDispatcher, /gfcTryAgendaReadMessage/);
  assert.match(finalDispatcher, /kind:'agenda_read'/);
});
