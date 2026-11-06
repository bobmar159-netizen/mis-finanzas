# Yarbi — diagnóstico forense local de comprensión V4

## Resultado

**DIAGNÓSTICO_LOCAL_COMPLETADO — V4 SIGUE SIN APTITUD PARA INTEGRACIÓN COMERCIAL.**

Esta fase no invocó Gemini, no desplegó código y no accedió a Supabase, Vercel, CRM, Agenda, WhatsApp, Maps, Calendar, Notion, voz, APK ni Producción.

Se preservó la evidencia de la batería anterior: 32 respuestas de proveedor HTTP 200, 18/32 resultados semánticos correctos y cero fallos críticos de seguridad. La evidencia no conserva prompts ni respuestas crudas del proveedor; por ello, toda causa que dependa del contenido histórico exacto de Gemini se clasifica como **NOT PROVEN**.

## Evidencia preservada

| Artefacto | SHA-256 verificado | Estado |
| --- | --- | --- |
| Informe de validación V4 anterior | `1beece0ad6a3c9092a29a979224adfc3712be38bf4e0a93e668a8d4f3d7541ae` | PASS |
| Evidencia sanitizada de 32 llamadas | `ba8df76e483fa14bd68791b49ca231d307185cccfb57f96510c6332a5f1f2df1` | PASS |
| Registro de intento | `a1f16b1d3e16228d1e88d6db8722ee35534582c03cd1fb9d85ba183996f844f4` | PASS |
| Fixtures V4 | `d4da4af120f68f3f34739143addcb15ac7c0fa8237d9fb242b50870f0be26148` | PASS |
| Política de preview V4 | `d1c96b8873da45c8ceb97e9092ead941a73264bafb441f44920bf38673c117bd` | PASS |
| Runner de la batería anterior | `be8988f82da40d4e113edd5c363e65890c0e86e5f314d85c77c7f13a73c7a923` | PASS |
| Adaptador V4 → V1 | `b7fcf691b5e417b611b046ce4cecb8610e40133cf020be5a126fb57b86ba4615` | PASS, sin cambios |

Los artefactos de la batería anterior no se reescribieron. La nueva evidencia de diagnóstico es sanitizada y no contiene frases, nombres, teléfonos, prompts, respuestas, tokens ni claves.

## Auditoría de los 32 fixtures

| Familia | Resultado histórico | Lectura forense |
| --- | ---: | --- |
| Negación | 4/4 | PASS de seguridad. Una mención negada nunca llegó como restricción positiva. |
| Ambigüedad | 4/4 | PASS. El comportamiento fue abstención/solicitud de aclaración. |
| Servicio | 4/4 | PASS. |
| Ubicación | 2/2 | PASS. |
| Identificación | 2/3 | Un fallo por `proposed_mention_invalid`; causa específica del proveedor NOT PROVEN. |
| Contradicción | 1/1 | PASS seguro. |
| Corrección | 0/6 | Mezcla de defecto del pipeline, instrucción limitada y salida histórica no disponible. |
| Temporal | 0/3 | La forma temporal fue afectada por el defecto de traspaso normalizado; el futuro sigue sin fecha base. |
| Continuidad | 1/4 | Parte de la expectativa exigía continuidad sin suficiente estado conversacional. |
| Referencia | 0/1 | La recuperación de una referencia anterior no puede demostrarse con el estado minimizado enviado. |

### Fallos concretos de la ejecución anterior

| Fixtures | Etapa observada | Clasificación actual |
| --- | --- | --- |
| `F3V4G-02`, `F3V4G-09`, `F3V4G-16`, `F3V4F-04`, `F3V4F-07`, `F3V4F-09`, `F3V4F-14` | `v4_hardener / proposed_mention_invalid` | El error histórico del proveedor NO está disponible. Se demostró localmente una incompatibilidad de forma en el camino normalizador → hardener capaz de producir este resultado. |
| `F3V4G-05`, `F3V4G-10` | Aserciones de continuidad | EXPECTATION/CONTEXT. El prompt solo recibía un estado reducido; la V4 no representa una continuación accionable sin una restricción positiva verificada. |
| `F3V4G-13`, `F3V4G-15`, `F3V4G-17`, `F3V4F-12` | Aserciones de corrección | Defecto de emparejamiento por dimensión y una instrucción de corrección demasiado centrada en nombres; salida histórica exacta NOT PROVEN. |
| `F3V4F-13` | Aserciones de referencia | EXPECTATION/CONTEXT. No había historial suficiente ni recuperación de candidatos autorizada en esta ruta diagnóstica. |

