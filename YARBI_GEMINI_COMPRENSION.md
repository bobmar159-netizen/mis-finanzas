# Yarbi — Gemini como proveedor de comprensión

## Resultado

`GEMINI_COMPRENSION_PREPARADA_LOCALMENTE`

La integración quedó implementada y validada localmente con respuestas Gemini simuladas. No se usó una clave real, no se llamó a Gemini real y no hubo despliegue. Por ello no se declara validación real en aislado.

## Arquitectura aplicada

`frase natural → Gemini (solo interpretación) + owner scope canónico en paralelo → recuperación acotada de candidatos → resolvedor determinista → respuesta execute:false`

- `lib/yarbi-gemini-owner-understanding.js` implementa el proveedor desacoplado de Gemini detrás de la interfaz ya existente de `yarbi-owner-understanding`.
- `api/assistant/reference-candidates.js` mantiene el camino `FAST_LOCAL` para solicitudes ya estructuradas y usa `NEEDS_LANGUAGE_MODEL` únicamente cuando llega una frase natural.
- El scope se calcula desde la sesión autenticada y corre en paralelo con Gemini solo después de validar JWT.
- Gemini nunca recibe candidatos CRM, teléfonos, IDs de contacto, owner scope, secretos ni historiales completos. El resolvedor determinista conserva la autoridad sobre candidatos, ranking, ambigüedad y pregunta mínima.
- Toda respuesta positiva continúa declarando `execute:false`.

Se inspeccionaron las rutas Gemini históricas (`api/assistant/command.js`, `api/assistant/chat.js`, `api/ai/process.js`, `api/webhook.js`). No se reutilizaron: mezclan responsabilidades comerciales o rutas históricas fuera del alcance. El nuevo proveedor HTTP queda aislado de ellas.

## Datos enviados a Gemini

El único payload permitido, construido por `buildGeminiUnderstandingContext(...)`, contiene:

- la frase actual, limitada a 1,200 caracteres;
- estado compacto de tarea e intención;
- indicador booleano de que existe entidad activa;
- pistas no sensibles de nombre, distrito, servicio, ubicación, recencia y franja horaria cuando existan.

No contiene CRM, listas de candidatos, teléfonos, `contact_id`, `owner_id`, scope, conversaciones, claves, JWT ni datos `service_role`.

El proveedor solicita JSON estructurado mediante `responseMimeType: application/json` y un JSON Schema limitado a `yarbi.owner-understanding.v1`. Aun así, la respuesta se valida nuevamente en backend antes de consultar candidatos.

## Seguridad y fallos

| Criterio | Resultado |
|---|---|
| Solo Preview aislado y ref autorizado | PASS |
| Gemini requiere bandera explícita `YARBI_PREVIEW_OWNER_GEMINI_UNDERSTANDING=true` | PASS |
| Clave ausente con Gemini habilitado falla cerrada | PASS |
| Clave presente sin bandera explícita falla cerrada | PASS |
| Timeout explícito | PASS: 4,500 ms por defecto, acotado a 750–8,000 ms |
| Reintentos largos en flujo interactivo | PASS: no se agregaron |
| JSON inválido o contrato inválido | PASS: `understanding_unavailable`, sin acción |
| 429 / 5xx | PASS: error recuperable sin interpretación inventada |
| Prompt injection / SQL / pedir secretos | PASS: solo parser; nunca habilita acciones |
| Egress comercial | PASS en mocks: solo host Gemini simulado y Supabase aislado simulado |
| Gemini real con clave aislada | NOT PROVEN |

También se corrigió un defecto de normalización: un `days: null` podía convertirse en `0` por la coerción de JavaScript. Eso podía introducir un filtro temporal de “hoy” en una consulta que solo mencionaba un nombre. Los valores temporales vacíos ahora permanecen ausentes.

## Dataset semántico

`tests/fixtures/owner-understanding-semantic-v1.json` contiene 14 casos sintéticos con corrección, confirmación, continuidad, cancelación, tiempo aproximado, mañana/noche, ubicación, servicio, referencia reciente, combinación, ambigüedad y cliente recurrente.

Ejemplos de estructura esperada:

- “Ábreme el Carlos de Comas” → `target_reference.name=Carlos`, `district=Comas`.
- “No, ese no, el otro Carlos” → acto `correction`, alternativa/ambigüedad estructurada; el resolvedor decide la pregunta mínima.
- “El cliente que escribió esta mañana” → pista temporal estructurada; no identifica una fila por sí sola.
- “Déjalo” → cancelación de tarea; no ejecuta ninguna acción.
- “Era el que quería un punto adicional” → servicio estructurado; no crea ni modifica datos comerciales.

En el dataset sintético de frases humanas, 14/14 (100 %) requieren `NEEDS_LANGUAGE_MODEL`. Las solicitudes ya estructuradas siguen por `FAST_LOCAL` y no invocan Gemini. Esto no es una métrica de uso real de usuarios.

## Latencia local medida

Las mediciones corresponden a 20 ejecuciones con Supabase y Gemini simulados localmente; no representan la red ni el modelo real.

| Ruta | p50 | p95 | máximo | Resultado |
|---|---:|---:|---:|---|
| `FAST_LOCAL` | 1.223 ms | 2.235 ms | 2.576 ms | PASS |
| `NEEDS_LANGUAGE_MODEL` con Gemini mock | 15 ms | 19 ms | 34 ms | PASS |

Se miden y devuelven de forma sanitizada: `auth_ms`, `owner_scope_ms`, `gemini_ms`, `candidate_ms`, `resolver_ms`, `trace_ms`, `total_ms`, además de submétricas de consulta. La latencia, p50/p95, cuota y errores del proveedor real quedan `NOT PROVEN` hasta una prueba con una clave aislada.

## Pruebas ejecutadas

```text
node --check lib/yarbi-gemini-owner-understanding.js
node --check api/assistant/reference-candidates.js
node --test tests/yarbi-gemini-owner-understanding.test.js \
  tests/owner-gemini-reference-route.test.js \
  tests/yarbi-owner-conversation.test.js \
  tests/yarbi-owner-reference-candidates.test.js \
  tests/owner-reference-candidates-endpoint.test.js
```

Resultado: **35/35 PASS**.

Las pruebas verificaron contrato JSON, payload minimizado, respuesta inválida, cuota, timeout, prompt injection, ruta rápida, ruta Gemini mock, paralelismo scope+Gemini, conservación de `execute:false`, límites de scope, filtros deterministas y ausencia de egress externo en la simulación.

## Archivos modificados

- `lib/yarbi-gemini-owner-understanding.js` — nuevo proveedor Gemini minimizado y con timeout.
- `lib/preview-owner-reference-policy.js` — habilitación explícita y fail-closed de Gemini para Preview aislado.
- `api/assistant/reference-candidates.js` — selección de ruta, paralelismo seguro y métricas sanitizadas.
- `lib/yarbi-owner-understanding.js` — corrección de pistas temporales nulas.
- `tests/fixtures/owner-understanding-semantic-v1.json` — dataset sintético versionado.
- `tests/yarbi-gemini-owner-understanding.test.js` — contrato, privacidad, error y timeout.
- `tests/owner-gemini-reference-route.test.js` — recorrido real del handler con dependencias simuladas.
- `tests/owner-reference-candidates-endpoint.test.js` — línea base `FAST_LOCAL` reproducible.

Los SHA-256 definitivos están en `YARBI_GEMINI_COMPRENSION_SHA256SUMS.txt`.

## Pendiente más pequeño y seguro

Configurar una **clave Gemini exclusiva del proyecto aislado** solo en Preview, activar explícitamente la bandera del parser y ejecutar una única batería controlada contra el endpoint aislado. Esa prueba debe confirmar el modelo real, p50/p95 reales, timeout y que no existe egress distinto de Gemini y Supabase aislado. No requiere ni autoriza CRM write, Agenda, WhatsApp saliente, Maps, Notion, Calendar, APK o producción.

## Confirmación de límites

No se consultaron ni modificaron Production, Vercel, APK, CRM, Agenda, WhatsApp, Gemini real, Maps, Notion ni Calendar. No se enviaron mensajes, no se ejecutaron acciones y no se habilitó `execute:true`.
