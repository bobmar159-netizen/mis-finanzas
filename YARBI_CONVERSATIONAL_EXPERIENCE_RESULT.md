# Yarbi — experiencia conversacional y renderer

**Fecha:** 2026-11-16
**Rama:** `codex/yarbi-core-domain`
**Base:** `0833feb5982219208b684d08a96a242e3d2b0559`

## Resultado

Se amplió el chat existente. No se creó otro chat, asistente, motor documental ni memoria. La presentación ahora utiliza el contrato `yarbi.conversation-content.v2`, manteniendo compatibilidad con v1 y con respuestas de texto anteriores.

La causa concreta de varias respuestas que se veían planas era que los adaptadores locales de Finanzas, Agenda y CRM producían o podían producir datos organizados, pero el despachador los reducía a texto antes de mostrarlos. Además, la pizarra CRM podía producir una salida con efecto lateral aparte del resumen que devolvía. Ahora las lecturas CRM generan una sola respuesta con presentación tipada; el chat y Live conservan esa presentación al agregar y guardar el mensaje.

## Qué quedó conectado

- **Renderer único:** texto heredado y Markdown seguro se convierten a bloques; las respuestas tipadas pasan por validación antes de representarse. HTML, propiedades inesperadas y bloques inválidos se degradan a contenido seguro mediante nodos DOM y `textContent`.
- **Bloques:** encabezados, párrafos con énfasis, listas, checklists, tablas, chips, paneles, citas, extractos, referencias, métricas, tarjetas CRM/Agenda/Finanzas, recomendaciones, ejemplos y pasos siguientes. Se aplican límites de tamaño, bloques y campos.
- **Documentos:** el tutor produce una respuesta breve, extracto, explicación y referencia. Nombre, sección y página se muestran solo cuando la evidencia los proporciona; no se inventan páginas. Se distingue literal, resumen e interpretación.
- **CRM:** expedientes locales se representan como tarjeta de cliente con hechos pertinentes al tipo de consulta e historial disponible. La pizarra local puede presentar prioridades y eventos en tarjetas. La lectura sigue siendo local y de solo lectura.
- **Agenda:** respuestas de mañana, visitas pendientes y seguimientos muestran tarjetas de actividad con cliente, fecha, hora, estado y distrito disponibles. Los datos ausentes no se completan por inferencia.
- **Finanzas:** las lecturas locales muestran métricas y detalle; cobranza pendiente permanece separada del efectivo.
- **Texto y voz:** una respuesta textual usa el renderer canónico. Las respuestas de herramientas Live y el tutor documental conservan bloques en la finalización y persistencia; respuestas Live sin bloques se convierten desde texto por el mismo adaptador.
- **Historial:** la presentación tipada se guarda junto al texto en IndexedDB, vinculada a la identidad inmutable del mensaje. Ya existen conversaciones separadas, búsqueda local, nueva conversación, título, borrado confirmado, carga paginada de mensajes anteriores y exportación JPG local. Al abrir el chat se muestra el final; cargar mensajes previos conserva la posición de lectura.
- **Móvil:** se añadieron contenedores tenues para tarjetas, métricas, fuentes y extractos, con reglas responsivas. El compositor multilínea, chips de estado y la lógica de scroll existente permanecen en la misma superficie.

## Compatibilidad y límites

- No se cambió ningún contrato HTTP ni se añadió una migración. El endpoint remoto de historial no tiene un contrato tipado/versionado para la presentación; los bloques se conservan localmente y, al recuperar texto remoto, el renderer puede presentarlo como texto/Markdown.
- Gemini general todavía entrega texto en el recorrido existente; ese texto se transforma de forma segura a bloques. No se impuso JSON al modelo ni se creó otro pipeline.
- `image_reference` tiene representación de referencia/placeholder; la visualización ampliada del archivo o recorte real aún no está conectada.
- El historial guarda una posición de scroll por conversación, pero el helper de restauración de esa posición no está conectado al recorrido de apertura. La apertura normal sigue llevando al último mensaje, como pide la UX del chat. La restauración exacta de posición al reabrir una conversación elegida y entre pestañas queda pendiente.
- La búsqueda del historial y el borrado de conversaciones operan sobre la copia local; no se declara búsqueda/borrado sincronizado en nube.
- No hay un flujo visual streaming/SSE para respuestas de texto generales. Live conserva borradores parciales y su finalización canónica; el streaming visual de texto queda pendiente.
- No se realizó validación visual física en Samsung A54, build web, build Android ni generación de APK. La respuesta visual móvil está implementada en código y probada estructuralmente, pero no certificada en dispositivo.
- La prueba PDF.js muestra una advertencia sobre `standardFontDataUrl`; la extracción sintética y su test pasan. No se evaluó visualmente un PDF comercial en dispositivo.