`F3V4F-04` conserva correctamente una expectativa de aclaración: el contrato no recibe fecha base ni zona horaria, por lo que una referencia futura no debe convertirse en una fecha determinada. No se añadió una inferencia artificial.

## Causas demostradas localmente

### 1. Incompatibilidad de la forma normalizada

**DEMONSTRATED_LOCAL.** La ruta real de validación hacía:

`strictNormalizeProposed(raw) → hardenProposed(normalized)`.

La normalización estricta aplana los atributos temporales; el hardener original volvía a usar el validador que esperaba atributos anidados. Como consecuencia, un resultado ya validado podía ser rechazado como `proposed_mention_invalid` al entrar al hardener.

Corrección local: `strictForHardening()` reconstruye únicamente la forma de entrada estricta antes de validarla otra vez. No acepta campos, tipos ni valores nuevos.

Rutas sanitizadas afectadas:

- `mentions[*].attributes.days`
- `mentions[*].attributes.day_part`
- `mentions[*].attributes.present`

### 2. Correcciones con menciones independientes

**DEMONSTRATED_LOCAL.** La lógica previa podía exigir una sola pareja negada/afirmada para toda la frase. Eso es incorrecto cuando una corrección de una dimensión aparece junto con servicio o tiempo independientes.

Corrección local: la pareja de corrección se evalúa por dimensión (`name`, `service`, `location`, `recency`), exige coherencia de tipo y conserva el bloqueo si hay pares ambiguos, cruzados o sin evidencia.

### 3. Negación de alcance indebido

**DEMONSTRATED_LOCAL.** Una negación dirigida a una entidad podía degradar a `negation_elsewhere` menciones independientes verificadas por texto. Ello impedía al adaptador usar restricciones positivas seguras de otra dimensión.

Corrección local: la polaridad se mantiene por mención. Una negación explícita sigue bloqueando una afirmación de la misma mención; una negación sobre otra dimensión no se utiliza como prueba de conflicto para una mención distinta. La procedencia literal y el bloqueo de ambigüedad permanecen obligatorios.

### 4. Instrucción y estado conversacional insuficientes

**DEMONSTRATED_STATIC / NOT PROVEN para cada salida histórica.** El prompt remitía solo la restricción activa de nombre. No incluía contexto de servicio, ubicación, turno, fecha base, zona horaria, historial de diálogo ni candidatos. Por ello:

- Las correcciones generales de servicio/ubicación no recibían una instrucción tan clara como las de nombre.
- Continuidad y referencia no pueden resolverse de manera fiable cuando falta el antecedente.
- El futuro relativo no puede convertirse en fecha absoluta sin una fecha base autorizada.

Se generalizó localmente la instrucción de corrección por dimensión. No se añadieron reglas específicas por fixture ni un diccionario masivo.

### 5. Comportamiento exacto de Gemini en cada fallo

**NOT PROVEN.** La evidencia deliberadamente no guarda la respuesta cruda del proveedor. Por privacidad y el alcance autorizado, no se vuelve a llamar al modelo ni se inventa qué campo produjo cada rechazo histórico.

## Cambios locales y límites

