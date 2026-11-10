# Pruebas — Etapa 1.2A

## Focalizadas

| Comando | Resultado |
| --- | --- |
| `node --test tests/etapa1-live-finalization.test.js` | 11 PASS, 0 FAIL |
| `node --test tests/etapa1-conversation-renderer.test.js tests/f03-intelligence-router.test.js` | 21 PASS, 0 FAIL |
| `npm run test:frontend:unified` | 4 PASS, 0 FAIL |

Las nuevas comprobaciones cubren identidad número/texto, IDs Unicode y largos, tipos inválidos, ID repetido con mismo contenido, conflicto por mismo ID y contenido distinto, fallo de cuota/almacenamiento y ausencia de duplicación. Las pruebas Live preexistentes cubren mensajes finales, recuperación de borrador y reintentos.

## Suite histórica

`npm test` terminó con **460 PASS, 67 FAIL y 6 TODO**. La referencia era **459 PASS, 67 FAIL y 6 TODO**: el PASS adicional es la prueba nueva de persistencia; no aumentó el número de fallos. Las 14 cargas de archivos de prueba que fallan pertenecen al perfil histórico de esta base y continúan incluyendo contratos ausentes de `api/assistant/preferences.js`, `api/assistant/collections.js` y otros módulos excluidos del alcance.

No se alteraron pruebas históricas para ocultar resultados.
