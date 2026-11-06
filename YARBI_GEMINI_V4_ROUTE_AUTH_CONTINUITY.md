# YARBI — continuidad de autenticación en la ruta V4 real

**Resultado:** `V4_ROUTE_AUTH_CONTINUITY_4_PASS`  
**Fecha:** 2026-11-05  
**Alcance:** Preview aislado únicamente. Sin Gemini, fixtures, trazas ni acciones comerciales.

## Entorno verificado

- Deployment Preview: `dpl_CoCWz32nXWDXAXrXqsgamkbUZYGC`
- URL: `https://misfinanzas-backend-dfxg4yyf8-omar-dfc4.vercel.app`
- Proyecto Vercel: `omar-dfc4/misfinanzas-backend`
- Supabase aislado esperado y confirmado por la ruta: `uevilhbstnmmdlgyshlv`
- Production, sus aliases, CRM, Agenda, WhatsApp, Meta Ads, APK y Gemini: no utilizados ni modificados.

## Comparación de rutas

La ruta anterior `api/diagnostics/auth-continuity` y el nuevo modo `auth_only` de
`api/diagnostics/gemini-v4-post-corrections-validation` comparten las mismas
comprobaciones críticas: política Preview aislada, `authenticatedOwnerIdentity`,
validación del Bearer contra Supabase Auth y comparación de `user.id` con el
owner configurado.

La diferencia de este modo es deliberadamente mínima: después de completar esas
comprobaciones, devuelve una respuesta sanitizada y termina. No recibe
`fixture_id`, no crea una operación de trazabilidad, no invoca Gemini y no llega
al pipeline semántico ni a handlers comerciales. El comportamiento normal de la
ruta V4 para fixtures se conserva sin cambios.

## Prueba remota ejecutada

Se obtuvo una sola sesión sintética y se reutilizó exactamente el mismo Bearer
en cuatro solicitudes secuenciales a la ruta V4 real mediante `vercel curl`.
No hubo renovación ni reintentos automáticos.

| Solicitud | HTTP | Auth | Owner | Autorización | Ruta (ms) | Gemini / fixtures / trazas |
| --- | ---: | --- | --- | --- | ---: | --- |
| 1 | 200 | válido | coincide | autorizada | 556 | 0 / 0 / 0 |
| 2 | 200 | válido | coincide | autorizada | 402 | 0 / 0 / 0 |
| 3 | 200 | válido | coincide | autorizada | 407 | 0 / 0 / 0 |
| 4 | 200 | válido | coincide | autorizada | 395 | 0 / 0 / 0 |

Latencia de ruta: mínimo 395 ms, mediana 405 ms, máximo/p95 556 ms. Las
latencias del runner incluyen el transporte protegido de Vercel y no se usan
para medir la lógica de autenticación.

## Resultado y límites

- `PASS`: la ruta V4 real mantiene autorización estable durante cuatro
  solicitudes secuenciales con un único Bearer.
- `PASS`: las cuatro respuestas confirmaron `gemini_invoked:false`,
  `fixture_consumed:false`, `pipeline_invoked:false`, `trace_invoked:false` y
  `commercial_actions_executed:false`.
- `PASS`: la ruta informó el project ref aislado correcto en las cuatro
  respuestas.
- `PASS`: la verificación previa sin Bearer fue rechazada con HTTP 401 antes de
  autenticar o ejecutar Gemini.
- `NOT PROVEN`: la causa del HTTP 401 histórico durante la batería F3PC sigue
  sin evidencia suficiente. Este resultado descarta que el flujo actual V4
  falle de forma reproducible por continuidad de Bearer, Supabase Auth o la
  comparación de owner en cuatro solicitudes.

No se consumieron fixtures F3PC ni se reanudó la batería semántica. Esta prueba
no autoriza ni ejecuta solicitudes adicionales a Gemini.

## Archivos y hashes SHA-256

| Artefacto | SHA-256 |
| --- | --- |
| `PREVIEW_REFERENCIAS_AISLADO/api/diagnostics/gemini-v4-post-corrections-validation.js` | `5CC5E7A563C389392BBD3CDE9846DF483A0D6104C53D6D33B8A97CB11C316421` |
| `scripts/test-v4-route-auth-continuity-local.cjs` | `66984A6F04D9221409E239500A7D588EBAECC9C09C68130B4DF0606EEFAB3274` |
| `scripts/run-v4-route-auth-continuity.cjs` | `7B68AEDE9A02B76E954118AE68EB60B63A54B7EAF1200EE72B512B175138A50D` |
| `scripts/run-v4-route-auth-continuity.ps1` | `D9C8A36E7D3558C6D59F1D1A5290CA7CD02E3D26CEFE460BAC571864F38240D3` |
| `scripts/v4-route-auth-continuity-evidence.json` | `BA5EF5F9C7955E450C4E29F48AB3B5B284726E2468D77E6EFD617F22010EE1C9` |

La evidencia contiene únicamente resultados sanitizados, estados, métricas y
referencias de entorno; no contiene contraseñas, JWT, API keys ni contenido de
clientes.