| Archivo | Cambio | Alcance |
| --- | --- | --- |
| `PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-understanding-polarity-proposal.js` | Conversión estricta de atributos normalizados, emparejamiento por dimensión, guardia de negación por mención y diagnóstico sanitizado `diagnoseProposed()`. | Propuesta V4 experimental; no endpoint comercial. |
| `PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-gemini-v4-probe.js` | Instrucción general para correcciones explícitas de la misma dimensión. | Solo sonda/validación V4. |
| `scripts/test-yarbi-v4-forensic-regression-local.cjs` | Seis regresiones sintéticas del pipeline completo. | Solo local, sin red. |
| `scripts/yarbi-v4-forensic-local-evidence.json` | Traza sanitizada de reglas, rutas y límites de evidencia. | Solo evidencia. |

No cambió el contrato comercial activo, el resolvedor, ranking, CRM, Agenda, WhatsApp, voz, APK, Vercel ni Producción.

## Pruebas locales posteriores

| Suite | Resultado |
| --- | --- |
| Contrato compacto | 12/12 PASS |
| Polaridad y contradicción | 18/18 PASS |
| Integración V4 → V1 → V3 | 15/15 PASS |
| Hardening del adaptador | 14/14 PASS |
| Ruta/fixtures diagnósticos | 5/5 PASS |
| Regresión forense nueva | 6/6 PASS |
| Total dirigido | **70/70 PASS** |
| Llamadas de red / acciones comerciales | **0 / 0** |

Las regresiones nuevas cubren corrección con atributos temporales, corrección de ubicación, corrección de servicio, continuidad sin restricción accionable, entrada temporal malformada y prohibición de convertir una negación de nombre en restricción positiva.

## Seguridad conservada

- Las negaciones explícitas no se convierten en restricciones positivas.
- Una corrección ambigua, cruzada o sin pareja coherente sigue requiriendo aclaración.
- `may_auto_select` permanece `false`.
- Sin procedencia textual verificable no hay restricción positiva.
- Las referencias temporales futuras sin fecha base siguen en abstención segura.
- El adaptador no convierte continuidad sola en una acción/candidato.

## Limitaciones pendientes

1. **NOT PROVEN:** el porcentaje real posterior con Gemini. Esta fase no autorizó ninguna llamada.
2. **NOT PROVEN:** cuál campo exacto devolvió Gemini en cada `proposed_mention_invalid` histórico.
3. **NOT PROVEN:** continuidad y referencia de conversación con contexto real completo. La sonda V4 solo recibió estado minimizado.
4. **PENDING:** definir un contexto conversacional mínimo, con fecha/zona horaria verificables, antes de pedir resoluciones temporales futuras.
5. **PENDING:** autorización explícita para un preview aislado y una batería nueva; no se debe repetir automáticamente la batería de 32 casos.

## Recomendación

El siguiente paso más pequeño es una **validación aislada nueva y autorizada**, con fixtures nuevos (no los 32 históricos), que mida por separado:

1. corrección por dimensión con contexto suficiente;
2. temporal pasado frente a futuro con fecha base;
3. continuidad que tenga un antecedente estructurado;
4. seguridad de negación y abstención.

Solo si los casos no ambiguos alcanzan al menos 90 % y los críticos de seguridad se mantienen en 100 %, se debería evaluar integrar V4 en una ruta no comercial. Hasta entonces, Yarbi comercial permanece intacto.

## Hashes finales

| Artefacto actualizado/creado | SHA-256 |
| --- | --- |
| `PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-understanding-polarity-proposal.js` | `3a613b95c1d4444c3bd919916659e2ff211683b75770a5d354a93d5b0662ed7f` |
| `PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-gemini-v4-probe.js` | `154ca5323ed991f3cedc40f22eac7da94aa809b5ffebf5938c54cac8d5dfaec4` |
| `scripts/test-yarbi-v4-forensic-regression-local.cjs` | `f0872c46fe779df7357ffb9a8a1aa5943e6aac2227c5953b340270b33cd3aba9` |
| `scripts/yarbi-v4-forensic-local-evidence.json` | `ae25e45eec54699720b20346d3f4083811b8363489b147bea7abb1b10a2181db` |

El SHA-256 de este informe se calculó después de cerrar el contenido y se entrega junto a la evidencia final; no se incluye dentro del propio archivo para no alterar el valor verificado.

