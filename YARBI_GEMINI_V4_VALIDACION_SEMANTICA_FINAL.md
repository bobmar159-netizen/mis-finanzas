# Yarbi — validación semántica V4 y cierre de comprensión

## Resultado

**GEMINI_V4_VALIDACION_COMPLETADA_CON_OBSERVACIONES — NO APTA AÚN PARA INTEGRACIÓN COMERCIAL CONTROLADA.**

La batería se ejecutó por completo, una vez por fixture, en el Preview aislado. Gemini aceptó el esquema compacto V4 en los 32 casos (HTTP proveedor 200), pero el resultado semántico fue **18/32** y los casos no ambiguos lograron **18/27 (66.7 %)**, por debajo del mínimo autorizado de 90 %.

No ocurrió una falla crítica de seguridad: ninguna mención negada llegó como restricción positiva, no hubo selección automática, no se invocó el resolvedor y no se ejecutaron acciones comerciales.

## Entorno y límites cumplidos

| Control | Resultado |
| --- | --- |
| Deployment | Preview `dpl_JDoJdUZXytXfKpfPK5N1Y9RVSP9W` |
| URL | `misfinanzas-backend-jgw4u05s9-omar-dfc4.vercel.app` |
| Supabase | Solo `yarbi-audit-preview` (`uevilhbstnmmdlgyshlv`) |
| Llamadas Gemini | 32 de máximo 32 |
| Reintentos | 0 |
| `execute` | `false` en 32/32 |
| CRM, Agenda, WhatsApp, Maps, Calendar, Notion | No invocados |
| Producción, alias, APK | Sin uso ni cambios |
| Persistencia de credenciales, prompts o respuestas crudas | No |

## Preflight local

Todas las suites exigidas pasaron antes de la batería, sin red:

| Suite | Resultado |
| --- | --- |
| Contrato compacto | 12/12 PASS |
| Polaridad y contradicción | 18/18 PASS |
| V4 → V1 → V3 | 15/15 PASS |
| Hardening final del adaptador | 14/14 PASS |
| Ruta diagnóstica / fixtures / compuerta | 5/5 PASS |

## Resultado de la batería real

| Métrica | Valor |
| --- | --- |
| Fixtures completados | 32/32 |
| Semánticamente correctos | 18/32 |
| No ambiguos correctos | 18/27 (66.7 %) |
| HTTP Gemini | 200 en 32/32 |
| Trazas cerradas | 32/32 |
| Falla crítica de seguridad | 0 |
| Esquema V4 | 2,068 bytes |
| SHA-256 del esquema | `c72ccc5895d02dbbb56fa482cca4397f3d119b73f64a707fb45fea7cfcee87c6` |
| Gemini mediana / P95 | 1,418 ms / 2,208 ms |
| Handler mediana / P95 | 2,996 ms / 3,688 ms |
| Round trip mediana / P95 | 8,155 ms / 8,967 ms |

### Familias

| Familia | Resultado |
| --- | --- |
| Negación | 4/4 PASS |
| Ambigüedad | 4/4 PASS |
| Servicio | 4/4 PASS |
| Ubicación | 2/2 PASS |
| Identificación | 2/3 PASS |
| Contradicción | 1/1 PASS |
| Corrección | 0/6 PASS |
| Temporal | 0/3 PASS |
| Continuidad | 1/4 PASS |
| Referencia | 0/1 PASS |

## Fallos observados, sin conservar contenido del proveedor

| Grupo | Fixtures | Resultado sanitizado |
| --- | --- | --- |
| Corrección | `F3V4G-02`, `F3V4G-13`, `F3V4G-15`, `F3V4G-17`, `F3V4F-09`, `F3V4F-12` | Dos respuestas fueron rechazadas por el hardener como `proposed_mention_invalid`; las demás no entregaron el reemplazo positivo requerido o marcaron aclaración donde se esperaba corrección verificable. |
| Temporal | `F3V4G-09`, `F3V4G-16`, `F3V4F-04` | Rechazo `proposed_mention_invalid` en el hardener. |
| Continuidad / referencia | `F3V4G-05`, `F3V4G-10`, `F3V4F-07`, `F3V4F-13` | El modelo/hardener no produjo la abstención o el recorrido esperado de forma consistente. |
| Identificación | `F3V4F-14` | Rechazo `proposed_mention_invalid` en el hardener. |

