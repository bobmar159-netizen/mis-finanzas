const STYLE_CATEGORIES = new Set(['tone', 'brevity', 'greeting', 'follow_up', 'pricing', 'scheduling', 'objection', 'closing', 'formatting']);

function cleanText(value, maximum) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maximum);
}

function cleanMessageIds(value, allowedMessageIds) {
  const allowed = new Set((allowedMessageIds || []).map(String));
  return [...new Set((Array.isArray(value) ? value : []).map(String).filter(id => allowed.has(id)))].slice(0, 30);
}

function styleKey(category, guidance, suppliedKey) {
  const supplied = cleanText(suppliedKey, 96).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  if (supplied.length >= 4) return cleanText(category, 40) + ':' + supplied;
  const normalized = cleanText(guidance, 500).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 96);
  return cleanText(category, 40) + ':' + normalized;
}

function normalizeReplyStylePatterns(value, messages) {
  const outgoingIds = (messages || []).filter(message => message?.metadata?.direction === 'outgoing').map(message => String(message.id));
  const source = Array.isArray(value) ? value : [];
  const seen = new Set();
  const result = [];
  for (const item of source) {
    const guidance = cleanText(item?.guidance, 500);
    const category = STYLE_CATEGORIES.has(String(item?.category || '')) ? String(item.category) : 'tone';
    const sourceMessageIds = cleanMessageIds(item?.source_message_ids, outgoingIds);
    const confidence = Number.isFinite(Number(item?.confidence)) ? Math.max(0, Math.min(1, Number(item.confidence))) : 0;
    if (guidance.length < 12 || !sourceMessageIds.length || confidence < 0.7) continue;
    const key = styleKey(category, guidance, item?.pattern_key);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push({ pattern_key: key, category, guidance, source_message_ids: sourceMessageIds, confidence });
    if (result.length >= 8) break;
  }
  return result;
}

function buildReplyStyleRpcPayload(pattern) {
  return { p_owner_key: 'default', p_pattern_key: pattern.pattern_key, p_category: pattern.category, p_guidance: pattern.guidance, p_confidence: pattern.confidence, p_source_message_ids: pattern.source_message_ids };
}

function sanitizeStyleExample(value) {
  return cleanText(value, 600)
    .replace(/https?:\/\/\S+/gi, '[enlace]')
    .replace(/\b(?:\+?51\s*)?9\d{8}\b/g, '[telefono]')
    .replace(/\b(?:S\/?\.?\s*)?\d+(?:[.,]\d{1,2})?\s*(?:sol(?:es)?|pen)\b/gi, '[monto]')
    .replace(/\b\d{1,2}[/:.-]\d{1,2}(?:[/:.-]\d{2,4})?\b/g, '[fecha]')
    .replace(/\b\d{1,2}:\d{2}\s*(?:a\.?\s*m\.?|p\.?\s*m\.?)?\b/gi, '[hora]');
}

module.exports = { STYLE_CATEGORIES, styleKey, normalizeReplyStylePatterns, buildReplyStyleRpcPayload, sanitizeStyleExample };
