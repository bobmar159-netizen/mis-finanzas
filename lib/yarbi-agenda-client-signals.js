function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function detectAgendaClientSignal(messages) {
  const patterns = [
    ['cancel', /\b(?:quiero\s+cancelar|cancele(?:mos|n)?|cancela(?:mos|n)?|ya\s+no\s+(?:quiero|necesito|voy\s+a\s+poder)|no\s+voy\s+a\s+continuar|descarto\s+(?:la\s+)?(?:visita|cita|obra|construcci[oó]n))\b/i],
    ['reprogram', /\b(?:reprogram(?:ar|arme|arnos|arla|arlo|emos|en)?|cambiar\s+(?:la\s+)?fecha|otra\s+fecha|otro\s+d[ií]a|mover\s+(?:la\s+)?(?:visita|cita|obra|construcci[oó]n)|(?:la\s+)?(?:visita|cita)\s+(?:para\s+(?:el\s+)?|el\s+)(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo))\b/i],
    ['confirm', /\b(?:confirmo\s+(?:la\s+)?(?:visita|cita|obra|construcci[oó]n)|queda\s+confirmad[oa]|s[ií][, ]+nos\s+vemos|de\s+acuerdo[, ]+(?:los\s+)?espero|los\s+espero\s+(?:ese|el)\s+d[ií]a)\b/i]
  ];
  for (const message of messages || []) {
    if (message?.metadata?.historical || message?.metadata?.direction === 'outgoing') continue;
    const text = clean(message?.text).slice(0, 800);
    for (const [kind, pattern] of patterns) {
      if (pattern.test(text)) return { kind, message_id: String(message.id || ''), text, timestamp: Number(message.timestamp || Date.now()) };
    }
  }
  return null;
}

module.exports = { detectAgendaClientSignal };