Estos fallos no son una prueba de que la protección esté mal: los bloqueos ocurrieron antes de cualquier resolución de clientes o acción comercial. La evidencia disponible no conserva la respuesta cruda del proveedor, por diseño, así que no permite atribuir el defecto a un campo específico sin una nueva instrumentación autorizada.

## Seguridad y trazabilidad

- `negated_never_positive_constraint`: PASS cuando el pipeline llegó a las aserciones.
- `may_auto_select_false`: PASS en todos los resultados evaluables.
- Contradicciones no resueltas: bloqueadas o convertidas en abstención segura.
- Resolver local: no invocado.
- Acciones comerciales: cero.
- Egress permitido observado: solamente Supabase aislado (Auth/ledger) y Gemini `generateContent`.
- Cada intento quedó trazado y cerrado en el ledger aislado.

## Auditoría V2

Existe `tests/fixtures/owner-understanding-semantic-v2.json`: 64 fixtures, 64 IDs únicos y 17 familias. Su contrato estructural es válido.

**NOT PROVEN:** no existe un runner V4 compatible que convierta esos 64 casos al contrato V4 sin diseñar una nueva batería/evaluador. No se hicieron llamadas adicionales a Gemini para V2, respetando el límite de 32 llamadas de esta fase.

## Comparación con la investigación previa

- Esquema estructurado original: rechazado por Gemini con HTTP 400.
- Esquema mínimo: aceptado con HTTP 200.
- V4 compacto: aceptado por Gemini en 32/32 con HTTP 200.
- Problema actual: calidad/consistencia semántica de la salida V4 frente al contrato endurecido, no disponibilidad de Gemini ni compatibilidad básica de `responseJsonSchema`.

## Recomendación

No conectar V4 al endpoint comercial ni habilitar acciones sobre clientes todavía.

El siguiente paso mínimo y seguro es una fase local de diagnóstico de compatibilidad V4: instrumentar de forma sanitizada qué regla de forma/semántica dispara `proposed_mention_invalid` y revisar los fixtures de continuidad/corrección para separar expectativa válida de comportamiento que debe permanecer como abstención. Después, una nueva batería aislada debe tener autorización explícita y un conjunto nuevo de fixtures; los 32 de esta fase no deben repetirse automáticamente.

## Evidencia y hashes

| Artefacto | SHA-256 |
| --- | --- |
| `scripts/gemini-v4-semantic-validation-evidence.json` | `ba8df76e483fa14bd68791b49ca231d307185cccfb57f96510c6332a5f1f2df1` |
| `scripts/gemini-v4-semantic-validation-attempt.json` | `a1f16b1d3e16228d1e88d6db8722ee35534582c03cd1fb9d85ba183996f844f4` |
| `PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-v4-semantic-fixtures.js` | `d4da4af120f68f3f34739143addcb15ac7c0fa8237d9fb242b50870f0be26148` |
| `PREVIEW_REFERENCIAS_AISLADO/lib/preview-gemini-v4-validation-policy.js` | `d1c96b8873da45c8ceb97e9092ead941a73264bafb441f44920bf38673c117bd` |
| `PREVIEW_REFERENCIAS_AISLADO/api/diagnostics/gemini-v4-semantic-validation.js` | `6f9dc676ecd16ca5883d2e8b6a5f6ddd2ff51dd177f3774b72f445088f1b2438` |
| `scripts/run-gemini-v4-semantic-validation.cjs` | `be8988f82da40d4e113edd5c363e65890c0e86e5f314d85c77c7f13a73c7a923` |
