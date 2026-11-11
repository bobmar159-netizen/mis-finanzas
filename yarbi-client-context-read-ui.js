/* Client dossier FAST read adapter.
   It reads only the already-authorized local mirror and never creates,
   modifies, sends, or synchronizes commercial data. */
(function attachClientContextReadUi(root) {
  'use strict';

  function isReadQuestion(text) {
    return typeof root.YarbiClientContextRead?.requestedReadKind === 'function'
      ? root.YarbiClientContextRead.requestedReadKind(text)
      : null;
  }

  function focusForRead() {
    const focus = typeof root.gfcYarbiConversationFocusRead === 'function'
      ? root.gfcYarbiConversationFocusRead({ allowStale: true })
      : null;
    return focus?.confirmed !== false && (focus?.phone || focus?.contact_id || focus?.client_name) ? focus : null;
  }

  async function resolvedLocalContext(text) {
    const explicit = typeof root.gfcYarbiLiveClientQueryIntent === 'function'
      ? root.gfcYarbiLiveClientQueryIntent(text)
      : null;
    const focus = focusForRead();
    const requestedName = explicit?.client_name || '';
    if (!requestedName && !focus) return { context: null, explicit: false };
    if (typeof root.gfcYarbiLocalFindMemory !== 'function') return { context: null, explicit: Boolean(requestedName) };
    const context = await root.gfcYarbiLocalFindMemory({
      phone: requestedName ? '' : (focus?.phone || ''),
      client_name: requestedName || focus?.client_name || ''
    });
    if (context && !context.requires_disambiguation && requestedName && typeof root.gfcYarbiConversationFocusFromMemory === 'function') {
      root.gfcYarbiConversationFocusFromMemory(context, { client_name: requestedName }, 'client-context-local-read');
    }
    return { context: context ? { ...context, focus } : null, explicit: Boolean(requestedName) };
  }

  root.gfcTryClientContextReadMessage = async function gfcTryClientContextReadMessage(text) {
    if (!isReadQuestion(text) || !root.YarbiClientContextRead?.replyForContext) return null;
    const resolved = await resolvedLocalContext(text);
    if (!resolved.context) {
      if (!resolved.explicit) return null;
      return { handled: true, kind: 'client_context_read', reply: 'No tengo una copia local verificable de ese cliente todavía. Dame una pista como distrito, servicio o una conversación reciente; no usaré otro entorno ni inventaré datos.' };
    }
    if (resolved.context.requires_disambiguation && typeof root.gfcAgendaDisambiguationReply === 'function') {
      return { handled: true, kind: 'client_context_read', reply: root.gfcAgendaDisambiguationReply(resolved.context.candidates || [], '') };
    }
    const result = root.YarbiClientContextRead.replyForContext({ utterance: text, context: resolved.context });
    return result ? { handled: true, kind: 'client_context_read', reply: result.reply, outcome: result.outcome, facts: result.facts || null } : null;
  };
})(window);
