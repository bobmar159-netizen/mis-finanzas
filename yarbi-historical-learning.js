(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.gfcYarbiHistoricalLearning = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const SERVICE_SIGNALS = [
    ['instalacion_nueva', /\b(instala(?:cion|r)?|terma nueva|gas natural)\b/i],
    ['punto_adicional', /\b(punto adicional|punto extra)\b/i],
    ['modificacion_tuberia', /\b(modifica(?:cion|r)?|tuberia|tuber[ií]as)\b/i],
    ['conversion_artefacto', /\b(conversi[oó]n|convertir|artefacto)\b/i],
    ['reparacion', /\b(reparaci[oó]n|reparar|arreglo|fuga)\b/i]
  ];

  function clean(value) { return String(value || '').trim(); }
  function personKey(value) {
    return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9+]/g, '');
  }
  function normalizePhone(value) {
    const digits = clean(value).replace(/\D/g, '');
    return digits.length >= 8 && digits.length <= 15 ? digits : '';
  }
  function phoneIn(values) {
    for (const value of values || []) {
      const match = clean(value).match(/\+?\d[\d\s().-]{6,}\d/);
      const phone = normalizePhone(match ? match[0] : '');
      if (phone) return phone;
    }
    return '';
  }
  function serviceSignal(text) {
    return SERVICE_SIGNALS.find(([, pattern]) => pattern.test(clean(text)))?.[0] || null;
  }
  function has(text, pattern) { return pattern.test(clean(text)); }
  function eventSignals(message, index, role) {
    const text = clean(message?.text);
    if (!text) return [];
    const signals = [];
    const service = serviceSignal(text);
    if (service) signals.push({ type:'service_mentioned', service, confidence:role === 'owner' ? 'medium' : 'low' });
    if (has(text, /\b(visita|visitar|paso por|voy (?:a )?ver|coordin(?:ar|amos))\b/i)) {
      signals.push({ type:'visit_mentioned', confidence:role === 'owner' ? 'medium' : 'low' });
    }
    if (has(text, /\b(termin(?:ado|amos|e)|qued[oó] listo|instal(?:ado|amos)|trabajo listo)\b/i)) {
      signals.push({ type:'work_completion_reported', confidence:role === 'owner' ? 'medium' : 'low' });
    }
    if (has(text, /(?:\b(?:pag(?:o|u[eé]|ado|ar)|abon(?:o|[ée]|ado))\b|\bcancel(?:o|ó|é|ado)(?=[\s.,;!?]|$))/i) || /S\/\s*\d|\b\d+(?:[.,]\d{1,2})?\s*soles\b/i.test(text)) {
      signals.push({ type:'payment_reported', confidence:'low' });
    }
    return signals.map(signal => ({ ...signal, source_message_index:index, requires_reconciliation:true, automatic_change:false }));
  }
  function conversationReview(conversation, ownerKey) {
    const messages = Array.isArray(conversation?.messages) ? conversation.messages.filter(message => clean(message?.sender) && clean(message?.text)) : [];
    const participants = [...new Set(messages.map(message => clean(message.sender)))];
    const ownerMessages = messages.filter(message => personKey(message.sender) === ownerKey);
    const counterparties = participants.filter(name => personKey(name) !== ownerKey);
    const phone = phoneIn([conversation?.name, ...counterparties, ...participants]);
    const directConversation = counterparties.length === 1;
    const identityState = directConversation && phone ? 'candidate_phone_match' : directConversation ? 'needs_contact_match' : 'ambiguous_participants';
    const eventCandidates = messages.flatMap((message, index) => eventSignals(message, index, personKey(message.sender) === ownerKey ? 'owner' : 'counterparty'));
    const replyPairs = [];
    messages.forEach((message, index) => {
      if (personKey(message.sender) === ownerKey) return;
      const next = messages.slice(index + 1, Math.min(messages.length, index + 4)).find(candidate => personKey(candidate.sender) === ownerKey);
      if (next) replyPairs.push({ incoming_index:index, outgoing_index:messages.indexOf(next) });
    });
    return {
      source_name:clean(conversation?.name) || 'Conversación sin nombre',
      messages:messages.length,
      owner_messages:ownerMessages.length,
      counterparty_names:counterparties,
      phone_candidate:phone || null,
      identity_state:identityState,
      identity_confidence:identityState === 'candidate_phone_match' ? 'medium' : identityState === 'needs_contact_match' ? 'low' : 'none',
      style_pairs:replyPairs.slice(0, 80),
      event_candidates:eventCandidates.slice(0, 120)
    };
  }
  function reviewHistoricalConversations(input = {}) {
    const ownerName = clean(input.owner);
    const ownerKey = personKey(ownerName);
    if (!ownerKey) throw new Error('historical_owner_required');
    const conversations = (Array.isArray(input.conversations) ? input.conversations : []).map(conversation => conversationReview(conversation, ownerKey));
    const eventCandidates = conversations.flatMap(conversation => conversation.event_candidates);
    const replyPairs = conversations.reduce((sum, conversation) => sum + conversation.style_pairs.length, 0);
    const identity = conversations.reduce((counts, conversation) => {
      counts[conversation.identity_state] = (counts[conversation.identity_state] || 0) + 1;
      return counts;
    }, {});
    return {
      schema:'yarbi.historical-import-review.v1',
      outcome:'review_required',
      owner_name:ownerName,
      conversations,
      totals:{
        conversations:conversations.length,
        messages:conversations.reduce((sum, conversation) => sum + conversation.messages, 0),
        owner_messages:conversations.reduce((sum, conversation) => sum + conversation.owner_messages, 0),
        reply_pairs:replyPairs,
        event_candidates:eventCandidates.length,
        identity
      },
      safety:{
        automatic_crm_updates:false,
        automatic_agenda_updates:false,
        automatic_finance_updates:false,
        payment_requires_movement_reconciliation:true,
        completion_requires_owner_confirmation:true
      }
    };
  }

  return { reviewHistoricalConversations, normalizePhone, personKey };
});
