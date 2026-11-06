'use strict';

// Respuestas seguras para consultas que no requieren interpretación de un LLM.
// El módulo es deliberadamente pequeño: si no reconoce una intención con alta
// confianza, devuelve `handled:false` para que el pipeline normal conserve
// Gemini y su comprensión conversacional.

function normalize(value) {
  return String(value ?? '').trim().toLocaleLowerCase('es-PE')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function words(value) { return new Set(normalize(value).split(' ').filter(Boolean)); }
function includesAny(set, values) { return values.some(value => set.has(value)); }

function faqReply(utterance) {
  const text = normalize(utterance);
  const terms = words(text);
  if (!text) return null;

  if (includesAny(terms, ['hola', 'buenas', 'buenos']) && terms.size <= 5) {
    return 'Hola. Puedo buscar clientes, mostrar contexto verificable y ayudarte a preparar una siguiente acción sin ejecutarla por mi cuenta.';
  }
  if (/(?:que|qué).*(?:puedes|haces)|(?:ayuda|ayudame|ayúdame)/.test(text)) {
    return 'Puedo buscar y resumir clientes, revisar contexto comercial verificable, ayudarte a entrenar respuestas y preparar propuestas para tu aprobación.';
  }
  if (/(?:como|cómo).*(?:buscar|encuentro).*(?:cliente|persona)|(?:buscar|encuentra).*(?:cliente|persona)/.test(text)) {
    return 'Puedes buscar por nombre, teléfono, distrito, servicio, estado comercial o una parte de la conversación. Si faltan datos, te pediré el detalle más útil.';
  }
  if (/(?:como|cómo).*(?:entrenar|ensenar|enseñar)|(?:instruccion|instrucciones|regla|reglas).*(?:yarbi|asistente)?/.test(text)) {
    return 'Las instrucciones se revisan antes de quedar activas. Abre Instrucciones o Entrenar Yarbi, escribe la corrección y confirma el guardado cuando estés conforme.';
  }
  if (/(?:memoria|recuerdo|recuerdas).*(?:cliente|conversacion|conversación)?/.test(text)) {
    return 'Uso contexto operativo con procedencia verificable. Si un dato no está confirmado, te lo señalaré en vez de inventarlo.';
  }
  return null;
}

function tryFastLocalOwnerTurn({ utterance, state } = {}) {
  const reply = faqReply(utterance);
  if (!reply) return { handled: false, reason: 'needs_language_model' };
  return {
    handled: true,
    schema: 'yarbi.fast-local.v1',
    source: 'deterministic_faq',
    reply,
    state: state || null,
    proposal: { kind: 'none', execute: false },
    commercial_effects_allowed: false
  };
}

module.exports = { normalize, faqReply, tryFastLocalOwnerTurn };
