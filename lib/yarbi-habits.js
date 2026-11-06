const HABIT_CATEGORIES = new Set(['communication', 'follow_up', 'scheduling', 'pricing', 'service', 'general']);

function cleanText(value, maximum) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maximum);
}

function cleanMessageIds(value, allowedMessageIds) {
  const allowed = new Set((allowedMessageIds || []).map(String));
  return [...new Set((Array.isArray(value) ? value : []).map(String).filter(id => allowed.has(id)))].slice(0, 20);
}

function habitKey(category, instruction, suppliedKey) {
  const supplied = cleanText(suppliedKey, 96)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (supplied.length >= 4) return cleanText(category, 40) + ':' + supplied;
  const normalized = cleanText(instruction, 500)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return cleanText(category, 40) + ':' + normalized;
}

function normalizeHabitCandidates(value, messages) {
  const outgoingIds = (messages || [])
    .filter(message => message?.metadata?.direction === 'outgoing')
    .map(message => String(message.id));
  const source = Array.isArray(value) ? value : [];
  const seen = new Set();
  const result = [];
  for (const item of source) {
    const instruction = cleanText(item?.instruction, 500);
    const category = HABIT_CATEGORIES.has(String(item?.category || '')) ? String(item.category) : 'general';
    const sourceMessageIds = cleanMessageIds(item?.source_message_ids, outgoingIds);
    const confidence = Number.isFinite(Number(item?.confidence)) ? Math.max(0, Math.min(1, Number(item.confidence))) : 0;
    if (instruction.length < 12 || !sourceMessageIds.length || confidence < 0.65) continue;
    const key = habitKey(category, instruction, item?.habit_key);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push({ habit_key: key, category, instruction, source_message_ids: sourceMessageIds, confidence });
    if (result.length >= 5) break;
  }
  return result;
}

function buildHabitRpcPayload(candidate) {
  return {
    p_owner_key: 'default',
    p_habit_key: candidate.habit_key,
    p_category: candidate.category,
    p_instruction: candidate.instruction,
    p_confidence: candidate.confidence,
    p_source_message_ids: candidate.source_message_ids
  };
}

module.exports = { HABIT_CATEGORIES, habitKey, normalizeHabitCandidates, buildHabitRpcPayload };
