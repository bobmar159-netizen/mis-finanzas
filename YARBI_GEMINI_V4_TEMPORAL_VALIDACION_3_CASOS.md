# Yarbi — validación temporal Gemini V4: 3 casos

## Resultado final

`YARBI_V4_TEMPORAL_PREVIEW_BLOCKED`

La política de detención se activó correctamente tras **una sola llamada real**: Gemini devolvió `503` para el primer caso. Por autorización, no se reintentó, no se hicieron llamadas para `F3TV-02` ni `F3TV-03`, y no se modificó el contrato semántico.

## Entorno verificado

| Elemento | Resultado |
| --- | --- |
| Deployment Preview | `dpl_7CFHinTSD95tamnrrYWDBo8yZYiw` |
| URL Preview | `https://misfinanzas-backend-s87nsccze-omar-dfc4.vercel.app` |
| Supabase | Aislado: `uevilhbstnmmdlgyshlv` |
| Producción | No utilizada |
| Acciones comerciales | Ninguna |
| Reintentos automáticos | `0` |
| `execute` | `false` |
| Persistencia de credenciales, prompts o respuestas del proveedor | `false` |

El deployment fue realizado solamente como Preview, sin `--prod`, sin promoción de alias y sin tocar Vercel Production ni la APK.

## Preflight local

Antes de desplegar y ejecutar, pasaron `105/105` pruebas locales:

- Contrato compacto: `12/12`.
- Polaridad: `18/18`.
- Integración V4 → V1: `15/15`.
- Hardening del adaptador: `14/14`.
- Validación semántica de soporte: `5/5`.
- Regresión forense: `6/6`.
- Correcciones V4: `17/17`.
- Ledger preflight: `3/3`.
- Forense temporal: `7/7`.
- Instrumentación temporal: `8/8`.

La comprobación `auth_only` del endpoint Preview también pasó antes de la llamada a Gemini.

## Ejecución real autorizada

| Caso | Estado | Evidencia |
| --- | --- | --- |
| `F3TV-01` — referencia temporal clara | `BLOCKED` | Gemini respondió `503`; ningún paso V4/V1/V3 posterior se ejecutó. |
| `F3TV-02` — corrección temporal | No ejecutado | No consumido por la política de parada. |
| `F3TV-03` — referencia temporal ambigua | No ejecutado | No consumido por la política de parada. |

Para `F3TV-01`:

- Gemini: `503`.
- Tiempo Gemini: `1837 ms`.
- Handler: `3928 ms`.
- Recorrido total del runner: `8930 ms`.
- Llamadas reales consumidas: `1/3`.
- Reintentos: `0`.
- Traza: cerrada.
- Egress permitido observado: autenticación/ledger del Supabase aislado y la llamada autorizada a Gemini.
- No hubo resolver, selección automática, CRM, Agenda, WhatsApp, Maps, Notion ni Calendar.

La instrumentación sanitizada reportó `PROVIDER_UNAVAILABLE`. Las etapas de normalización V4, hardener, adaptador V4/V1, normalización V1, hardener V3 y evaluación semántica quedaron correctamente registradas como `not_executed`, no como un resultado temporal negativo.

## Interpretación

Este resultado **no demuestra un defecto temporal**: el proveedor no produjo una respuesta que pudiera entrar al pipeline. Tampoco prueba los resultados esperados de los tres casos. La causa demostrada de esta ejecución es indisponibilidad temporal del proveedor (`503`); la causa subyacente del `503` permanece fuera de evidencia, ya que no se conservaron mensajes completos del proveedor.

Las correcciones locales temporales y la instrumentación continúan validadas solamente por sus pruebas locales. Los casos `F3TV-02` y `F3TV-03` permanecen pendientes y no deben ejecutarse sin una nueva autorización explícita, incluso si Gemini vuelve a estar disponible.

## Seguridad y privacidad

- Solo se usaron fixtures sintéticos.
- No se guardaron prompts, credenciales ni respuestas originales del proveedor.
- No se consultaron clientes, conversaciones ni datos comerciales reales.
- No se generaron acciones comerciales.
- El proyecto de producción, CRM real, Agenda, WhatsApp, Calendar, Maps, Notion, Meta Ads, voz y APK no fueron usados ni modificados.

## Evidencia y hashes

Los hashes SHA-256 de fuentes, runner y evidencia están en `YARBI_GEMINI_V4_TEMPORAL_VALIDACION_3_CASOS.sha256`.

Artefactos de ejecución:

- `scripts/gemini-v4-temporal-validation-attempt.json`: intento marcado inmediatamente antes de la única llamada.
- `scripts/gemini-v4-temporal-validation-evidence.json`: evidencia sanitizada del resultado.

## Siguiente paso recomendado

No reintentar automáticamente. Si se autoriza una continuación, realizar primero una comprobación de disponibilidad separada y limitada de Gemini en Preview aislado; solo después decidir si se consumen los dos casos temporales pendientes. No modificar el esquema, prompt, hardener ni adaptador basándose en este `503`.
