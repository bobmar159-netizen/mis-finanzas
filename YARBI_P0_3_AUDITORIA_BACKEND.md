# Yarbi P0.3 — Auditoría y estabilización controlada del backend

Fecha: 2026-11-05  
Estado: **P0.3 PARCIAL — backend crítico validado localmente; quedan riesgos de configuración y regresiones históricas fuera del alcance permitido.**

## Resumen ejecutivo

- La protección P0.2I pasó: los 11 artefactos del manifiesto conservan sus hashes, incluida la fuente canónica `7ae1a3f56c3c83d14ed4b03a0cbdd2e67e3918f88ca735a8b5b98eaad168095b`.
- El inventario local contiene exactamente **18 Functions**, como esperaba la fase.
- Se reparó una regresión de infraestructura de pruebas: el sandbox del webhook no adaptaba `export const config` ni firmaba sus fixtures después del endurecimiento YCloud. Con cuerpos firmados, sus 9 escenarios de aislamiento, deduplicación y cierre de trazas pasan.
- La batería focal de backend pasó **69/69** pruebas locales. Se verificó sintaxis de 60 módulos JavaScript activos.
- La suite global termina en **397 PASS, 30 FAIL, 9 TODO**. Los 30 fallos restantes no fueron introducidos por P0.3; corresponden al conjunto heredado del HTML raíz, expectativas de UI congeladas y una expectativa histórica de límite de Functions. No se corrigieron porque el alcance prohíbe modificar el frontend y los árboles históricos.
- No hubo despliegue, llamadas remotas, Gemini, cambios de Supabase, migraciones, APK ni cambios en P0.2I.

## Integridad P0.2I

| Verificación | Resultado |
| --- | --- |
| `YARBI_P0_2I_SHA256SUMS.txt` | PASS: 11/11 artefactos verificables sin diferencia |
| Fuente canónica esperada | PASS: `7ae1a3f56c3c83d14ed4b03a0cbdd2e67e3918f88ca735a8b5b98eaad168095b` |
| `frontend/`, `dist/web/`, `dist/android-www/` | PASS: no modificados |
| Scripts y prueba P0.2I protegidos | PASS: no modificados |

## Inventario de Functions y dependencias

| Ruta | Contrato / responsabilidad | Dependencias principales | Efecto potencial |
| --- | --- | --- | --- |
| `/api/actions/approve` | Aprueba borradores y agenda | Supabase, Notion, Sheets, Calendar | Mutación y sincronización externa |
| `/api/ai/process` | Reclama y procesa análisis canónicos | Supabase, trazas, identidad, contexto, memoria, Gemini opcional | Mutación de análisis/contexto |
| `/api/assistant/chat` | Chat asistido | Supabase, Gemini, trazas | Lectura y respuesta IA |
| `/api/assistant/collections` | Consultas de cobro | Supabase | Lectura |
| `/api/assistant/command` | Órdenes operativas | Supabase, Gemini, ubicación | Mutación según orden |
| `/api/assistant/live-token` | Token Gemini Live | Gemini | Emisión de token |
| `/api/assistant/owner-action` | Decisión del dueño aislada | owner policy, owner action store | RPC aislada |
| `/api/assistant/owner-inbox` | Bandeja del dueño aislada | owner auth, inbox | Lectura aislada |
| `/api/assistant/preferences` | Preferencias y recuperación | Supabase/Auth | Mutación de preferencias |
| `/api/assistant/proactive-loop` | Loop proactivo aislado | proactive store/loop | Escritura aislada |
| `/api/assistant/reference-candidates` | Referencias autenticadas | owner scope, resolver, Gemini opcional, trazas | Lectura aislada |
| `/api/assistant/scheduled-followups` | Agenda de envíos diferidos | Supabase, envío WhatsApp | Mutación y envío externo |
| `/api/assistant/send-whatsapp` | Envío confirmado por operador | YCloud/Meta, Supabase, procesador | Envío externo |
| `/api/audit/trace` | Trazabilidad aislada | preview audit policy, ledger | Escritura de auditoría |
| `/api/location/resolve` | Resolución de ubicación | location resolver | Lectura/red externa controlada |
| `/api/notion-proxy` | Proxy Notion | Notion | Escritura/lectura externa |
| `/api/supabase-secure` | Operaciones canónicas protegidas | Supabase | Mutación |
| `/api/webhook` | Entrada Meta/YCloud | firma YCloud, Supabase, trazas, ubicación, procesador | Mutación y desencadenamiento |

El mapa de mayor criticidad es:

`webhook → whatsapp_messages → ai/process → identidad/contexto/memoria → trazas`  
`scheduled-followups → send-whatsapp → proveedor YCloud/Meta → whatsapp_messages`  
`owner-inbox/reference-candidates/owner-action → políticas Preview → Supabase aislado`

## Hallazgos y clasificación

