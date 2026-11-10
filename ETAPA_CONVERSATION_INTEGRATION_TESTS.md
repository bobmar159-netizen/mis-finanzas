# Integración del chat — Pruebas

| Validación | Resultado |
| --- | --- |
| Renderer + Live final | 21/21 PASS |
| F03 + renderer + Live | 28/28 PASS |
| Frontend unificado | 4/4 PASS |
| Selección F01/F03/F07/Gemini Live/renderer | 49/50 PASS; un fallo VAD histórico, no modificado |
| Suite F03 completa | 435 PASS, 67 FAIL, 6 TODO |
| Suite candidata completa | 456 PASS, 67 FAIL, 6 TODO |

Los tres PASS adicionales sobre los 453 de `c6b8847` cubren mensajes iguales de distintas sesiones/turnos, orden de finalización invertido y recuperación después de fallar persistencia o renderer.

Los builds Web y Android-Web terminaron correctamente con el mismo hash de fuente:

`f73f3b41155f400bc7aa8de5ee84c6af8b51832b962f9cbfd03a56a9be8b985a`

No se construyó APK/AAB nativo.
