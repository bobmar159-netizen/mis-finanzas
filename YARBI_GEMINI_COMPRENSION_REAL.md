# Yarbi — validación real de Gemini en Preview aislado

## Resultado vigente

`GEMINI_COMPRENSION_REAL_VALIDADA_CON_OBSERVACIONES`

La batería canónica completa se ejecutó realmente contra `gemini-3.5-flash-lite`. Gemini mantuvo el contrato estructurado en los 14 casos y nunca habilitó ejecución, pero la primera pasada logró **8/14 casos semánticos (57.14 %)**. Seis casos fallaron; cuatro mostraron fallos sistemáticos en todos sus reintentos y dos presentaron variabilidad.

El resultado anterior `GEMINI_COMPRENSION_REAL_MINIMA_VALIDADA_EN_AISLADO` queda conservado como antecedente: acreditó conectividad y un recorrido mínimo, pero queda sustituido como conclusión vigente por esta batería completa.

## Entorno comprobado

- Preview aislado: `misfinanzas-backend-lnhz2typw-omar-dfc4.vercel.app`.
- Deployment: `dpl_B2CHZxxdjdrMsYWhb2GmhmXXhkRn`, `target=preview`, `productionUrl=null`.
- Supabase aislado: `uevilhbstnmmdlgyshlv`.
- Modelo único: `gemini-3.5-flash-lite`.
- Dataset: `yarbi.owner-understanding-dataset.v1`.
- Configuración de timeout durante la batería: 10 segundos, sin cambios.
- Paralelismo del runner: 3, sin cambios respecto de la línea base.
- Producción: no utilizada ni modificada.

## Batería semántica real completa

| Caso | Primera pasada | Reintentos | Hallazgo |
|---|---|---|---|
| `F3G-CORRECTION` | PASS | No requeridos | Corrección y distrito correctos |
| `F3G-CONFIRMATION` | PASS | No requeridos | Confirmación con estado compacto |
| `F3G-CONTINUATION` | PASS | No requeridos | Continuidad con estado compacto |
| `F3G-CANCEL` | PASS | No requeridos | Cancelación de tarea correcta |
| `F3G-CANCEL-AMBIGUOUS` | FAIL | 0/3 PASS; un 429 | Asignó un alcance de cancelación distinto de `unknown` |
| `F3G-TEMPORAL` | PASS | No requeridos | Conservó los 30 días como aproximación |
| `F3G-DAY-PART` | FAIL | 2/3 PASS | Variabilidad al representar `morning` |
| `F3G-TEMPORAL-CORRECTION` | FAIL | 2/3 PASS | Variabilidad al corregir a `night` |
| `F3G-LOCATION` | PASS | No requeridos | Distrito Ventanilla correcto |
| `F3G-SERVICE` | FAIL | 0/3 PASS | No normalizó `punto_adicional` e inventó un nombre |
| `F3G-RECENT` | PASS | No requeridos | Franja `morning` correcta |
| `F3G-COMBINED` | PASS | No requeridos | Nombre, distrito y noche correctos |
| `F3G-AMBIGUOUS` | FAIL | 0/3 PASS | No marcó como ambigua la referencia “El Carlos” |
| `F3G-RECURRENT` | FAIL | 0/3 PASS | Inventó un tipo de servicio no declarado |

### Clasificación de los fallos

- Variables: `F3G-DAY-PART`, `F3G-TEMPORAL-CORRECTION`.
- Sistemáticos: `F3G-CANCEL-AMBIGUOUS`, `F3G-SERVICE`, `F3G-AMBIGUOUS`, `F3G-RECURRENT`.
- Alucinaciones en la primera pasada: 2 casos.
  - `F3G-SERVICE`: nombre inventado.
  - `F3G-RECURRENT`: servicio inventado.
- Error de proveedor: una respuesta HTTP 429 durante un reintento de `F3G-CANCEL-AMBIGUOUS`.
- Timeouts reales: 0. El 429 fue inicialmente agrupado por el resumen automático como `understanding_unavailable`; la evidencia detallada lo identifica como `owner_understanding_rate_limited_429`, por lo que no se contabiliza como timeout.

## Métricas de calidad

| Métrica | Resultado |
|---|---:|
| Casos reales de primera pasada | 14 |
| Aciertos semánticos | 8/14 |
| `semantic_accuracy` | 57.14 % |
| Contratos válidos | 14/14 |
| `schema_accuracy` | 100 % |
| Alucinaciones, primera pasada | 2 |
| Timeouts reales | 0 |
| Errores de proveedor | 1 (HTTP 429) |
| Llamadas Gemini reales | 32 = 14 iniciales + 18 reintentos |
| `execute=false` | 32/32 |

