# YARBI — diagnóstico forense local: temporales V4 y HTTP 503

**Fecha:** 2026-11-05  
**Alcance:** sólo workspace local y evidencia sanitizada existente.  
**Resultado:** `DIAGNOSTICO_LOCAL_COMPLETADO_CON_LIMITACIONES_DE_EVIDENCIA`

## Límites respetados

- Cero llamadas a Gemini, Preview, Supabase o cualquier otro servicio externo.
- Cero despliegues, reintentos, consumo de F3PC-08 a F3PC-16 y cambios de
  Production.
- No se modificaron fixtures, prompt, esquema compacto, hardener, adaptador,
  endpoint comercial, CRM, Agenda, WhatsApp, Meta Ads ni APK.
- Se conservaron intactos los informes y las evidencias originales.

## Integridad comprobada

Los hashes de los artefactos originales coinciden con los valores registrados
en la validación bloqueada anterior:

| Artefacto | SHA-256 |
| --- | --- |
| Informe de validación de 13 pendientes | `439AB528D821353F0C5A15EA20F8B219DCAE1A74148C8A01D64DB9C2CBFF3EDF` |
| Fixtures F3PC | `227536F92A3B4E16F0F0D28D8CA8C4CDA5C8B6B1B3E1FE6EE3CC0801FC8FDC56` |
| Proveedor/prompt V4 | `F9786380481088B49DE2EFD90EC16C8CCB86EBDBA16886C3722EDC461145C92D` |
| Normalizador y hardener V4 | `BDE3923915EAF6A359D9382A87CA898BFC8E6E7F360C57A583A50CF41FF0BCAF` |
| Adaptador V4 → V1 | `B7FCF691B5E417B611B046CE4CECB8610E40133CF020BE5A126FB57B86BA4615` |
| Hardener V3 | `C6D9FE5D9894F0C818F3A7996AA5C2085F2E806766EF3304845BA702FABDBDC4` |
| Evidencia sanitizada del lote interrumpido | `734E53C53BC27930D7ED665E4C6A8CFF8E972AEBC418462942D0F8277B24579D` |

El esquema compacto sigue siendo `c72ccc…cee87c6`, de 2.068 bytes, con modelo
`gemini-3.5-flash-lite`.

Las respuestas crudas del proveedor no fueron persistidas por diseño. Esta
protección evita guardar contenido sensible, pero significa que la causa
semántica exacta de F3PC-05 y F3PC-06 no puede reconstruirse a partir de la
historia. Esa limitación queda explícitamente como `NOT PROVEN`.

## F3PC-05 — «La visita fue ayer por la tarde para ENTIDAD_E»

**Evidencia histórica:** Gemini respondió HTTP 200; la ruta devolvió HTTP 422;
el pipeline llegó a `semantic_assertions`, con `must_positive:false`,
`safe_outcome:abstained` y todas las salvaguardas críticas en `true`.

La cronología demostrada es:

1. Normalización estricta: pasó (`0 ms`).
2. Hardener V4: pasó (`1 ms`) y produjo una salida segura.
3. Adaptador V4→V1: se invocó (`0 ms`), pero no produjo V1/V3; por eso no hay
   tiempos de normalización V1 ni de hardener V3 en la evidencia.
4. Evaluador: detectó que faltaba una restricción positiva esperada y mantuvo
   la abstención.

Esto demuestra que el dato temporal no se convirtió en una restricción
accionable válida antes de cruzar el borde V4→V1. No demuestra si Gemini
omitió `ayer`, devolvió un atributo inconsistente, o si otra condición de
aclaración del hardener bloqueó esa promoción.

La reproducción local con una respuesta sintética válida de `ayer`,
`days:1` y `day_part:afternoon` completa V4→V1→V3 y satisface la aserción.
Una variante con `ayer` y `days:0` reproduce el mismo patrón observable de la
historia: abstención segura y `must_positive:false`.

**Causa exacta:** `NOT PROVEN`.  
**Etapa donde se observa la pérdida:** salida no accionable del hardener /
adaptador V4→V1, antes de V1/V3.  
**Seguridad:** PASS; no hubo restricción prohibida, selección automática ni
acción comercial.

## F3PC-06 — «La visita es hoy por la noche para ENTIDAD_F»

El patrón es equivalente a F3PC-05: HTTP Gemini 200, HTTP público 422,
`semantic_assertions`, `must_positive:false`, abstención y todas las barreras
de seguridad conservadas.

La reproducción local de una respuesta válida de `hoy`, `days:0` y
`day_part:night` pasa el recorrido completo. Una referencia temporal no
verificable reproduce la abstención segura sin convertirla en una restricción
positiva.

