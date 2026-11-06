# F07 — Voz real en la aplicación

## Resultado

**F07_VOZ_APLICACION_VALIDADA_LOCALMENTE_CON_PRUEBA_FISICA_PENDIENTE**

Se agregó un flujo de dictado al chat principal sin crear otro cerebro ni otra memoria:

1. El botón **Dictar** inicia reconocimiento local/web o el adaptador Capacitor existente.
2. El audio es temporal; no se usa `MediaRecorder` ni se guarda audio o transcripción automáticamente.
3. El propietario puede detener la captura, cancelarla o editar el texto en la pantalla de revisión.
4. Solo al seleccionar **Enviar a Yarbi** la frase llega a `gfcSendYarbiUnifiedMessage`, el mismo recorrido F05.
5. Las frases de enseñanza se envían a la propuesta F06 con `source_channel=voice`; se guardan únicamente después de la confirmación explícita.

## Capacidades

| Capacidad | Estado local |
| --- | --- |
| Botón de dictado integrado al chat | PASS |
| Inicio, detención, cancelación y límite de 60 s | PASS |
| Revisión editable antes de enviar | PASS |
| Permiso, micrófono ausente, conexión y timeout | PASS con mocks |
| Integración con cerebro F05 y FAST_LOCAL | PASS por el mismo envío central |
| Continuidad, owner scope y ausencia de acciones accidentales | PASS por regresiones F05/F06 |
| Propuesta F06 desde voz con procedencia `voice` | PASS |
| TTS nativo/dispositivo, activable y detenible | PASS con mocks/estático |
| ElevenLabs automático en este flujo | BLOQUEADO INTENCIONALMENTE |
| Micrófono y reproducción física en Android | NOT RUN — no hubo dispositivo disponible |

La salida hablada está desactivada de forma predeterminada y se activa con **Voz activa**. Cuando se activa, F07 prioriza `YarbiTts` de Capacitor o `speechSynthesis`; evita llamar a ElevenLabs desde este flujo.

## Archivos principales

- `frontend/yarbi-app-voice.js`
- `lib/yarbi-app-voice-policy.js`
- `frontend/index.html`
- `frontend/yarbi-owner-memory-ui.js`
- `api_handlers/assistant/memory.js`
- `tests/f07-app-voice-policy.test.js`
- `tests/f07-app-voice-ui.test.js`

## Pruebas y builds

- Regresión focalizada F05/F06/F07: **65/65 PASS**.
- Build Web: PASS (`dist/web/`).
- Build Android: PASS (`dist/android-www/`) con origen sintético `https://yarbi-android-build.invalid`.

No se realizó despliegue, acceso remoto, llamada a Gemini, envío WhatsApp, escritura comercial, migración, APK ni modificación de Production.

## Límite restante

F07 no puede declararse físicamente validada en Android hasta que se prueben permiso, reconocimiento, revisión y reproducción en un dispositivo Android real. La implementación no finge esa evidencia.

## Preparación F08

El siguiente paso es reutilizar el mismo patrón: WhatsApp Business puede presentar propuestas y borradores al propietario, pero debe mantener los proveedores desconectados y prohibir cualquier envío hasta recibir autorización explícita.