## Latencia real

Las estadísticas excluyen el reintento que terminó en HTTP 429 y no produjo tiempo Gemini/servidor. Por ello `n=31` para latencias, aunque se realizaron 32 llamadas reales.

| Etapa | n | Mínimo | p50 | p95 | Máximo |
|---|---:|---:|---:|---:|---:|
| Gemini | 31 | 1,991 ms | 2,189 ms | 3,045 ms | 3,337 ms |
| Total servidor | 31 | 2,953 ms | 3,736 ms | 5,220 ms | 5,223 ms |

### Distribución Gemini

| Intervalo | Llamadas |
|---|---:|
| `< 1 s` | 0 |
| `1–2 s` | 1 |
| `2–3 s` | 27 |
| `3–4.5 s` | 3 |
| `4.5–10 s` | 0 |
| Timeout | 0 |

El recorrido completo del runner/CLI no se mezcló con estas métricas.

## FAST_LOCAL

Se ejecutaron tres regresiones separadas de la batería Gemini:

- 3/3 `PASS`.
- Ruta `FAST_LOCAL` en los tres casos.
- Gemini no fue llamado.
- `execute=false` en los tres casos.
- Resultado determinista según el contrato probado.

## Estado conversacional y privacidad

Los casos dependientes del turno anterior usaron únicamente estado compacto: tarea, intención, presencia de entidad activa, restricciones no identificadoras y última pregunta breve. No se enviaron CRM, candidatos, teléfonos, IDs, owner scope ni historial completo.

La evidencia sanitizada no contiene API keys, contraseñas, JWT, frases completas, teléfonos, clientes reales ni secretos. Gemini actuó únicamente como parser. No hubo escrituras de CRM, Agenda, WhatsApp, Calendar, Maps, Notion ni acciones comerciales.

## Regresión local y despliegue

- Pruebas locales relevantes: **13/13 PASS**.
- Preview protegido por Vercel Authentication.
- Una sola Function en el deployment aislado.
- Alias de producción comprobado por lectura: continúa apuntando al deployment de producción anterior `dpl_3KHdcxT1Hvi7ZufphvQeNKSA4DtJ`, creado el 22 de octubre de 2026.
- No se utilizó `--prod` ni se promovió el Preview.

## Archivos principales

- `lib/yarbi-owner-understanding.js`.
- `lib/yarbi-gemini-owner-understanding.js`.
- `api/assistant/reference-candidates.js`.
- Copias equivalentes en `PREVIEW_REFERENCIAS_AISLADO/`.
- `scripts/run-gemini-owner-understanding-real.cjs`.
- `scripts/lib/gemini-semantic-evaluation.cjs`.
- `tests/owner-gemini-reference-route.test.js`.
- Evidencia: `scripts/gemini-owner-understanding-real-evidence.json`.

## Conclusión

El recorrido aislado es seguro y estructuralmente consistente, pero la calidad semántica del modelo no es suficiente para declarar `GEMINI_COMPRENSION_ESTRUCTURADA_VALIDADA_EN_AISLADO`. Antes de usarlo para decisiones naturales de Yarbi deben corregirse por separado los cuatro fallos sistemáticos y estabilizarse los dos casos variables, sin ajustar los resultados esperados para ocultarlos.

---

## Endurecimiento estructurado posterior — 2 de noviembre de 2026

### Resultado vigente

`GEMINI_COMPRENSION_ENDURECIDA_CON_OBSERVACIONES`

Este bloque conserva íntegra la historia anterior. Se introdujo un contrato de salida endurecido `yarbi.owner-understanding.v2`: Gemini continúa extrayendo lenguaje bajo el contrato de proveedor v1, y el backend valida procedencia, normaliza hechos deterministas y conserva una señal `semantic_safety` antes de que cualquier resolvedor o política use el resultado.

La prueba controlada ejecutó tres rondas de los seis fallos históricos. La compuerta se detuvo conforme al criterio acordado porque `F3G-SERVICE` falló las tres veces. Por ello la batería fresca de 14 casos **no fue ejecutada** y ningún resultado previo se reutilizó.

