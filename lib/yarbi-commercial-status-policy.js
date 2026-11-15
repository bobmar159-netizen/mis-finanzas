const MAX_EVIDENCE = 12;

function text(value, max = 1800) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalized(value) {
  return text(value).toLocaleLowerCase('es-PE').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function incoming(message) {
  return message && message?.metadata?.direction !== 'outgoing' && message?.metadata?.historical !== true;
}

function evidence(messages, predicate) {
  return (Array.isArray(messages) ? messages : [])
    .filter(incoming)
    .filter(predicate)
    .map(message => String(message.id || '').trim())
    .filter(Boolean)
    .slice(0, MAX_EVIDENCE);
}

function hasLocation(message) {
  const value = normalized([message?.text, message?.maps_url, message?.metadata?.location_district].filter(Boolean).join(' '));
  return Boolean(String(message?.maps_url || '').trim()) || /ubicacion compartida|google\s*maps|maps\.app\.goo\.gl|coordenadas|https?:\/\/.+maps/.test(value);
}

function hotSignal(message) {
  const value = normalized(message?.text);
  return hasLocation(message)
    || /\b(agendemos|agenda(?:r)?|coordinemos|confirmo|confirmada|confirmar|puedes venir|puede venir|ven(?:ga)?\s+(?:hoy|manana)|disponible\s+(?:hoy|manana)|lo quiero|acepto(?:\s+el)?\s+presupuesto|urgente|hoy mismo)\b/.test(value);
}

function coldSignal(message) {
  const value = normalized(message?.text);
  return /\b(no me interesa|ya lo resolvi|ya no lo necesito|no gracias|no deseo|cancel(?:a|o|amos))\b/.test(value);
}

function warmSignal(message) {
  const value = normalized(message?.text);
  return /\b(cuanto cuesta|precio|cotiza(?:cion|r)?|presupuesto|tarifa|informacion|consulta|disponibilidad|quiero (?:una|un|saber|cotizar)|necesito|tengo (?:un|una|problema)|instala(?:r|cion)|repara(?:r|cion)|mantenimiento|terma|gasfiter|visita tecnica)\b/.test(value);
}

// Esta política no adivina ventas: solo clasifica interés a partir de señales
// explícitas del cliente entrante. Una señal más reciente sustituye la anterior;
// ausencia de señal no enfría automáticamente un contacto existente.
function classifyCommercialStatus(messages) {
  const hot = evidence(messages, hotSignal);
  if (hot.length) {
    const location = evidence(messages, hasLocation);
    return {
      commercial_status: 'caliente',
      status_reason: location.length ? 'El cliente compartió ubicación para coordinar.' : 'El cliente expresó intención concreta de coordinar o avanzar.',
      commercial_status_source_message_ids: hot
    };
  }
  const cold = evidence(messages, coldSignal);
  if (cold.length) return {
    commercial_status: 'frio',
    status_reason: 'El cliente expresó que no desea continuar por ahora.',
    commercial_status_source_message_ids: cold
  };
  const warm = evidence(messages, warmSignal);
  if (warm.length) return {
    commercial_status: 'tibio',
    status_reason: 'El cliente consultó por un servicio, precio o disponibilidad.',
    commercial_status_source_message_ids: warm
  };
  return null;
}

function explainCommercialStatus(status, reason) {
  const label = ({ frio:'Frío', tibio:'Tibio', caliente:'Caliente' })[String(status || '').toLowerCase()] || 'Sin clasificar';
  return reason ? `${label} · ${text(reason, 220)}` : label;
}

module.exports = {
  classifyCommercialStatus,
  explainCommercialStatus,
  hasLocation,
  hotSignal,
  warmSignal,
  coldSignal
};
