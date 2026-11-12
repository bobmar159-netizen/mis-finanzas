'use strict';

const { configuration, decidePreviewOwnerReferenceRequest } = require('../../lib/preview-owner-reference-policy');
const { authenticatedOwnerIdentity } = require('../../lib/yarbi-owner-ui-auth');
const { verifiedOwnerId } = require('../../lib/yarbi-owner-scope');
const { traceSecret } = require('../../lib/yarbi-trace');
const { MAX_INSTRUCTIONS, safeInstruction, classifyMemoryInput, createProposalToken, readProposalToken, relevantInstructions } = require('../../lib/yarbi-owner-memory');
const { createHistoricalMessageReader, createHistoricalOwnerScopeResolver, planHistoricalOwnerIntelligence } = require('../../lib/yarbi-historical-intelligence');
const { createHistoricalIntelligenceQueue } = require('../../lib/yarbi-historical-intelligence-store');

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function clean(value, limit = 1200) { return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, limit); }
function serviceClient(config, fetchImpl) { return async (path, options = {}) => { const response = await fetchImpl(config.supabaseUrl + path, { ...options, headers: { apikey: config.supabaseKey, Authorization: `Bearer ${config.supabaseKey}`, ...(options.headers || {}) } }); return { response, data: await response.json().catch(() => []) }; }; }
function rows(value) { return Array.isArray(value) ? value.map(safeInstruction).filter(Boolean).slice(0, MAX_INSTRUCTIONS) : []; }
function selectPath(ownerId) { return '/rest/v1/yarbi_owner_instructions?owner_account_id=eq.' + encodeURIComponent(ownerId) + '&deleted_at=is.null&select=id,name,instruction,category,scope,active,origin,source_channel,version,semantic_key,created_at,updated_at&order=updated_at.desc&limit=' + MAX_INSTRUCTIONS; }
function historicalTaskSummary(task) {
  return {
    idempotency_key: clean(task?.idempotency_key, 80), contact_id: Number(task?.contact_id),
    message_count: Array.isArray(task?.message_ids) ? task.message_ids.length : 0,
    outgoing_message_count: Array.isArray(task?.outgoing_message_ids) ? task.outgoing_message_ids.length : 0,
    segment_index: Number(task?.segment_index), segment_count: Number(task?.segment_count),
    occurred_from: Number(task?.occurred_from) || null, occurred_to: Number(task?.occurred_to) || null,
    requires_owner_review: true, commercial_effects_allowed: false
  };
}

