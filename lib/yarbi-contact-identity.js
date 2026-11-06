function normalizeForComparison(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function cleanPersonName(value) {
  const name = String(value || '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/[<>\[\]{}|_=+*#@]/g, ' ')
    .replace(/^[\s,.;:!?"'“”’()-]+|[\s,.;:!?"'“”’()-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  if (name.length < 3 || /\d/.test(name)) return '';
  const letters = (name.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g) || []).length;
  const words = name.split(/\s+/).filter(Boolean);
  if (letters < 3 || words.length > 6) return '';
  const normalized = normalizeForComparison(name);
  if (/^(cliente|cliente whatsapp|whatsapp|desconocido|sin nombre|no se|no sabe)$/.test(normalized)) return '';
  return name;
}

function normalizeDeclaredIdentity(value, messages) {
  if (!value || typeof value !== 'object') return null;
  const incomingIds = new Set((messages || [])
    .filter(message => message?.metadata?.direction !== 'outgoing')
    .map(message => String(message.id)));
  const sourceIds = [...new Set((Array.isArray(value.source_message_ids) ? value.source_message_ids : [])
    .map(String)
    .filter(id => incomingIds.has(id)))];
  const confidence = Number(value.confidence);
  const name = cleanPersonName(value.name);
  if (!name || !sourceIds.length || !Number.isFinite(confidence) || confidence < 0.9) return null;
  return { name, source_message_ids: sourceIds, confidence: Math.min(1, confidence) };
}

function isPlaceholderContactName(value, phone = '') {
  const normalized = normalizeForComparison(value);
  const normalizedPhone = String(phone || '').replace(/\D/g, '');
  if (!normalized) return true;
  if (normalizedPhone && normalized.replace(/\D/g, '') === normalizedPhone) return true;
  return /^(cliente|cliente whatsapp|whatsapp|desconocido|sin nombre|contacto|usuario)(\s+\d+)?$/.test(normalized);
}

function buildContactNamePatch(contact, declaredIdentity, phone = '') {
  const name = cleanPersonName(declaredIdentity?.name);
  if (!name) return { patch: null, reason: 'no_verified_name' };
  const currentDisplay = String(contact?.display_name || '').trim();
  const currentFull = String(contact?.full_name || '').trim();
  const target = normalizeForComparison(name);
  const protectedSource = /^(manual|phonebook|android_phonebook|yarbi_form|user)$/i.test(String(contact?.source || contact?.name_source || '').trim());
  if (protectedSource && !isPlaceholderContactName(currentDisplay, phone) && !isPlaceholderContactName(currentFull, phone)) {
    return { patch: null, reason: 'manual_name_preserved' };
  }
  if (normalizeForComparison(currentDisplay) === target && normalizeForComparison(currentFull) === target) {
    return { patch: null, reason: 'already_current' };
  }
  const displayPlaceholder = isPlaceholderContactName(currentDisplay, phone);
  const fullPlaceholder = isPlaceholderContactName(currentFull, phone);
  if (displayPlaceholder && fullPlaceholder) {
    return { patch: { display_name: name, full_name: name }, reason: 'placeholder_replaced' };
  }
  if (normalizeForComparison(currentDisplay) === target) {
    return { patch: null, reason: 'display_already_current' };
  }
  // A directly declared name becomes the searchable display name. Keep the
  // previous full name as a safe alias instead of destroying existing data.
  return { patch: { display_name: name }, reason: 'display_name_promoted_full_name_preserved' };
}

module.exports = {
  normalizeForComparison,
  cleanPersonName,
  normalizeDeclaredIdentity,
  isPlaceholderContactName,
  buildContactNamePatch
};
