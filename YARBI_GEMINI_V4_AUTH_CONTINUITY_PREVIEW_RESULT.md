# Yarbi — prueba real de continuidad Auth en Preview

## Resultado

`AUTH_CONTINUITY_PREVIEW_16_PASS`

La misma sesión sintética generó un único access token, se validó antes del
lote y se reutilizó sin renovación para 16 requests secuenciales. Los 16
requests llegaron a la ruta Auth-only aislada con Bearer presente y formato
válido, Supabase Auth válido y correspondencia exacta del owner.

## Entorno y aislamiento

- Deployment Preview: `dpl_HgcM6ZLZjgi79P3ewDJnfGoN9Ti2`.
- URL Preview: `https://misfinanzas-backend-i16u5mof0-omar-dfc4.vercel.app`.
- Proyecto Supabase aislado: `uevilhbstnmmdlgyshlv`.
- Producción no fue usada ni modificada.
- La ruta está limitada a Preview, al project ref aislado, al host Supabase
  aislado y al owner configurado. No importa Gemini ni módulos comerciales.
- Antes del lote, una llamada sin Bearer devolvió `401 header_missing`, con
  `supabase_auth_result:not_called` y `gemini_invoked:false`.

## Resultado individual

| # | HTTP | Header | Formato | Auth | Owner | Gemini | Tiempo ruta | Tiempo runner |
| ---: | ---: | --- | --- | --- | --- | --- | ---: | ---: |
| 1 | 200 | presente | válido | válido | coincide | no | 547 ms | 5,863 ms |
| 2 | 200 | presente | válido | válido | coincide | no | 419 ms | 5,659 ms |
| 3 | 200 | presente | válido | válido | coincide | no | 406 ms | 5,690 ms |
| 4 | 200 | presente | válido | válido | coincide | no | 414 ms | 5,558 ms |
| 5 | 200 | presente | válido | válido | coincide | no | 423 ms | 5,573 ms |
| 6 | 200 | presente | válido | válido | coincide | no | 418 ms | 5,796 ms |
| 7 | 200 | presente | válido | válido | coincide | no | 395 ms | 5,618 ms |
| 8 | 200 | presente | válido | válido | coincide | no | 416 ms | 5,486 ms |
| 9 | 200 | presente | válido | válido | coincide | no | 397 ms | 5,443 ms |
| 10 | 200 | presente | válido | válido | coincide | no | 412 ms | 5,503 ms |
| 11 | 200 | presente | válido | válido | coincide | no | 420 ms | 5,453 ms |
| 12 | 200 | presente | válido | válido | coincide | no | 415 ms | 5,458 ms |
| 13 | 200 | presente | válido | válido | coincide | no | 403 ms | 5,409 ms |
| 14 | 200 | presente | válido | válido | coincide | no | 614 ms | 5,671 ms |
| 15 | 200 | presente | válido | válido | coincide | no | 669 ms | 5,707 ms |
| 16 | 200 | presente | válido | válido | coincide | no | 404 ms | 5,487 ms |

No hubo reintentos, refresh de token durante el lote, Gemini, CRM, Agenda,
WhatsApp, Calendar, Maps, Notion, Meta Ads, clientes reales ni acciones
comerciales.

## Latencias

| Métrica | Mínimo | Mediana | Máximo / P95* |
| --- | ---: | ---: | ---: |
| Ruta Auth-only | 395 ms | 416 ms | 669 ms |
| Runner con `vercel curl` | 5,409 ms | 5,566 ms | 5,863 ms |

\*Con 16 muestras, P95 es una referencia limitada.

## Comparación con el fallo V4 anterior

La prueba descarta, para el entorno actual y el mismo patrón de transporte,
las hipótesis de header ausente, formato de header incorrecto, pérdida de
identidad del owner, incapacidad de reutilizar un access token y fallo estable
de `vercel curl` en requests secuenciales.

La causa del `401` observado tras F3PC-03 permanece `NOT PROVEN`: no se
conservó el detalle de Auth remoto ni cabeceras para proteger secretos. La
evidencia actual permite clasificar aquel incidente como una condición
transitoria o externa aún no demostrada, no como un defecto reproducible de la
continuidad Auth.

## Evidencias y hashes SHA-256

| Artefacto | SHA-256 |
| --- | --- |
| `scripts/auth-continuity-preview-evidence.json` | `56BC2024F4A5715A74A2DFC02809BAF465E1544284FAB20933EA5BDA151B4D29` |
| `scripts/auth-continuity-preview-attempt.json` | `20DDA577D2A30C7B888177D450BD3F39B029FEA6BB987D468296FF5E53BF1820` |
| `scripts/run-auth-continuity-preview.cjs` | `93D488BACD2FBB1ABFAAB1C29BD7F20F37724726F7BB0394CCD9E3ACEDE6EB08` |
| `PREVIEW_REFERENCIAS_AISLADO/api/diagnostics/auth-continuity.js` | `60E16815C860C743BBF8299B9DC29CC079AD8BD16E565A83A94AEBD4E35C8B59` |
| `PREVIEW_REFERENCIAS_AISLADO/lib/preview-auth-continuity-policy.js` | `7E6E2BEA34D7B604B4D25106E72F9919E85FF06DF218C32E75CF3FD4ED92DE6E` |

## Cierre

La prueba Auth-only queda cerrada. No se ejecutaron las 13 solicitudes
semánticas pendientes y no se realizaron cambios al sistema comercial.

El siguiente paso, si se autoriza, es diseñar explícitamente una recuperación
de la validación V4 que no reutilice los tres fixtures ya consumidos ni borre
las evidencias previas.