| Métrica de compuerta | Resultado |
|---|---:|
| Casos | 6 × 3 rondas = 18 |
| Correctos semánticos | 15/18 |
| Contrato v2 válido | 18/18 |
| Alucinaciones | 3 |
| Errores de proveedor | 0 |
| Timeouts | 0 |
| `execute=false` | 18/18 |
| Batería 14 fresca | No ejecutada por compuerta fallida |

### Resultado de los seis fallos originales

| Caso | Resultado en 3 rondas | Observación |
|---|---|---|
| `F3G-CANCEL-AMBIGUOUS` | PASS 3/3 | Conservó `cancel_scope=unknown`; no decidió una cancelación real. |
| `F3G-DAY-PART` | PASS 3/3 | Normalizó mañana de forma estable. |
| `F3G-TEMPORAL-CORRECTION` | PASS 3/3 | La corrección a noche sustituyó la pista temporal anterior. |
| `F3G-SERVICE` | FAIL 3/3 | Se detectó `invented_name` en las tres rondas. |
| `F3G-AMBIGUOUS` | PASS 3/3 | Produjo referencia parcial; el resolver, no Gemini, conserva la responsabilidad de decidir si hay varias coincidencias. |
| `F3G-RECURRENT` | PASS 3/3 | Conservó la relación histórica y no inventó un servicio. |

### Causa observada del fallo restante

El guard actual comprobó si un supuesto nombre aparecía literalmente en la frase. En `F3G-SERVICE`, una frase de servicio puede aparecer también en el campo `name` emitido por Gemini. La comprobación léxica lo considera procedente aunque semánticamente pertenezca al tipo `service`. No es aceptable declarar ese hecho como nombre solo porque sus palabras están en la frase.

La corrección futura debe ser una validación **tipada**: un nombre no puede aceptar como evidencia un alias del catálogo de servicios; debe ser una referencia nominal válida o una coincidencia permitida del estado conversacional. Esta observación se documenta sin cambiar el código durante este cierre, tal como exige la compuerta.

### Latencia observada en la compuerta

| Etapa | n | Mínimo | p50 | p95 | Máximo |
|---|---:|---:|---:|---:|---:|
| Gemini | 18 | 1,794 ms | 2,179 ms | 2,846 ms | 2,846 ms |
| Servidor | 18 | 3,147 ms | 4,043 ms | 4,949 ms | 4,949 ms |

El modelo se mantuvo en `gemini-3.5-flash-lite`; no se alteró timeout ni la arquitectura de latencia.

### Aislamiento y seguridad

- Preview aislado usado: `misfinanzas-backend-2ar2nqmeu-omar-dfc4.vercel.app`.
- Supabase aislado: `uevilhbstnmmdlgyshlv`.
- Producción, Vercel Production, APK, CRM, Agenda, WhatsApp, Calendar, Maps y Notion no fueron usados ni modificados.
- La evidencia no conserva credenciales, JWT, contraseñas, conversaciones ni clientes reales.
- No se ejecutó una acción comercial: `execute=false` en las 18 respuestas.

---

## Segundo gate tras arbitraje tipado — 2 de noviembre de 2026

Se aplicó una barrera de tipo semántico para separar `service`, `temporal` y
referencia nominal antes de aceptar hechos del proveedor. El Preview aislado
usado fue `misfinanzas-backend-e0zstcbjq-omar-dfc4.vercel.app`
(`dpl_FCSUYqcVuWCVbX62vM87eWDwZv2p`); Production no se desplegó ni se consultó.

El gate se ejecutó de nuevo contra las mismas seis familias y tres rondas:

| Métrica | Resultado |
|---|---:|
| Semántica | 16/18 |
| Schema v2 | 18/18 |
| `execute=false` | 18/18 |
| Provider errors / timeouts | 0 / 0 |
| Alucinaciones | 2 |
| Batería nueva de 14 | No ejecutada |

Los dos fallos se concentran en `F3G-SERVICE` y se clasificaron como
`invented_name`; una de las tres rondas pasó. La evidencia se mantiene
sanitizada y por diseño no conserva el valor de nombre propuesto, de modo que
la forma exacta de la salida defectuosa es `NOT PROVEN`. La compuerta no se
considera aprobada, y se respetó la detención antes de gastar 14 llamadas
adicionales.

Latencia observada: Gemini p50/p95 `2,198 / 2,915 ms`; servidor p50/p95
`4,212 / 4,978 ms`. No hubo operaciones comerciales, ni CRM write, Agenda,
WhatsApp, Maps, Notion, Calendar, APK o Production.

Conclusión vigente: `GEMINI_COMPRENSION_ENDURECIDA_CON_OBSERVACIONES`.

