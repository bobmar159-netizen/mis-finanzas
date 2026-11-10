# Integración del chat — Regresión

La comparación completa se ejecutó entre F03 y la rama candidata. El conjunto normalizado de fallos es idéntico: 66 nombres únicos, SHA-256 `4029bda5896b2927f5bd4ff5ae15b51a798ba37bfe556c01829610cf6d30d348`.

| Referencia | Tests | PASS | FAIL | TODO |
| --- | ---: | ---: | ---: | ---: |
| F03 (`6b2431a`) | 508 | 435 | 67 | 6 |
| Candidata de integración | 529 | 456 | 67 | 6 |

No existen identificadores de fallo nuevos o eliminados. La diferencia de PASS corresponde a las pruebas de Etapas 1/1.1/1.1.2 y a las tres pruebas adicionales de identidad/recuperación solicitadas durante la integración.

## Deuda VAD preservada

`barge-in guard: protected VAD block matches the approved behavior` falla porque su hash esperado histórico (`D2A360…`) no coincide con el bloque existente (`024125…`). La integración no modifica ese bloque ni actualiza la expectativa para forzar un PASS. Las demás cuatro pruebas de Barge-in de la selección pasan. La validación física de Barge-in en Android sigue pendiente.
