# Etapa 1.1.2 — Arquitectura aplicada

## Problema corregido

`gfcFinalizeLiveTranscriptDraft` cambiaba el nodo temporal `.is-live` a una burbuja final heredada. Esa ruta evitaba el renderer canónico y, por tanto, su validación y representación segura.

## Recorrido normal final

```text
Gemini Live / transcripción
  -> ensure/update draft (.is-live, visual y no persistente)
  -> finalización con texto no vacío
  -> persistTimelineMessage una única vez
  -> retirar draft temporal
  -> renderTimelineItem(item)
  -> YarbiConversationRenderer.appendMessage(...)
  -> elemento final con data-message-id
```

`renderTimelineItem` conserva el rol, identificador, fecha y canal del `item` persistido. El renderer canónico conserva la validación estructurada, Markdown limitado, fallback seguro, control de tamaño y comportamiento de scroll existente.

## Límites deliberados

- No se crea un segundo renderer ni se cambia el contrato de Gemini Live.
- El borrador sigue usando texto plano y `textContent`; no se persiste por fragmento.
- La vista de entrenamiento no se mezcla con el timeline de conversación normal: conserva su comportamiento independiente existente.
- La deduplicación de una finalización repetida continúa controlada por `finalizedLiveTranscriptKeys` y por el identificador visual del timeline.
