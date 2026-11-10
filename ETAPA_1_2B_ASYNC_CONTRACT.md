# Contrato asíncrono

`YarbiConversationStore.initialize`, `persist`, `listTimeline`, `listOutbox`, `acknowledgeOutbox` y `mergeCloud` devuelven `Promise`.

`persist` resuelve:

- `{ ok:true, code:'persisted', item }` solo después del commit completo de Timeline y Outbox.
- `{ ok:true, code:'idempotent', item }` para contenido inmutable idéntico.
- `{ ok:false, code:'identity_conflict' }` para mismo ID con contenido distinto.

El chat y Gemini Live esperan o manejan explícitamente las promesas. Una indisponibilidad de IndexedDB no habilita una escritura insegura en localStorage. El usuario conserva el texto de entrada; Live conserva el borrador.
