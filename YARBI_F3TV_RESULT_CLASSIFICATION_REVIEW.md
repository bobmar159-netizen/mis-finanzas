# Yarbi — ajuste local de clasificación F3TV

## Resultado

`PASS — CLASIFICACIÓN DE PRESENTACIÓN CORREGIDA LOCALMENTE`

Este ajuste cambia sólo cómo el runner presenta y agrega evidencia sanitizada. No modifica el handler de Yarbi, el contrato V4, el prompt, el esquema, el hardener, el adaptador, FAST_LOCAL ni módulos comerciales.

## Evidencia histórica inspeccionada

Se leyó sin modificar `scripts/gemini-v4-temporal-validation-evidence.json`.

| Fixture | Hecho histórico | Clasificación corregida |
| --- | --- | --- |
| `F3TV-01` | HTTP Gemini `503`; HTTP público `422`; una llamada; cero reintentos | `BLOCKED_PROVIDER` |
| `F3TV-02` | No fue enviado por la política de parada | `NOT_EXECUTED` |
| `F3TV-03` | No fue enviado por la política de parada | `NOT_EXECUTED` |

La métrica semántica corregida es **`0/0`**: no hubo una respuesta de Gemini apta para evaluación semántica. El bloqueo del proveedor no se incluye como `SEMANTIC_FAIL` ni en el denominador.

## Causa documentada del HTTP público 422

El handler diagnóstico conserva su contrato actual. Tras la llamada al proveedor calcula:

1. `successful` sólo si el proveedor aceptó la respuesta y el pipeline terminó correctamente.
2. `critical` sólo ante una falla de seguridad del pipeline.
3. Si no fue exitoso y tampoco crítico, responde `422`.

Cuando Gemini devolvió `503`, el probe fue no aceptado, el pipeline no se ejecutó y el caso entró a esa tercera rama. Por eso se observa `provider_http_status: 503` junto con `request_http_status: 422`.

La nueva clasificación da prioridad al HTTP sanitizado del proveedor antes de interpretar el HTTP público. Esto documenta el hecho correctamente sin modificar el contrato público ni el comportamiento de Yarbi.

## Cambio local aplicado

- Nuevo módulo de presentación: `scripts/lib/yarbi-f3tv-result-classification.cjs`.
  - Estados explícitos: `SEMANTIC_PASS`, `SEMANTIC_FAIL`, `BLOCKED_PROVIDER`, `BLOCKED_SECURITY` y `NOT_EXECUTED`.
  - Completa los fixtures esperados ausentes como `NOT_EXECUTED`.
  - Excluye `BLOCKED_PROVIDER` del denominador semántico.
- Runner futuro actualizado: `scripts/run-gemini-v4-temporal-validation.cjs`.
  - Publicará un bloque `classification` en una futura evidencia.
  - No se volvió a ejecutar y no alteró la evidencia histórica existente.
- Nueva prueba: `scripts/test-yarbi-f3tv-result-classification-local.cjs`.

## Regresión local

| Prueba | Resultado | Red | Gemini | Acciones comerciales |
| --- | --- | ---: | ---: | ---: |
| Clasificador F3TV nuevo | `6/6 PASS` | 0 | 0 | 0 |
| Forense temporal existente | `7/7 PASS` | 0 | 0 | 0 |
| Handler temporal existente | `6/6 PASS` | 0 | 0 | 0 |
| Sintaxis del runner | `PASS` | 0 | 0 | 0 |

## Integridad

Los hashes SHA-256 de los archivos modificados, las pruebas y la evidencia histórica están en `YARBI_F3TV_RESULT_CLASSIFICATION_REVIEW.sha256`. La evidencia histórica se verificó por hash y no fue reescrita.

## Límites respetados

- Cero llamadas a Gemini, Preview, Supabase o cualquier red.
- Cero despliegues.
- Cero cambios en Production, Vercel, CRM, Agenda, WhatsApp, Meta Ads, voz o APK.
- Cero modificaciones del esquema V4, prompt, hardener, adaptador, FAST_LOCAL o módulos comerciales.

## Pendiente

La calidad temporal de los tres casos sigue `NOT PROVEN`: el único caso enviado fue bloqueado antes del pipeline por disponibilidad del proveedor, y los otros dos no se ejecutaron. Este ajuste no autoriza ni dispara otra llamada.