**Causa exacta:** `NOT PROVEN`; falta la salida cruda sanitizada por campo.  
**Etapa donde se observa la pérdida:** igual que F3PC-05, antes de V1/V3.  
**Seguridad:** PASS.

## F3PC-07 — HTTP 503

La evidencia contiene `provider_http_status:503`, mientras el handler devolvió
HTTP 422 para representar que el diagnóstico no produjo una comprensión.
`runGeminiV4Probe()` sólo asigna `provider_http_status` cuando recibe una
respuesta HTTP del host de Gemini; por lo tanto está demostrado que el 503 vino
del proveedor, no del normalizador, hardener, adaptador ni de una excepción de
transporte local.

La ruta no ejecutó el pipeline semántico, no produjo restricciones positivas,
no reintentó la llamada y cerró la traza como fallida. La razón detallada del
503 no fue preservada, así que su causa interna es `NOT PROVEN`.

## Corrección local del agregador

Se demostró un defecto de reporte, no de comprensión:

1. La evidencia histórica usa `pipeline.semantic_pass`; el agregador nuevo
   esperaba `pipeline.semantic.pass`. Eso mostraba erróneamente `1/7` en vez
   de reconocer F3PC-01 a F3PC-03.
2. El agregador incluía un HTTP 503 de proveedor en el denominador de fallos
   semánticos.

Se actualizó exclusivamente
`scripts/run-gemini-v4-post-corrections-pending.cjs` para leer ambos formatos
sanitizados y clasificar cada resultado como `semantic_pass`, `semantic_fail`,
`blocked_provider`, `blocked_security` o `not_executed`. No se alteró ninguna
evidencia histórica ni se ejecutó el runner.

La lectura correcta de las siete llamadas consumidas es:

| Clase | Total |
| --- | ---: |
| PASS semántico | 4 (F3PC-01 a 04) |
| FAIL semántico | 2 (F3PC-05 y 06) |
| BLOCKED por proveedor | 1 (F3PC-07) |
| BLOCKED por seguridad | 0 |
| No ejecutado | 9 (F3PC-08 a 16) |

Por tanto, la métrica observada correcta es **4/6 evaluaciones semánticas**,
no 4/7 ni 1/7. Esto no alcanza el umbral requerido y no autoriza reanudar el
lote.

## Pruebas locales

| Batería | Resultado |
| --- | --- |
| Suite compacta | 12/12 PASS |
| Polaridad y contradicción | 18/18 PASS |
| Integración V4→V1→V3 | 15/15 PASS |
| Hardening del adaptador | 14/14 PASS |
| Validación semántica V4 | 5/5 PASS |
| Regresión forense | 6/6 PASS |
| Fixtures post-corrección | 17/17 PASS |
| Preflight de ledger local | 3/3 PASS |
| Nuevas pruebas temporales, 503 y agregador | 7/7 PASS |

Total local: **97/97 PASS**. Todas reportaron `network_calls:0` y
`commercial_actions:0`.

## Ledger y evidencia

La evidencia sanitizada existente marca `trace_closed:true` para F3PC-05,
F3PC-06 y F3PC-07, con una solicitud por fixture y cero reintentos. No se hizo
una nueva lectura remota del ledger en esta fase por la restricción de cero
solicitudes externas; por eso una verificación actual del ledger es
`NOT PROVEN`, aunque el estado histórico queda preservado.

## Archivos modificados

- `scripts/run-gemini-v4-post-corrections-pending.cjs`: compatibilidad de
  evidencia y clasificación correcta de bloqueos del proveedor.
- `scripts/test-yarbi-v4-temporal-forensics-local.cjs`: siete pruebas locales
  de rutas temporales, abstención, evidencia no cruda y agregación.

| Artefacto local nuevo/modificado | SHA-256 |
| --- | --- |
| Runner con agregación compatible | `AB3B3AFEBCCD70B289FECE289978E947D1496CC3D17727992AA2D32B27F87D42` |
| Prueba temporal/503/agregador | `29E07EE09B103E88DBFE80ECF46CD12A21797B64EA45152EA0484606A63DCC3F` |

## Riesgos pendientes y siguiente paso recomendado

No se debe consumir F3PC-08 a F3PC-16 todavía. Antes de una nueva batería real
sería necesario autorizar un mecanismo diagnóstico que conserve únicamente
causas estructurales sanitizadas por mención temporal (sin prompt ni respuesta
cruda), para distinguir omisión del proveedor de atributo no verificable o de
una regla de aclaración. Después debería validarse primero un número pequeño de
fixtures temporales nuevos, nunca repetir los ya consumidos.

**V4 no está aprobada.** La batería permanece detenida, con nueve llamadas no
consumidas y sin integración comercial.