| Prioridad | Hallazgo | Evidencia / decisión |
| --- | --- | --- |
| P1 resuelto localmente | El loader de `phase2d2-egress-isolation` dejaba `export const config` sin transformar y enviaba webhooks sin firma; cinco pruebas no alcanzaban el handler real. | Corregido sólo en el test: adapta el export de configuración y usa HMAC YCloud sobre bytes crudos. Los 9 escenarios pasan. |
| P1 pendiente | Siete rutas activas conservan fallback literal a Supabase o backend Production si falta configuración: `actions/approve`, `assistant/collections`, `assistant/command`, `assistant/preferences`, `assistant/scheduled-followups`, `assistant/send-whatsapp`, `supabase-secure`. | Confirmado estáticamente. No se modificó: retirar esos fallbacks exige una decisión de contrato de configuración y pruebas específicas para cada endpoint mutador. |
| P1 pendiente | Una prueba heredada afirma límite de 12 Functions, mientras el inventario real contiene 18, tal como requiere la fase. | La accesibilidad/límite real de Vercel no puede demostrarse sin consulta o despliegue, ambos prohibidos. No se falseó la expectativa ni se consolidaron Functions. |
| P2 pendiente | Seis handlers usan export ESM junto a dependencias CommonJS; otros doce usan CommonJS. | Los runners existentes adaptan los handlers para el sandbox. La compatibilidad exacta del empaquetador Vercel queda `NOT RUN` en P0.3 por prohibición de deploy. |
| P3 heredado | Las pruebas del HTML raíz y sus expectativas no coinciden con los flujos actuales. | `test:unit` mantiene los 12 fallos documentados; la suite total conserva 30 fallos no atribuibles a P0.3. Los árboles históricos y el frontend unificado están fuera de alcance. |

## Corrección realizada

Archivo modificado:

- `tests/phase2d2-egress-isolation.test.js`

Cambios:

1. El sandbox convierte también `export const config` a una constante local antes de cargar el handler real.
2. Los fixtures de webhook se firman mediante HMAC YCloud con el mismo contrato de bytes crudos que exige el handler.
3. La prueba conserva el bloqueo de egress, datos sintéticos y la comprobación de deduplicación, orden de persistencia y cierre de trazas.

No se modificó código de negocio, rutas, contratos HTTP, esquemas, migraciones, frontend ni configuración remota.

## Pruebas y resultados

| Prueba | Resultado | Alcance |
| --- | --- | --- |
| Protección SHA-256 P0.2I | PASS | 11/11 artefactos protegidos |
| `node --test` focal backend | PASS, 69/69 | políticas Preview, trazas, procesador, identidad, contexto, memoria, owner routes, webhook y WhatsApp con mocks |
| `tests/phase2d2-egress-isolation.test.js` | PASS, 9/9 | webhook firmado, fallo de persistencia, deduplicación, orden canónico, egress y procesador sintético |
| Sintaxis activa `api/` + `lib/` | PASS, 60/60 | `node --check`; incluye sólo archivos activos, excluye copias `*.before-*` |
| `npm run test:unit` | FAIL, 12 fallos heredados | HTML raíz congelado; sin modificación por P0.3 |
| `npm test` | PARTIAL, 397 PASS / 30 FAIL / 9 TODO | Los cinco fallos del sandbox se eliminaron; permanecen regresiones históricas fuera de alcance |
| `git diff --check` | BLOCKED | La carpeta no es un repositorio Git; no existe diff local verificable |
| Red / proveedores / servicios remotos | NOT RUN | Prohibidos por esta fase; se usaron mocks locales |

## Evidencias y hashes

| Artefacto | SHA-256 |
| --- | --- |
| `tests/phase2d2-egress-isolation.test.js` | `5fac64f0edc1cbad0e724ffeb36895bf01a8c278b9da67f8cc78d81ee7d2c815` |
| `P0_3_backend_targeted_after.txt` | `48fe09f17d1f33277e5141d71a73e0573cf1365e5b2662e8426641fd75b5f780` |
| `P0_3_webhook_contract_after.txt` | `d2b1f70609d35230a58b861d201684342c15596054bba057c5fdfaa9f4efadd8` |
| `P0_3_full_test_after.txt` | `62d5f54fa7435edc296e8576c12b7e2e33e3a6201b9823d8c1b038dfaf8e8a13` |

## Riesgos pendientes y recomendación P0.4

1. Diseñar y probar una política única de configuración server-side que elimine los fallbacks literales a Production de las siete rutas mutadoras, sin cambiar sus contratos públicos ni tocar infraestructura aún.
2. Resolver de forma explícita el presupuesto de Functions de Vercel antes de cualquier deployment; el inventario real es 18 y la prueba heredada aún espera 12.
3. Decidir una estrategia única de módulos (ESM o CommonJS) y validar su empaquetado en Preview antes de cambios masivos.
4. En una fase separada, reconciliar las 30 expectativas heredadas contra `frontend/` sin modificar la fuente canónica P0.2I hasta contar con una decisión de producto.

No se inició P0.4, no se desplegó y no se tocó Production.
