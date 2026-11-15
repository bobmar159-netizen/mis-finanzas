(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YarbiOwnerConversationUi = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function text(value, limit) {
    return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit || 160);
  }
  function presentationText(value, limit) {
    const cleaned = String(value ?? '')
      .replace(/\r\n?/g, '\n')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
      .trim();
    const characters = Array.from(cleaned);
    return characters.length > (limit || 4000) ? characters.slice(0, limit || 4000).join('') : cleaned;
  }
  function candidateLabel(row, index) {
    const name = text(row?.display_name, 120) || 'Cliente sin nombre';
    const details = [text(row?.district, 70), text(row?.latest_service, 90)].filter(Boolean);
    return `${index + 1}. **${name}**${details.length ? ` · ${details.join(' · ')}` : ''}`;
  }
  // Solo presenta datos que el handler ya devolvió tras validar sesión y scope.
  // No interpreta IDs, no crea foco y no vuelve a consultar contactos.
  function formatReply(response) {
    const source = response && typeof response === 'object' ? response : {};
    const reply = presentationText(source.reply, 4000) || 'No tengo una respuesta verificable todavía.';
    const results = Array.isArray(source.crm_search?.results) ? source.crm_search.results.slice(0, 12) : [];
    if (!results.length) return reply;
    const lines = results.map(candidateLabel);
    return `${reply}\n\n### Coincidencias verificadas\n\n${lines.join('\n')}\n\nPuedes decir, por ejemplo, **“el segundo cliente”** o añadir una pista como distrito, servicio o una referencia reciente.`;
  }
  return Object.freeze({ formatReply, candidateLabel, presentationText });
});
