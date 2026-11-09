# Etapa 1.1.2 — Corrección del recorrido final de Gemini Live

## Resultado

La corrección queda implementada localmente en la rama `etapa1-live-renderer-fix`, creada desde `bf52631e822e923c503b4ad713d5035c19e10392` (antecesor F03: `6b2431ac3dd25491d95d10a72f17f1b0adcf016f`).

En conversación normal, un borrador de transcripción Live ya no se transforma directamente en una burbuja heredada. Al finalizar el turno, se persiste una sola vez, se retira el borrador y se llama a `renderTimelineItem(item)`, que utiliza `YarbiConversationRenderer` para validar y presentar el mensaje final.

## Cambio limitado

- Modificado: `frontend/yarbi-memory-center.js`.
- Añadido: `tests/etapa1-live-finalization.test.js`.
- No se cambiaron rutas, proveedor Gemini, prompt, esquema, autenticación, persistencia remota, F04.2, F04.3, producción ni servicios externos.
- El simulador de entrenamiento conserva su superficie separada; el cambio aplica a la conversación normal, que es la ruta que integra el renderer canónico.

## Estado

- Flujo local Live final: corregido y probado.
- Build Web: PASS.
- Build Android-Web: PASS.
- Despliegue, Gemini real, Supabase remoto y migraciones: no ejecutados.
- Pendiente: auditoría independiente de Antigravity y validación física Android antes de declarar una experiencia Live comercial terminada.

Los hashes definitivos están en `ETAPA_1_1_2_SHA256SUMS.txt`.
