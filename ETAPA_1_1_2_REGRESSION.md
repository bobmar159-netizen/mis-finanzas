# Etapa 1.1.2 — Comparación de regresión histórica

Se ejecutó `npm test` en la base `bf52631e822e923c503b4ad713d5035c19e10392` y en `etapa1-live-renderer-fix`.

| Referencia | Tests | PASS | FAIL | TODO |
| --- | ---: | ---: | ---: | ---: |
| Base bf52631 | 522 | 449 | 67 | 6 |
| Etapa 1.1.2 | 526 | 453 | 67 | 6 |

Los cuatro PASS añadidos corresponden a la cobertura nueva Live. El conjunto de fallos históricos es idéntico tras normalizar los tiempos de ejecución: 66 nombres únicos, SHA-256 `4029bda5896b2927f5bd4ff5ae15b51a798ba37bfe556c01829610cf6d30d348`. La salida de Node reporta 67 fallos porque existe una etiqueta histórica repetida; no se observan identificadores nuevos ni eliminados.

El fallo de hash de `barge-in` ya ocurre contra la misma versión de `frontend/index.html` en `bf52631`; no se corrigió aquí para no alterar un subsistema excluido del alcance.