function createOwnerMemoryHandler({ fetchImpl = fetch, now = () => Date.now() } = {}) {
  return async function ownerMemoryHandler(req, res) {
    const decision = decidePreviewOwnerReferenceRequest(req, process.env);
    if (!decision.allow) return res.status(decision.status).json({ ok: false, error: decision.code });
    const config = decision.state?.config || configuration(process.env).config;
    const secret = traceSecret(process.env.YARBI_TRACE_HMAC_KEY);
    if (!config || !secret) return res.status(503).json({ ok: false, error: !config ? 'owner_memory_preview_not_configured' : 'trace_hmac_key_missing' });
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : object(req.body);
      if (['owner_id','owner_account_id','ownerid','owneraccountid'].some(key => Object.prototype.hasOwnProperty.call(body, key))) return res.status(400).json({ ok: false, error: 'owner_memory_client_owner_forbidden' });
      const authenticated = await authenticatedOwnerIdentity(req, config, fetchImpl); if (!authenticated.ok) return res.status(authenticated.status).json({ ok: false, error: authenticated.code });
      const ownerId = verifiedOwnerId(authenticated.identity); const supabase = serviceClient(config, fetchImpl); const action = clean(body.action, 32).toLowerCase() || 'list';
      if (action === 'historical-plan' || action === 'historical-enqueue') {
        const requestedLimit = Math.max(1, Math.min(24, Number(body.limit) || 12));
        const plan = await planHistoricalOwnerIntelligence({
          ownerIdentity: authenticated.identity,
          resolveOwnerScope: createHistoricalOwnerScopeResolver({ supabase }),
          readMessages: createHistoricalMessageReader({ supabase }),
          limit: requestedLimit
        });
        const taskSummaries = plan.tasks.map(historicalTaskSummary);
        if (action === 'historical-plan') {
          return res.status(200).json({
            ok: true, outcome: 'historical_plan_ready', source: plan.source,
            counts: plan.counts, tasks: taskSummaries,
            next_step: plan.tasks.length ? 'owner_confirmation_required_to_enqueue' : 'no_new_historical_segments',
            requires_owner_review: true, commercial_effects_allowed: false
          });
        }
        if (body.confirm_historical_preparation !== true) return res.status(400).json({ ok: false, error: 'historical_enqueue_confirmation_required' });
        const queue = createHistoricalIntelligenceQueue({ supabase });
        const entries = [];
        for (const task of plan.tasks) entries.push(await queue.enqueue({ ownerIdentity: authenticated.identity, task }));
        return res.status(200).json({
          ok: true, outcome: 'historical_segments_enqueued', source: plan.source,
          counts: { ...plan.counts, enqueued: entries.filter(entry => entry.outcome === 'created').length, existing: entries.filter(entry => entry.outcome === 'existing').length },
          tasks: entries.map(entry => ({ batch_id: entry.batch_id, outcome: entry.outcome, status: entry.status })),
          requires_owner_review: true, commercial_effects_allowed: false
        });
      }
      const currentResult = await supabase(selectPath(ownerId)); if (!currentResult.response.ok) return res.status(503).json({ ok: false, error: 'owner_memory_store_unavailable' });
      const instructions = rows(currentResult.data);
      if (action === 'list') return res.status(200).json({ ok: true, source: 'supabase_owner_memory', active_count: instructions.filter(row => row.active).length, instructions });
      if (action === 'retrieve') return res.status(200).json({ ok: true, source: 'supabase_owner_memory', instructions: relevantInstructions(instructions, clean(body.query, 500)), active_count: instructions.filter(row => row.active).length });
      if (action === 'propose') {
        const requestedOperation = clean(body.operation, 24).toLowerCase();
        const requestedTarget = instructions.find(row => row.id && row.id === clean(body.instruction_id, 80));
        const source_channel = clean(body.source_channel, 24) === 'voice' ? 'voice' : 'app';
        const direct = requestedTarget && ['edit', 'set_active'].includes(requestedOperation)
          ? { outcome: 'proposal', operation: requestedOperation, target_id: requestedTarget.id, instruction: requestedOperation === 'edit' ? clean(body.instruction, 1200) : requestedTarget.instruction, name: clean(body.name, 120) || requestedTarget.name, category: clean(body.category, 40) || requestedTarget.category, active: requestedOperation === 'set_active' ? body.active !== false : requestedTarget.active, source_channel }
          : null;
        if (requestedOperation && !direct) return res.status(404).json({ ok: false, error: 'owner_memory_instruction_not_found' });
        const result = direct || { ...classifyMemoryInput({ utterance: body.utterance, instructions }), source_channel };
        if (result.outcome !== 'proposal') return res.status(200).json({ ok: true, outcome: result.outcome, code: result.code || null, active_count: instructions.filter(row => row.active).length, instructions: result.outcome === 'list' ? result.instructions : undefined });
        const proposal_token = createProposalToken({ ownerId, proposal: result, secret, now: now() });
        return res.status(200).json({ ok: true, outcome: 'proposal_requires_confirmation', active_count: instructions.filter(row => row.active).length, proposal: { operation: result.operation, name: result.name, instruction: result.instruction, active: result.active !== false, source_channel: result.source_channel }, proposal_token });
      }
      if (action !== 'confirm') return res.status(400).json({ ok: false, error: 'owner_memory_action_invalid' });
      if (body.confirm !== true) return res.status(400).json({ ok: false, error: 'owner_memory_confirmation_required' });
      const checked = readProposalToken({ token: body.proposal_token, ownerId, secret, now: now() }); if (!checked.ok) return res.status(400).json({ ok: false, error: checked.code });
      const proposal = checked.proposal;
      if (proposal.operation === 'create') {
        const duplicate = instructions.find(row => row.semantic_key === proposal.semantic_key);
        if (duplicate) return res.status(200).json({ ok: true, outcome: 'duplicate', instruction: duplicate, active_count: instructions.filter(row => row.active).length });
        const source_channel = proposal.source_channel === 'voice' ? 'voice' : 'app';
        const result = await supabase('/rest/v1/yarbi_owner_instructions', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ owner_account_id: ownerId, name: proposal.name || proposal.instruction.slice(0, 64), instruction: proposal.instruction, category: proposal.category || 'behavior', scope: 'owner', active: true, origin: source_channel === 'voice' ? 'voice_proposed' : 'owner_confirmed', source_channel, semantic_key: proposal.semantic_key, version: 1 }) });
        const row = rows(result.data)[0]; if (!result.response.ok || !row) return res.status(502).json({ ok: false, error: 'owner_memory_persist_failed' });
        return res.status(200).json({ ok: true, outcome: 'created', instruction: row, active_count: instructions.filter(row => row.active).length + 1 });
      }
      const target = instructions.find(row => row.id === proposal.target_id); if (!target) return res.status(404).json({ ok: false, error: 'owner_memory_instruction_not_found' });
      const changes = proposal.operation === 'set_active' ? { active: proposal.active, updated_at: new Date(now()).toISOString() } : { instruction: proposal.instruction, name: proposal.name || target.name, category: proposal.category || target.category, semantic_key: proposal.semantic_key, version: target.version + 1, updated_at: new Date(now()).toISOString() };
      const result = await supabase('/rest/v1/yarbi_owner_instructions?id=eq.' + encodeURIComponent(target.id) + '&owner_account_id=eq.' + encodeURIComponent(ownerId), { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(changes) });
      const row = rows(result.data)[0]; if (!result.response.ok || !row) return res.status(502).json({ ok: false, error: 'owner_memory_persist_failed' });
      return res.status(200).json({ ok: true, outcome: proposal.operation === 'set_active' ? (proposal.active ? 'activated' : 'deactivated') : 'updated', instruction: row, active_count: [...instructions.filter(item => item.id !== target.id), row].filter(item => item.active).length });
    } catch (error) { return res.status(502).json({ ok: false, error: clean(error?.code || error?.message || 'owner_memory_failed', 96) }); }
  };
}

module.exports = createOwnerMemoryHandler();
module.exports.createOwnerMemoryHandler = createOwnerMemoryHandler;
