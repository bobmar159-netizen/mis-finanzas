# Etapa 1.2B — Inventario previo a la migración

## Fuente y estado de partida

La fuente editable es `frontend/`. El build genera las copias Web y Android. La base utiliza `localStorage` para la línea temporal (`gfc_yarbi_chat_timeline_v1`) y la outbox (`gfc_yarbi_chat_outbox_v1`); ambos arreglos se leen, modifican y reescriben de forma síncrona.

| Componente | Comportamiento actual | Cambio necesario | Riesgo |
| --- | --- | --- | --- |
| `persistTimelineMessage` | lee, decide y escribe Timeline; luego encola Outbox | operación async única sobre ambos almacenes IndexedDB | alto: es la frontera de inmutabilidad |
| `timelineImmutableMatch` | compara ID, rol, texto y canal | reutilizar sin relajar contrato | bajo |
| `loadTimeline` / `queueTimeline` | arrays `localStorage` independientes | lecturas async y transacción conjunta | alto: hoy puede perder actualizaciones |
| `flushTimelineOutbox` | lee outbox y hace red | usar repositorio para leer/eliminar tras red, fuera de transacción | medio |
| `syncTimelineFromCloud` | mezcla nube y localStorage | leer/escribir mediante repositorio | medio |
| `gfcAppendCopilotTimelineMessage` | retorna resultado síncrono y renderiza | manejar promesa y fallo recuperable | alto |
| `gfcFinalizeLiveTranscriptDraft` | persiste y retira borrador síncronamente | conservar borrador hasta commit IndexedDB | alto |
| `gfcRestoreCopilotChat` | restaura y sincroniza en apertura | lectura async de la fuente de verdad | medio |
| borradores Live | `Map` local por pestaña | no sincronizar ni sobrescribir | bajo |

## Consumidores y entradas

- `frontend/index.html` llama el hook timeline desde `gfcAppendCopilotChatMessage` y finaliza tres recorridos Live.
- `frontend/yarbi-memory-center.js` es el único escritor directo de Timeline/Outbox localizado.
- La outbox se consume en `flushTimelineOutbox`; no se hallaron otros consumidores directos.
- La restauración se concentra en `gfcRestoreCopilotChat`.

## Decisión de diseño

IndexedDB será la fuente de verdad para Timeline y Outbox. `BroadcastChannel` y el evento `storage` solo anunciarán un cambio confirmado sin transportar texto. No se empleará un mutex con `localStorage`.

La conversión a promesas se limita al repositorio, sus consumidores de Timeline y los tres callbacks de finalización Live. VAD, AudioWorklet, Barge-in, autenticación, endpoints, F03 y el contrato de identidad v2 quedan fuera de cambio.
