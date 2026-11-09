# Etapa 1.1 — Renderer

## Contrato operativo

- 2.048 puntos de código por run.
- 64 runs por párrafo.
- 100 bloques por mensaje.
- 50 filas, 12 columnas y 600 celdas por tabla.
- 30.000 puntos de código visibles por mensaje.
- Umbral de seguimiento de scroll: 72 px.

Una entrada vacía se omite. Una respuesta que supera el presupuesto queda como `partial`, con `message_truncated` y aviso inequívoco; no se corta silenciosamente ni se declara completa.

## Cobertura añadida

- Ejecución de la función canónica real con un mock de renderer: una llamada, sin duplicado.
- Ausencia de asignaciones adicionales a `window.gfcAppendCopilotChatMessage` en `index.html` y `yarbi-memory-center.js`.
- Vacíos, bloques vacíos, truncamiento Unicode, Markdown válido/incompleto, presupuesto con bloque posterior no visitable y política de scroll.

Las respuestas de FAST, STANDARD, DEEP, deterministas y Gemini comparten la misma entrada visual cuando llegan por el chat; no se modificó ninguno de esos proveedores.
