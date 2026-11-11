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
  function comparablePhone(value) {
    return normalizePhone(value).replace(/^51(?=9\d{8}$)/, '');
  }
  function comparableText(value) {
    return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function timestamp(value) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
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

  function serviceMatches(left, right) {
    const a = comparableText(left), b = comparableText(right);
    return !a || !b || a === b || a.includes(b) || b.includes(a);
  }
  function candidateContact(candidate, contacts) {
    return (contacts || []).find(contact => String(contact?.id || '') === String(candidate?.contact_id || '')) || null;
  }
  function movementMatchesCandidate(candidate, movement, contact) {
    const amount = Number(movement?.amount ?? movement?.monto ?? 0);
    if (!(amount > 0)) return false;
    const kind = comparableText(movement?.type || movement?.tipo || movement?.kind || '');
    if (kind && !/(ingreso|income|cobro|pago|abono)/.test(kind)) return false;
    const candidatePhone = comparablePhone(candidate?.phone);
    const movementPhone = comparablePhone(movement?.phone || movement?.telefono || movement?.contact_phone);
    if (candidatePhone && movementPhone) return candidatePhone === movementPhone;
    if (String(movement?.contact_id || '') && String(movement.contact_id) === String(candidate?.contact_id || '')) return true;
    const contactName = comparableText(contact?.display_name || contact?.full_name || '');
    const movementName = comparableText(movement?.cliente || movement?.contacto || movement?.client_name || '');
    return Boolean(contactName && movementName && (movementName === contactName || movementName.includes(contactName) || contactName.includes(movementName)));
  }
  function withinDays(left, right, days) {
    const a = timestamp(left), b = timestamp(right);
    if (!a || !b) return true;
    return Math.abs(a - b) <= Number(days || 45) * 86400000;
  }
  function reconcileHistoricalCandidates(input = {}) {
    const candidates = Array.isArray(input.candidates) ? input.candidates : [];
    const agenda = Array.isArray(input.agenda) ? input.agenda : [];
    const movements = Array.isArray(input.movements) ? input.movements : [];
    const contacts = Array.isArray(input.contacts) ? input.contacts : [];
    const results = candidates.map(candidate => {
      if (!candidate?.contact_id) return { id:String(candidate?.id || ''), outcome:'needs_contact_match', agenda_matches:[], movement_matches:[] };
      const contact = candidateContact(candidate, contacts);
      const relatedAgenda = agenda.filter(event => String(event?.contact_id || '') === String(candidate.contact_id) && serviceMatches(candidate.service, event?.service || event?.title) && withinDays(candidate.source_timestamp, event?.starts_at || event?.updated_at, 45));
      const relatedMovements = movements.filter(movement => movementMatchesCandidate(candidate, movement, contact) && withinDays(candidate.source_timestamp, movement?.date || movement?.created_at || movement?.updated_at, 45));
      const agendaMatches = relatedAgenda.slice(0, 4).map(event => ({ id:String(event?.id || ''), status:String(event?.status || event?.estado || ''), event_type:String(event?.event_type || event?.tipo || ''), service:String(event?.service || '') }));
      const movementMatches = relatedMovements.slice(0, 4).map(movement => ({ id:String(movement?.id || ''), amount:Number(movement?.amount ?? movement?.monto ?? 0), date:String(movement?.date || movement?.created_at || ''), status:String(movement?.status || movement?.estado || '') }));
      const ambiguous = relatedAgenda.length > 1 || relatedMovements.length > 1;
      let outcome = 'needs_evidence';
      if (ambiguous) outcome = 'ambiguous_evidence';
      else if (candidate.type === 'payment_reported' && relatedMovements.length === 1) outcome = 'movement_match_review';
      else if ((candidate.type === 'visit_mentioned' || candidate.type === 'work_completion_reported') && relatedAgenda.length === 1) outcome = 'agenda_match_review';
      else if (candidate.type === 'service_mentioned' && relatedAgenda.length === 1) outcome = 'agenda_match_review';
      return { id:String(candidate.id || ''), outcome, agenda_matches:agendaMatches, movement_matches:movementMatches, automatic_change:false };
    });
    return {
      schema:'yarbi.historical-reconciliation.v1',
      results,
      totals:results.reduce((counts, result) => { counts[result.outcome] = (counts[result.outcome] || 0) + 1; return counts; }, {}),
      safety:{ automatic_change:false, payment_requires_confirmed_movement:true, agenda_requires_owner_confirmation:true }
    };
  }

  // Estas fichas son contexto revisado por el propietario, no hechos
  // comerciales. Mantener esta proyección separada evita que una frase de un
  // chat histórico se convierta por accidente en un cobro, visita o cierre.
  function buildHistoricalContactProfiles(input = {}) {
    const candidates = Array.isArray(input.candidates) ? input.candidates : [];
    const byContact = new Map();
    candidates.filter(candidate => candidate && candidate.status === 'context_approved' && candidate.contact_id).forEach(candidate => {
      const contactId = String(candidate.contact_id);
      const profile = byContact.get(contactId) || {
        contact_id:contactId,
        schema:'yarbi.historical-contact-context.v1',
        provenance:'owner_reviewed_historical_context',
        observations:[],
        latest_observation_at:0
      };
      const observation = {
        id:String(candidate.id || ''),
        type:String(candidate.type || 'historical_observation'),
        service:candidate.service ? String(candidate.service) : null,
        source_timestamp:timestamp(candidate.source_timestamp) || null,
        provenance:'owner_reviewed_historical_context',
        commercial_fact:false
      };
      if (!profile.observations.some(item => item.id === observation.id)) profile.observations.push(observation);
      profile.latest_observation_at = Math.max(profile.latest_observation_at, observation.source_timestamp || 0);
      byContact.set(contactId, profile);
    });
    const profiles = [...byContact.values()].map(profile => ({
      ...profile,
      observations:profile.observations.slice(-24),
      observation_count:profile.observations.length
    }));
    return {
      schema:'yarbi.historical-contact-profiles.v1',
      profiles,
      safety:{ requires_owner_review:true, commercial_fact:false, automatic_change:false }
    };
  }

  return { reviewHistoricalConversations, reconcileHistoricalCandidates, buildHistoricalContactProfiles, normalizePhone, personKey };
});