## Verificación ejecutada

- **132/132** pruebas focalizadas PASS, 0 FAIL. Incluyen renderer, persistencia local, Live, tutor documental, CRM, Agenda, Finanzas y regresiones cercanas.
- `node --check` en los módulos JavaScript modificados: PASS.
- `node tests/validate-inline-scripts.js frontend/index.html`: **8 scripts válidos**.
- `git diff --check`: sin errores de whitespace. Git informa que algunos archivos LF se normalizarán a CRLF en una futura operación; no se normalizaron manualmente.
- No se ejecutó la suite global ni se midieron HTTP Preview, Gemini remoto o Android.

## Archivos de esta integración conversacional

- `frontend/yarbi-conversation-renderer.js`
- `frontend/index.html`
- `frontend/yarbi-conversation-store.js`
- `frontend/yarbi-memory-center.js`
- `frontend/yarbi-multimodal-tutor.js`
- `frontend/yarbi-financial-coach-ui.js`
- `frontend/yarbi-agenda-read-ui.js`
- `frontend/yarbi-client-context-read-ui.js`
- `tests/etapa1-conversation-renderer.test.js`
- `tests/etapa1-cross-tab-concurrency.test.js`
- `tests/yarbi-multimodal-tutor.test.js`
- `tests/yarbi-norms-availability.test.js`
- `tests/yarbi-agenda-read-ui.test.js`
- `tests/yarbi-client-context-read.test.js`
- `tests/yarbi-financial-coach-ui.test.js`

Este worktree ya tenía trabajo local de inteligencia documental antes de esta integración. Se preservó; por eso `api_handlers/assistant/gemini.js`, la migración propuesta y los archivos/resultados del motor documental también aparecen en el estado local. La migración sigue siendo propuesta y no fue ejecutada. No se eliminaron, movieron ni sobrescribieron esos archivos.

## Próximas etapas guiadas por el Rector v1.5

1. Cerrar la brecha pendiente de historial: conectar restauración de posición solo al abrir explícitamente una conversación guardada, preservando apertura en el último mensaje; definir sincronización y borrado entre dispositivos antes de extenderlos a nube.
2. Validar en Android la jerarquía visual, teclado, scroll, persistencia, exportación JPG y voz antes de certificar UX móvil.
3. Completar BKE multimodal con previsualización real de imágenes/recortes y política de sincronización versionada para presentaciones, sin aplicar la migración propuesta hasta validarla para Preview aislado.
4. Reconciliar CRM/Agenda/Finanzas con datos autorizados y fuentes/estados de disponibilidad, evitando generar escrituras por respuesta.
5. Implementar Meta Ads Intelligence y atribución comercial como línea obligatoria del Rector, por etapas con aislamiento y proveedor explícito.

No encontré un archivo llamado “roadmap reconciliado” en este worktree; esta secuencia toma los requisitos y estados explícitos de `docs/product/YARBI_DOCUMENTO_RECTOR_v1.5.md` y no los presenta como fases ya aprobadas o funcionalidades terminadas.

## Estado del trabajo

No se hicieron llamadas a Gemini ni a proveedores comerciales, cambios remotos, builds o despliegues. No se creó commit: el índice Git compartido está fuera de la raíz escribible de esta sesión y una operación anterior de staging fue denegada por permisos; no se intentó eludir esa restricción. Los cambios permanecen en el worktree para conservarlos.
