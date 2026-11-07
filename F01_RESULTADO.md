# YARBI — F01: Consolidación Gemini y seguridad

**Estado:** `F01_IMPLEMENTADA_LOCALMENTE_BLOQUEADA_PARA_DESPLIEGUE`

**Base verificada:** `722c582` (`F08`). Se comprobaron el estado Git, los commits recientes y las etiquetas disponibles `F05`, `F06`, `F07` y `F08`, además de los manifiestos P0.2I y P0.5 antes de modificar la fuente.

## Resultado

Se consolidó la ruta Gemini del navegador detrás de handlers autenticados y se retiró ElevenLabs de la aplicación activa. Gemini Live conserva el WebSocket bidireccional, captura PCM, VAD local, barge-in, contexto y el flujo de token temporal. No hubo despliegue, llamadas reales a Gemini, conexiones a Supabase remoto, migraciones, APK ni acciones comerciales.

La fase **no queda autorizada para despliegue**: el inventario estático encontró rutas no Gemini que todavía dependen de `ASSISTANT_API_TOKEN` y de `X-Assistant-Token` almacenado en el navegador. Ese mecanismo puede proteger funciones sensibles y debe migrarse de forma transversal a sesión autenticada antes de exponer el candidato. No fue modificado masivamente para no romper CRM, Agenda, WhatsApp ni funciones históricas fuera del alcance de F01.

## Cambios implementados

| Área | Cambio |
| --- | --- |
| Gemini REST | Se creó `api_handlers/assistant/gemini.js`: proxy limitado, autenticado con sesión Supabase, sin claves en el cliente. Las llamadas heredadas pasan por `/api/assistant/gemini`. |
| Gemini Live | `live-token.js` exige sesión autenticada, emite token temporal de un solo uso y no acepta token estático de asistente. |
| Chat y comando | `chat.js` y `command.js` abandonan `ASSISTANT_API_TOKEN` y verifican el Bearer de la sesión antes de usar Gemini. |
| Procesador | Se sanitizaron logs de continuación y errores; ya no serializan resultados completos ni objetos de error crudos. |
| Preferencias | La bóveda deja de sincronizar claves Gemini, ElevenLabs o token de asistente. |
| Voz | Se retiró ElevenLabs y TTS de navegador. Gemini Live continúa siendo la voz principal; cuando no está disponible, la interfaz conserva interacción por texto y muestra una indicación clara. |
| Frontend | `frontend/index.html` continúa como fuente canónica. Se reconstruyeron `dist/web`, `dist/android-www` y los archivos raíz generados. |

## Evidencia de seguridad Gemini

- Ninguna ruta Gemini migrada obtiene `fnz_gemini_key` o una clave maestra desde HTML, JavaScript cliente o `localStorage`.
- El navegador adjunta un Bearer de sesión recién obtenido para Gemini REST, Live, chat y command.
- El backend conserva `GEMINI_API_KEY` exclusivamente para llamadas servidor-proveedor.
- El proxy limita contenido, partes, adjuntos, temperatura y tokens de salida.
- Los errores de proveedor se reducen a categorías y estados; no se devuelven ni registran prompts, respuestas crudas, cabeceras o claves.
- CORS de los handlers migrados deja de usar comodín y admite `Authorization`.

## Inventario de archivos modificados

- `api/assistant-router.js`
- `api/ai/process.js`
- `api_handlers/assistant/chat.js`
- `api_handlers/assistant/command.js`
- `api_handlers/assistant/gemini.js` (nuevo)
- `api_handlers/assistant/live-token.js`
- `api_handlers/assistant/preferences.js`
- `lib/yarbi-runtime-config.js`
- `frontend/index.html`
- `frontend/yarbi-app-voice.js`
- `frontend/yarbi-assistant.js`
- `tests/f01-gemini-live-session-security.test.js` (nuevo)
- `tests/f07-app-voice-ui.test.js`
- `tests/gemini-live-regression.test.js`
- Artefactos generados por el build: `index.html`, `runtime-config.js`, `service-worker.js`, `yarbi-app-voice.js`, `yarbi-assistant.js`, `dist/web/` y `dist/android-www/`.

El archivo sin seguimiento `YARBI_SECURITY_REVIEW_PREDEPLOY.md` ya existía y no se modificó ni se incluye en el commit de F01.

## ElevenLabs retirado

El inventario detallado está en `F01_ELEVENLABS_RETIRADO.md`. En resumen, se retiraron UI, configuración, lecturas/escrituras de clave y llamadas directas. Solo queda una lista de limpieza de claves locales históricas para borrar valores residuales durante el arranque; no es una integración operativa.

## Pruebas y builds locales

| Verificación | Resultado |
| --- | --- |
| Sintaxis handlers F01 y procesador | PASS |
| Scripts inline frontend | PASS — 8 bloques |
| Seguridad, Live, voz, CRM/owner scope, webhook y WhatsApp simulados | PASS — 14/14 |
| Build web unificado | PASS — `p02i-e8a01a7c41994029` |
| Build Android web bundle | PASS — `p02i-e8a01a7c41994029` |
| Pruebas de build unificado | PASS — 4/4 |

Las pruebas de audio son locales/estáticas y de mocks. No se declara una prueba física de micrófono, WebSocket Gemini Live, latencia real ni Android porque F01 prohibió conexiones externas y APK final.

## Regresión y límites verificados

Se conservaron las configuraciones existentes de Gemini Live: audio bidireccional, entrada PCM 16 kHz, salida PCM 24 kHz, VAD local, interrupciones, contexto y respuesta concisa. No se modificaron modelo, protocolo, AudioWorklet/ScriptProcessor ni contratos comerciales.

No se detectó regresión en la batería focalizada de CRM owner scope, autenticación de webhook, WhatsApp simulado, UI de voz ni compilación de frontend.

## Bloqueos pendientes antes de cualquier despliegue

1. **Crítico de release:** rutas activas no Gemini todavía aceptan `X-Assistant-Token`/`ASSISTANT_API_TOKEN`; el frontend conserva dependencias de `fnz_assistant_token` para CRM, Agenda, preferencias, acciones y WhatsApp. No se debe desplegar este candidato como endurecimiento integral hasta reemplazar ese mecanismo de forma compatible y probada.
2. Los archivos históricos `*.before-*` y `*.bak-*` contienen referencias heredadas a Gemini y tokens. No se ejecutan; no fueron eliminados para preservar historia.
3. Quedan pendientes pruebas reales autorizadas de Gemini Live, micrófono/altavoz en Android y rendimiento. No se hicieron afirmaciones de latencia real.
4. El auditor Antigravity solicitado no estaba disponible como skill/herramienta en esta sesión; este resultado usa revisión estática local y debe ser revisado independientemente antes de despliegue.

## Integridad

Los hashes SHA-256 de los artefactos F01 se encuentran en `F01_SHA256SUMS.txt`. El manifiesto P0.2I original ya no coincide en los archivos fuente modificados porque F01 cambia intencionalmente la fuente canónica y reconstruye los outputs; no fue sobrescrito.

## Siguiente paso seguro

No iniciar F02 ni desplegar. Primero crear una migración compatible de todas las rutas dependientes de `ASSISTANT_API_TOKEN` a identidad autenticada por sesión, con pruebas de owner scope y de no regresión para CRM/Agenda/WhatsApp.
