'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const ads=require(path.join(__dirname,'..','frontend','yarbi-meta-ads-local.js'));
test('Meta Ads local: normaliza métricas sin atribuir ventas automáticamente',()=>{const rows=ads.parseCsv('campaign,date,spend,impressions,clicks,leads,confirmed_revenue\nCampaña Norte,2026-11-10,120,5000,80,4,480');assert.equal(rows.length,1);assert.equal(rows[0].campaign,'Campaña Norte');assert.equal(ads.summarize(rows).roas,4);});
test('Meta Ads local: no calcula ROAS sin ingreso confirmado',()=>{const summary=ads.summarize([{campaign:'Campaña',spend:100,leads:2,confirmedRevenue:0}]);assert.equal(summary.roas,null);assert.match(ads.answerFromSummary(summary),/No hay ingreso confirmado suficiente/i);});
test('Meta Ads local: solo responde consultas publicitarias explícitas y no hace red',()=>{const source=fs.readFileSync(path.join(__dirname,'..','frontend','yarbi-meta-ads-local.js'),'utf8');assert.equal(ads.requested('¿Qué tengo mañana?'),false);assert.equal(ads.requested('¿Cómo van mis campañas y el ROAS?'),true);assert.doesNotMatch(source,/fetch\s*\(|https?:\/\//);assert.match(source,/no conecta Meta/i);});
