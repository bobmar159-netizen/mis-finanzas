# Etapa 1.1.2 — Flujo Gemini Live

## Estados tratados

| Situación | Resultado |
| --- | --- |
| Inicio de voz | Se crea un borrador `.is-live`; no se persiste. |
| Fragmento de entrada o salida | Se actualiza el mismo borrador; no se crea un mensaje final. |
| Final válido | Se persiste una sola vez y se representa mediante el renderer canónico. |
| Final repetido del mismo turno | Se devuelve éxito idempotente; no se vuelve a persistir ni renderizar. |
| Final vacío | Se elimina el borrador y no se fabrica un mensaje. |
| Interrupción, cancelación o error de proveedor | `gfcDiscardLiveTranscriptDraft` retira el borrador; no se declara una respuesta completa. |
| Reconexión sin borrador | El final válido se persiste y se renderiza una vez por la ruta canónica. |
| Contenido excesivo o hostil | El renderer lo valida; contenido truncado o HTML hostil se presenta como parcial seguro. |

## Invariantes

1. No se persisten fragmentos parciales.
2. El final de conversación normal no reutiliza el nodo visual heredado del borrador.
3. No se duplica el final durante callbacks repetidos.
4. Ausencia de texto, cancelación o interrupción no equivalen a una respuesta completada.
5. Ningún callback Live realiza por sí mismo una acción comercial.
