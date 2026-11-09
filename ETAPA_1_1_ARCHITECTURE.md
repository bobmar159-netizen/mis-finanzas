# Etapa 1.1 — Arquitectura

`frontend/index.html` conserva el punto de entrada global `gfcAppendCopilotChatMessage`. Tras validar contenido vacío, delega en `gfcAppendCopilotTimelineMessage` cuando `yarbi-memory-center.js` está cargado. Ese hook persiste y deduplica el evento de timeline y llama a `renderTimelineItem`.

Para mensajes textuales normales, `renderTimelineItem` delega en `YarbiConversationRenderer.appendMessage`. El renderer valida y adapta contenido a `yarbi.conversation-content.v1`, y recién entonces crea DOM con `createElement` y `textContent`. Mensajes de tablero ya estructurados conservan su renderer específico.

Flujo: `FAST / STANDARD / DEEP / Gemini → gfcAppendCopilotChatMessage → timeline opcional → YarbiConversationRenderer → DOM seguro`.

El módulo de memoria ya no asigna `window.gfcAppendCopilotChatMessage`. Esto evita la segunda ruta que antes mostraba texto plano y omitía el renderer.

El adaptador Markdown es deliberadamente limitado y lineal: sólo reconoce formatos demostrables; HTML no es Markdown aceptado. El contrato v1 tiene marcas `bold` e `italic`; el código inline se conserva literal hasta que el contrato añada una marca tipada explícita.
