'use strict';

const crypto = require('crypto');

const PROPOSAL_SCHEMA = 'yarbi.owner-memory-proposal.v1';
const MAX_INSTRUCTIONS = 50;
const STOP = new Set(['a','al','con','de','del','el','en','la','las','lo','los','para','por','que','se','un','una','y','ya','yarbi']);

function text(value, limit = 1200) { return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit); }
function normalized(value) { return text(value, 2000).toLocaleLowerCase('es-PE').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
function terms(value) { return [...new Set(normalized(value).split(' ').filter(word => word.length > 2 && !STOP.has(word)))]; }
function semanticKey(value) { return crypto.createHash('sha256').update(normalized(value)).digest('hex').slice(0, 32); }
function safeInstruction(value) {
  const source = value && typeof value === 'object' ? value : {};
  const instruction = text(source.instruction, 1200);
  if (instruction.length < 8) return null;
  return {
    id: text(source.id, 80) || null,
    instruction,
    name: text(source.name, 120) || instruction.slice(0, 64),
    category: text(source.category, 40) || 'behavior',
    scope: text(source.scope, 40) || 'owner',
    active: source.active !== false,
    origin: text(source.origin, 48) || 'owner_confirmed',
    source_channel: text(source.source_channel, 32) || 'app',
    version: Math.max(1, Number(source.version) || 1),
    created_at: text(source.created_at, 48) || null,
    updated_at: text(source.updated_at, 48) || null,
    semantic_key: text(source.semantic_key, 64) || semanticKey(instruction)
  };
}
function classifyMemoryInput({ utterance, instructions = [] } = {}) {
  const raw = text(utterance, 1200); const value = normalized(raw);
  const active = instructions.map(safeInstruction).filter(Boolean).filter(row => row.active);
  if (!raw) return { outcome: 'invalid', code: 'memory_utterance_required' };
  if (/\b(que cosas|que me has|que te he|muestrame).{0,40}\b(ensenado|enseñado|aprendido|recuerda)/.test(value)) return { outcome: 'list', instructions: active };
  if (/\b(recuerdame|recordatorio|manana|mañana|lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)\b/.test(value)) return { outcome: 'temporary', code: 'memory_temporal_not_permanent' };
  if (/\b(cliente|contacto|telefono|teléfono|cobro|pago|abono|abon[oó]|visita|cotizacion|cotización)\b/.test(value) && !/\b(prefiero|a partir de ahora|recuerda que|instruccion|instrucción)\b/.test(value)) return { outcome: 'commercial_data', code: 'memory_contact_data_not_owner_instruction' };
  if (/\b(envia|envía|cancela|agenda|registra|cobra|paga)\b/.test(value) && !/\b(prefiero|a partir de ahora|recuerda que|instruccion|instrucción)\b/.test(value)) return { outcome: 'business_action', code: 'memory_action_not_instruction' };
  const last = active[0] || null;
  if (/\b(corrige|edita|cambia)\b.*\b(instruccion|instrucción|anterior|preferencia)\b/.test(value)) return last ? { outcome: 'proposal', operation: 'edit', target_id: last.id, instruction: raw, name: last.name, category: last.category } : { outcome: 'clarification', code: 'memory_instruction_target_required' };
  if (/\b(ya no se aplica|desactiva|pausa|olvida esa preferencia)\b/.test(value)) return last ? { outcome: 'proposal', operation: 'set_active', target_id: last.id, active: false, instruction: last.instruction, name: last.name, category: last.category } : { outcome: 'clarification', code: 'memory_instruction_target_required' };
  if (/\b(recuerda que|prefiero|a partir de ahora|de ahora en adelante|instruccion|instrucción|siempre)\b/.test(value)) {
    const instruction = raw.replace(/^(?:yarbi[,;:]?\s*)?(?:recuerda que|a partir de ahora|de ahora en adelante)\s*/i, '').trim() || raw;
    const duplicate = active.find(row => row.semantic_key === semanticKey(instruction));
    return duplicate ? { outcome: 'duplicate', instruction: duplicate } : { outcome: 'proposal', operation: 'create', instruction, name: instruction.slice(0, 64), category: /prefiero|respuestas?|tono|breve|corto/i.test(instruction) ? 'preference' : 'behavior', active: true };
  }
  return { outcome: 'ignored', code: 'memory_not_permanent_instruction' };
}
function hmac(secret, value) { return crypto.createHmac('sha256', String(secret)).update(value).digest('base64url'); }
function proposalChannel(value) { return value === 'voice' ? 'voice' : 'app'; }
function createProposalToken({ ownerId, proposal, secret, now = Date.now() } = {}) {
  if (!ownerId || !secret || !proposal?.operation) throw new Error('memory_proposal_invalid');
  const payload = { schema: PROPOSAL_SCHEMA, owner_id: String(ownerId), proposal: { operation: proposal.operation, target_id: proposal.target_id || null, instruction: text(proposal.instruction, 1200), name: text(proposal.name, 120), category: text(proposal.category, 40), active: proposal.active !== false, source_channel: proposalChannel(proposal.source_channel), semantic_key: semanticKey(proposal.instruction || '') }, exp: Number(now) + (20 * 60 * 1000) };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url'); return `${encoded}.${hmac(secret, encoded)}`;
}
function readProposalToken({ token, ownerId, secret, now = Date.now() } = {}) {
  const [encoded, signature, extra] = String(token || '').split('.');
  const expected = encoded && secret ? hmac(secret, encoded) : '';
  if (!encoded || !signature || extra || !secret || Buffer.byteLength(expected) !== Buffer.byteLength(signature) || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return { ok: false, code: 'memory_proposal_invalid' };
  try {
    const value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (value.schema !== PROPOSAL_SCHEMA || value.owner_id !== String(ownerId) || Number(value.exp) < Number(now) || !value.proposal?.operation) return { ok: false, code: 'memory_proposal_expired_or_forbidden' };
    return { ok: true, proposal: value.proposal };
  } catch (_) { return { ok: false, code: 'memory_proposal_invalid' }; }
}
function relevantInstructions(instructions, query, limit = 8) {
  const queryTerms = terms(query); return instructions.map(safeInstruction).filter(Boolean).filter(row => row.active).map(row => ({ row, score: terms(row.instruction).filter(word => queryTerms.includes(word)).length })).filter(item => item.score > 0).sort((a, b) => b.score - a.score || String(b.row.updated_at || '').localeCompare(String(a.row.updated_at || ''))).slice(0, limit).map(item => item.row);
}

module.exports = { PROPOSAL_SCHEMA, MAX_INSTRUCTIONS, safeInstruction, semanticKey, classifyMemoryInput, createProposalToken, readProposalToken, relevantInstructions };
