# Regresiones

| Suite | Resultado |
|---|---|
| IndexedDB + Live + renderer + F03 focalizada | 38/38 PASS |
| Frontend unificado | 4/4 PASS |
| Validación inline | PASS (8 scripts) |
| Build web aislado | PASS |
| Build Android-Web aislado | PASS |
| Suite histórica | 466 PASS, 67 FAIL, 6 TODO |

Los 67 FAIL son los 67 históricos de la base; numerosos fallos esperan módulos `api/assistant/*` que no existen en esta línea aislada. Los seis PASS adicionales corresponden a la nueva batería 1.2B. No se ocultaron ni modificaron pruebas históricas.
