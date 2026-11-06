# Yarbi — instrumentación estructural sanitizada V4

## Resultado

`YARBI_V4_TEMPORAL_INSTRUMENTATION_LOCAL_READY`

Se implementó observabilidad local, estructural y de lista permitida para seguir una referencia temporal a través del recorrido V4. La instrumentación no modifica la interpretación, el prompt, el contrato V4, los hardeners, el adaptador ni las decisiones comerciales.

No se ejecutaron llamadas a Gemini, Preview, Vercel, Supabase remoto ni producción.

## Alcance implementado

Los puntos observados son, en este orden fijo:

1. `provider_input`
2. `v4_normalize`
3. `v4_hardener`
4. `v4_v1_adapter`
5. `v1_normalize`
6. `v3_hardener`
7. `semantic_evaluation`

Cada etapa registra solo: identificador local de mención sintética, categoría de referencia, presencia/categoría de atributos, polaridad, procedencia categórica, consistencia estructural, decisión y razón permitida. El identificador se reconstruye localmente como `tm_N`; no reutiliza identificadores de proveedor, clientes ni mensajes.

Las razones están cerradas al catálogo aprobado. Entre ellas: `TEMPORAL_ATTRIBUTE_INCONSISTENT`, `TEMPORAL_NORMALIZATION_REJECTED`, `TEMPORAL_ADAPTER_REJECTED`, `TEMPORAL_DOWNSTREAM_NOT_REACHED`, `TEMPORAL_VERIFICATION_PASSED`, `PROVIDER_UNAVAILABLE` y `DIAGNOSTIC_REASON_NOT_PROVEN`.

## Cambios locales

| Archivo | Cambio |
| --- | --- |
| `PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-v4-temporal-diagnostics.js` | Nuevo observador sanitizado, catálogo cerrado, normalizador de evidencia y diagnóstico de proveedor no disponible. |
| `PREVIEW_REFERENCIAS_AISLADO/api/diagnostics/gemini-v4-semantic-validation.js` | Propaga el diagnóstico a través del pipeline local y de su salida/traza diagnóstica. |
| `PREVIEW_REFERENCIAS_AISLADO/api/diagnostics/gemini-v4-post-corrections-validation.js` | Expone y registra el mismo diagnóstico sanitizado para la ruta que produjo F3PC-05/06/07. |
| `PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-trace.js` | Permite persistir exclusivamente el objeto previamente sanitizado en el ledger de trazas. |
| `scripts/test-yarbi-v4-temporal-instrumentation-local.cjs` | Pruebas locales estructurales, de privacidad y de no-regresión. |

## Privacidad y separación

La evidencia no conserva ni expone:

- textos de usuario, prompts o respuestas crudas de Gemini;
- nombres, teléfonos, UUID, JWT, claves o credenciales;
- fechas personales exactas;
- mensajes de error arbitrarios del proveedor.

El sanitizador vuelve a construir cada etapa y mención desde listas permitidas. Campos inyectados o no reconocidos se descartan antes de llegar a la respuesta pública o al ledger. La prueba local verificó explícitamente que una cadena arbitraria y un token con forma de JWT no se preservan.

## Pruebas locales

| Grupo | Resultado |
| --- | --- |
| Regresión existente | 97/97 PASS |
| Instrumentación nueva | 8/8 PASS |
| Total | 105/105 PASS |

La cobertura nueva incluye referencias temporales sintéticas pasada/tarde, presente/noche y futura/mañana; inconsistencia de atributos; rechazo estructural V4; proveedor no disponible; no ejecución descendente; sanitización; y persistencia sanitizada en el ledger.

Los fallos estructurales quedan representados como abstención/rechazo estructural: no se transforman en una restricción positiva. Las etapas posteriores quedan con `TEMPORAL_DOWNSTREAM_NOT_REACHED` cuando corresponde.

## Evidencia

La evidencia es exclusivamente sintética y categórica: `scripts/yarbi-v4-temporal-instrumentation-evidence.json`.

No se consumieron F3PC-08 a F3PC-16 ni se repitió ningún fixture remoto histórico. No se hicieron modificaciones a CRM, Agenda, WhatsApp, Meta Ads, voz, APK, FAST_LOCAL, owner scope, ranking o resolvedor.

## Discrepancia documental preservada

El documento de autorización citó para `YARBI_GEMINI_V4_DIAGNOSTICO_TEMPORAL_503.md` el hash `5B6024…`. La copia local existente conserva el hash `CBA57967C34C829BA5202A381907C17E09A910A6E946680F666EA53A7194026D`.

No se reemplazó ni alteró ese informe histórico. Por tanto, el origen de la discrepancia sigue `NOT PROVEN`; se mantiene visible para una revisión documental posterior.

## Riesgos y siguiente paso

Esta instrumentación muestra qué etapa acepta, abstiene, rechaza o no alcanza la información temporal, pero no convierte por sí sola los resultados anteriores de Gemini en evidencia adicional: las respuestas crudas históricas fueron eliminadas intencionalmente.

El siguiente paso, si se autoriza expresamente, sería un despliegue Preview aislado de esta instrumentación y una ejecución nueva, controlada y sintética. No se ha preparado ni realizado ese despliegue en esta fase.

## Integridad

Los SHA-256 de los artefactos definitivos están en `YARBI_GEMINI_V4_INSTRUMENTACION_TEMPORAL_SANITIZADA.sha256`.
