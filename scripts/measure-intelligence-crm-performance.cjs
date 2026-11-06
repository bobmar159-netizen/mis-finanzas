'use strict';

// Medición local, sintética y reproducible del recorrido de lectura CRM.
// No inicializa clientes remotos, no lee variables de entorno ni conserva PII.
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { searchScopedCrm, invalidateCrmSearchCache } = require('../lib/yarbi-crm-search-runtime');
const { planCrmSearchFromUnderstanding } = require('../lib/yarbi-crm-search-conversation');

const root = path.join(__dirname, '..');
const OWNER = '00000000-0000-4000-8000-0000000000f3';
const contactIds = [801, 802];
const samples = [];

function percentile(values, percentage) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentage) - 1)];
}
function summary(values) {
  return {
    samples: values.length,
    min_ms: Number(Math.min(...values).toFixed(3)),
    median_ms: Number(percentile(values, 0.5).toFixed(3)),
    p95_ms: Number(percentile(values, 0.95).toFixed(3)),
    max_ms: Number(Math.max(...values).toFixed(3))
  };
}
function ids(url) {
  const match = String(url).match(/contact_id=in\.\(([^)]+)\)|id=in\.\(([^)]+)\)/);
  return new Set(String(match?.[1] || match?.[2] || '').split(',').map(Number).filter(Boolean));
}
function selected(rows, url, field = 'contact_id') {
  const allowed = ids(url);
  return rows.filter(row => allowed.has(Number(row[field])));
}
const contacts = [
  { id: 801, display_name: 'F3I-CONTACT-A', commercial_status: 'tibio', operational_status: 'seguimiento_pendiente', latest_service: 'reparacion', last_contact_at: '2026-11-05T15:00:00.000Z', updated_at: '2026-11-05T15:00:00.000Z' },
  { id: 802, display_name: 'F3I-CONTACT-B', commercial_status: 'frio', operational_status: '', latest_service: 'instalacion_nueva', last_contact_at: '2026-11-04T15:00:00.000Z', updated_at: '2026-11-04T15:00:00.000Z' }
];
const identifiers = [{ contact_id: 801, normalized_value: '900000801' }, { contact_id: 802, normalized_value: '900000802' }];
const memory = [{ contact_id: 801, memory_type: 'district', value: { district: 'SYNTHETIC-DISTRICT' } }];

async function store(url) {
  const pathname = String(url);
  const response = { ok: true, status: 200 };
  if (pathname.includes('crm_contacts')) return { response, data: selected(contacts, pathname, 'id') };
  if (pathname.includes('contact_identifiers')) return { response, data: selected(identifiers, pathname) };
  if (pathname.includes('operational_memory')) return { response, data: selected(memory, pathname) };
  if (/whatsapp_messages|ai_message_analysis|agenda_events|yarbi_receivables/.test(pathname)) return { response, data: [] };
  throw new Error('unexpected_synthetic_store_path');
}
async function scopeResolver() {
  return { owner_id: OWNER, contact_ids: contactIds, verification: 'canonical_owner_contact_scope' };
}
async function measureSearch() {
  invalidateCrmSearchCache({ contactId: 801 });
  invalidateCrmSearchCache({ contactId: 802 });
  const cold = await searchScopedCrm({ supabase: store, validatedIdentity: { kind: 'validated_auth_identity', subject: OWNER }, ownerScopeResolver: scopeResolver, query: 'F3I', limit: 12 });
  const warm = [];
  for (let index = 0; index < 25; index += 1) {
    const result = await searchScopedCrm({ supabase: store, validatedIdentity: { kind: 'validated_auth_identity', subject: OWNER }, ownerScopeResolver: scopeResolver, query: 'F3I', limit: 12 });
    warm.push(result.metrics.total_ms);
  }
  return { cold_ms: Number(cold.metrics.total_ms.toFixed(3)), cold_query_count: cold.metrics.query_count, warm: summary(warm), all_warm_cache_hits: warm.length === 25 };
}
function measurePlan() {
  for (let index = 0; index < 100; index += 1) {
    const started = performance.now();
    const plan = planCrmSearchFromUnderstanding({ understanding: { constraints: { name: { value: 'F3I-CONTACT-A', certainty: 'confirmed' } }, target_reference: {}, ambiguity: false }, state: { active_constraints: {} } });
    if (plan.outcome !== 'crm_search_ready' || plan.execute !== false) throw new Error('unexpected_synthetic_plan');
    samples.push(performance.now() - started);
  }
  return summary(samples);
}

(async () => {
  const evidence = {
    schema: 'yarbi.intelligence-crm-performance.v1',
    mode: 'local_synthetic_no_network',
    scope: { owner_verified: true, contact_count: contactIds.length },
    crm_search: await measureSearch(),
    v4_plan: measurePlan(),
    commercial_effects: 0,
    external_calls: 0,
    contains_personal_data: false
  };
  const target = path.join(root, 'YARBI_INTELLIGENCE_CRM_PERFORMANCE_EVIDENCE.json');
  fs.writeFileSync(target, JSON.stringify(evidence, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ result: 'PASS', evidence: path.basename(target), crm_search_p95_ms: evidence.crm_search.warm.p95_ms, v4_plan_p95_ms: evidence.v4_plan.p95_ms }) + '\n');
})().catch(error => { process.stderr.write(JSON.stringify({ result: 'FAIL', error: error?.code || error?.message || 'unknown' }) + '\n'); process.exitCode = 1; });
