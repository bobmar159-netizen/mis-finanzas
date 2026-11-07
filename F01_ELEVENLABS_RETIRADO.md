# F01 — Inventario de retiro ElevenLabs

## Retirado de la aplicación activa

| Elemento | Evidencia de retiro |
| --- | --- |
| Llamadas a `api.elevenlabs.io` | No existen en `frontend/index.html` ni en `frontend/yarbi-app-voice.js`. |
| Clave `fnz_eleven_key` | Se elimina únicamente como parte de la limpieza de credenciales locales históricas; no se lee ni se guarda. |
| Configuración de ElevenLabs | Se eliminó de Ajustes; la interfaz explica que la voz utiliza Gemini Live mediante sesión temporal. |
| TTS ElevenLabs | No existen funciones operativas ni fallback hacia ese proveedor. |
| TTS de navegador como reemplazo | No se invoca `speechSynthesis.speak` ni `YarbiTts.speak`. |
| Voz sin Gemini Live | La interfaz mantiene texto y comunica indisponibilidad; no inventa salida de voz. |

## Conservado deliberadamente

- Referencias históricas en documentos, respaldos y nombres de claves dentro de la rutina de limpieza. No son rutas ejecutables ni contienen valores.
- La captura de micrófono y transcripción existentes, porque no dependen de ElevenLabs y forman parte de Gemini Live/F07.
- `gfcRetireClientAiCredentials()`, que elimina las claves locales retiradas sin revelar ni reenviar sus valores.

## Verificación local

La prueba `tests/f01-gemini-live-session-security.test.js` comprueba que no existen endpoint directo de ElevenLabs, invocación de TTS de navegador ni más de una referencia operativa a la clave retirada. La única coincidencia permitida corresponde al borrado local de migración.
