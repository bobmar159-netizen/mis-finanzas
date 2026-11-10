# Arquitectura IndexedDB 1.2B

`yarbi-memory-center.js` conserva las reglas de dominio y el renderer. `yarbi-conversation-store.js` concentra la persistencia:

`entrada de chat / Live → persistTimelineMessage → YarbiConversationStore → IndexedDB → notificación → renderer`.

La red queda después del commit local: la operación remota toma el Outbox ya confirmado y solo lo elimina tras respuesta satisfactoria. No hay red, temporizador ni trabajo prolongado dentro de una transacción IndexedDB.

`gfcAppendCopilotChatMessage` es asíncrona. El envío textual espera almacenar el mensaje del usuario; ante error repone el texto en el campo y muestra un aviso recuperable. La finalización Live inicia su persistencia sin bloquear audio y conserva el borrador hasta que existan tanto almacenamiento como render canónico.

La sincronización remota solo fusiona IDs inexistentes; una diferencia inmutable se registra como conflicto y nunca sobrescribe Timeline.
