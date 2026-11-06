'use strict';

// Lectura única y sanitaria del ledger aislado. No inserta, actualiza ni
// imprime secretos, JWT, teléfonos, textos de conversación o hashes de refs.
const { readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');

const SUPABASE = 'https://uevilhbstnmmdlgyshlv.supabase.co';
const E2E = path.join(__dirname, 'owner-references-preview-e2e-evidence.json');
const OUT = path.join(__dirname, 'owner-references-preview-trace-evidence.json');
const OPERATION = /^op1-owner_reference-[a-z0-9-]+$/i;

function required(name) { const value = String(process.env[name] || '').trim(); if (!value) throw new Error(`missing_${name.toLowerCase()}`); return value; }
function isolatedSecretKey() {
  const value = required('F3REF_SUPABASE_SERVICE_KEY').replace(/^['"]|['"]$/g, '');
  // Solo exigimos el prefijo y que no contenga controles. No imponemos el
  // alfabeto interno: Supabase puede cambiarlo entre versiones de claves.
  // El diagnóstico conserva solo tipo y longitud, jamás la clave.
  if (!value.startsWith('sb_secret_') || /[\x00-\x1F\x7F]/.test(value)) {
    const kind = value.startsWith('sb_publishable_') ? 'publishable' : value.startsWith('sbp_') ? 'access_token' : value.startsWith('sb_secret_') ? 'secret_with_control_char' : 'other';
    const error = new Error(`isolated_service_key_invalid_format_${kind}_length_${value.length}`);
    throw error;
  }
  return value;
}
function value(object, key) { return object && typeof object === 'object' ? object[key] : undefined; }
function containsForbiddenKeys(input) {
  if (!input || typeof input !== 'object') return false;
  return Object.keys(input).some(key => /phone|text|message_body|jwt|token|secret|password/i.test(key))
    || Object.values(input).some(item => item && typeof item === 'object' && containsForbiddenKeys(item));
}
function operationSummary(operationId, rows) {
  const stages = rows.map(row => String(value(row.result_payload, 'stage') || '')).filter(Boolean);
  const closed = stages.filter(stage => stage === 'operation_closed').length;
  const refs = rows.map(row => value(value(row.result_payload, 'refs'), 'contacts')).filter(Array.isArray);
  return {
    operation_id: operationId,
    event_count: rows.length,
    started: stages.includes('reference_lookup_started'),
    terminal: stages.includes('reference_lookup_completed') || stages.includes('reference_lookup_failed'),
    operation_closed_count: closed,
    closed_once: closed === 1,
    refs_present: refs.some(list => list.length > 0),
    forbidden_payload_keys_absent: rows.every(row => !containsForbiddenKeys(value(row, 'request_payload')) && !containsForbiddenKeys(value(row, 'result_payload')))
  };
}

function executionWindow(generatedAt) {
  const end = new Date(generatedAt);
  if (!Number.isFinite(end.getTime())) throw new Error('e2e_generated_at_invalid');
  return { from: new Date(end.getTime() - 20 * 60 * 1000).toISOString(), to: new Date(end.getTime() + 60 * 1000).toISOString() };
}

async function main() {
  const serviceKey = isolatedSecretKey();
  const prior = JSON.parse(await readFile(E2E, 'utf8'));
  const knownIds = [...new Set((prior.requests || []).map(row => String(row?.operation_id || '')).filter(id => OPERATION.test(id)))];
  const expectedOperationCount = (prior.requests || []).filter(row => row?.status === 200 && row?.operation_id_present === true).length + Number(prior?.latency_phone_exact?.n || 0);
  const window = executionWindow(prior.generated_at);
  // La evidencia E2E no retiene IDs para no ampliar datos de trazas. Como
  // alternativa limitada, se lee solo el tipo/componente de este handler y
  // solo dentro de su ventana de ejecución; no se exportan filas ni payloads.
  const scope = knownIds.length
    ? `&target_id=in.(${encodeURIComponent(knownIds.join(','))})`
    : `&created_at=gte.${encodeURIComponent(window.from)}&created_at=lte.${encodeURIComponent(window.to)}&request_payload->>component=eq.owner_reference_candidates&request_payload->>operation_type=eq.authenticated_reference_lookup`;
  const url = `${SUPABASE}/rest/v1/yarbi_agent_actions?module=eq.crm&action_type=eq.observability_trace_event&target_type=eq.trace_operation${scope}&select=target_id,request_payload,result_payload,status`;
  // Las Secret Keys modernas `sb_secret_` se autentican por `apikey`; no se
  // reenvían como Bearer JWT, porque no son JWT y algunos clientes HTTP las
  // rechazan antes de llegar al gateway.
  const response = await fetch(url, { headers: { apikey: serviceKey } });
  if (!response.ok) throw new Error(`ledger_read_failed_${response.status}`);
  const rows = await response.json();
  const operationIds = [...new Set(rows.map(row => String(row?.target_id || '')).filter(id => OPERATION.test(id)))].sort();
  const summaries = operationIds.map(operationId => operationSummary(operationId, rows.filter(row => String(row.target_id) === operationId)));
  const evidence = {
    phase: 'owner_references_preview_trace_read', result: operationIds.length === expectedOperationCount && summaries.every(row => row.started && row.terminal && row.closed_once && row.forbidden_payload_keys_absent) ? 'PASS' : 'FAIL',
    project_ref: 'uevilhbstnmmdlgyshlv', operation_count: operationIds.length, expected_operation_count: expectedOperationCount, window: knownIds.length ? 'operation_ids_from_evidence' : window,
    summaries: summaries.map((summary, index) => ({ ...summary, operation_id: `owner_reference_${index + 1}` })),
    notes: { read_only: true, rows_exported: false, secrets_persisted: false, refs_values_persisted: false, operation_ids_persisted: false }
  };
  await writeFile(OUT, JSON.stringify(evidence, null, 2), { encoding: 'utf8', mode: 0o600 });
  process.stdout.write(JSON.stringify({ phase: evidence.phase, result: evidence.result, evidence: path.basename(OUT), operation_count: evidence.operation_count }) + '\n');
}

main().catch(error => {
  const cause = String(error?.cause?.code || error?.cause?.message || '').replace(/sb_secret_[^\s"']+/gi, '[redacted]').slice(0, 120);
  process.stderr.write(JSON.stringify({ phase: 'owner_references_preview_trace_read', result: 'FAIL', error: String(error?.message || 'unknown').slice(0, 100), network_cause: cause || null }) + '\n');
  process.exitCode = 1;
});
