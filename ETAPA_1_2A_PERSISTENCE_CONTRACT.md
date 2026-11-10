# Contrato de persistencia de línea temporal — Etapa 1.2A

## Campos inmutables

Un mensaje persistido se identifica por `id` y se considera el mismo evento únicamente cuando también coinciden `role`, `text` y `channel`. La marca temporal del primer registro se conserva en un reintento idempotente.

## Resultados controlados

| Resultado | Efecto |
| --- | --- |
| `persisted` | escritura y lectura posterior confirmaron el mismo contenido |
| `idempotent` | ya existía exactamente el mismo evento |
| `identity_conflict` | el ID pertenece a contenido distinto; el original se conserva |
| `identity_invalid` | ID explícito no es una cadena no vacía |
| `content_invalid` | rol o contenido no se pudieron normalizar |
| `storage_write_failed` | `localStorage` rechazó la escritura, incluso por cuota |
| `storage_readback_failed` | la lectura posterior no prueba el contenido esperado |

No se encola ni se declara finalización exitosa para los tres últimos resultados de error. La recuperación de borrador existente permanece disponible para un reintento posterior con la misma identidad y contenido.
