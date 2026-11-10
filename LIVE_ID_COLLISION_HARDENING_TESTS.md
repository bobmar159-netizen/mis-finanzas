# Pruebas de hardening de identidad Live

## Cobertura añadida

La suite `tests/etapa1-live-finalization.test.js` cubre ahora:

1. `sesion/123` frente a `sesion_123`.
2. Sesiones con 96 caracteres iniciales iguales y diferencia posterior.
3. Turnos con 40 caracteres iniciales iguales y diferencia posterior.
4. Unicode, espacios y caracteres especiales.
5. Diferencia entre mayúsculas y minúsculas.
6. Separadores internos.
7. Roles distintos.
8. Valores ausente, `null` y cadena vacía.
9. Dos sesiones con el mismo turno, texto y momento.
10. Callback repetido y reconexión del mismo turno.
11. Orden invertido de finalización de turnos.
12. Fallo de persistencia, fallo de renderer y recuperación sin duplicación.

## Resultados

| Comando | Resultado |
| --- | --- |
| `node --test tests/etapa1-live-finalization.test.js tests/etapa1-conversation-renderer.test.js` | PASS 24/24 |
| `node --test tests/f03-intelligence-router.test.js tests/etapa1-conversation-renderer.test.js tests/etapa1-live-finalization.test.js tests/gemini-live-security.test.js` | PASS 31/31 |
| `npm run build:frontend:web` | PASS |
| `npm run build:frontend:android` con origen sintético | PASS |
| `npm run test:frontend:unified` | PASS 4/4 |
| Suite histórica completa | 532 tests: 459 PASS, 67 FAIL, 6 TODO |

Los 67 fallos (66 identificadores únicos) son exactamente los de F03. Huella normalizada compartida: `f3e96f5e14e37595133f2ea50f7b85004ed2f7d79fe381ab98f1d7fb800bd526`.

## Concurrencia

JavaScript serializa callbacks concurrentes dentro de una instancia; la prueba de callback repetido confirma que la misma tupla no inserta una segunda entrada. Las pruebas no afirman exclusión mutua entre pestañas ni procesos: esa garantía requeriría una frontera compartida fuera del alcance local.
