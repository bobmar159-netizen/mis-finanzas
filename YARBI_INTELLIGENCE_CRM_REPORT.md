# YARBI — Sprint Intelligence & CRM Integration

## Resultado

**`IMPLEMENTACION_LOCAL_VALIDADA_CON_OBSERVACIONES`**

Se creó y validó una integración CRM de lectura, acotada por propietario autenticado, en el workspace independiente `D:\YARBI_INTELLIGENCE_CRM_20261105`. No se desplegó, no se conectó a Supabase remoto, no se aplicaron migraciones y no se invocó Gemini ni WhatsApp.

La búsqueda útil por nombre, teléfono, dirección/distrito, servicio, historial, cotización y rasgos opera sobre el alcance canónico del owner y entrega resultados compactos. La UI usa ahora esa ruta autenticada; la planificación V4 conserva el paso `NEEDS_LANGUAGE_MODEL` cuando haga falta, pero no ejecuta ni selecciona automáticamente clientes.

## Protección y procedencia

| Control | Resultado |
|---|---|
| Workspace de origen | `D:\YARBI_PRODUCT_COMPLETION_20261105` — solo lectura |
| Workspace de implementación | `D:\YARBI_INTELLIGENCE_CRM_20261105` — copia independiente sin `.vercel`, `.env*` ni `node_modules` propios |
| Manifiesto de origen | 14/14 SHA-256 coinciden; hash del manifiesto `f0bc6423d8564ca0ea346026889ae0c3eaeb3039912e9b40c2113deafc7ec3e7` |
| Producción / Supabase remoto / Vercel | No consultados ni modificados |
| Git | El origen y el workspace copiado no contienen `.git`; se preservó el origen por separación física y manifiesto |

## Implementación

### Búsqueda CRM autenticada

- Nueva ruta agrupada: `POST /api/assistant/crm-search`.
- No crea una Function física nueva: se enruta por el `assistant-router` existente.
- Rechaza `owner_id`, scope o identidad aportados por el cliente.
- Valida el Bearer con el mecanismo existente y resuelve el alcance únicamente mediante `yarbi_owner_contact_scope`.
- Lee solo los contactos dentro de ese alcance y consulta fuentes acotadas: `crm_contacts`, `contact_identifiers`, memoria operativa, mensajes, análisis, agenda y cuentas por cobrar.
- Devuelve una ficha compacta de búsqueda; no expone cuerpos de mensajes ni teléfonos completos en la respuesta normal.
- Tiene paginación limitada y caché de proceso con TTL corto (15 s), aislada por owner y consulta. El caché no es una garantía de seguridad ni una fuente de verdad y se invalida después de cambios de identidad/contacto en `api/ai/process.js`.

### Conversación, UI y WhatsApp personal

- `lib/yarbi-crm-search-conversation.js` traduce comprensión V4 validada a un plan de búsqueda de solo lectura (`execute:false`).
- No hay búsqueda por texto libre sin evidencia estructurada: sin pista se devuelve una pregunta de aclaración.
- `lib/yarbi-owner-personal-conversation.js` incorpora un adaptador inyectable para WhatsApp personal. Reutiliza el cerebro del owner, no llama YCloud/Meta y mantiene efectos comerciales deshabilitados.
- `frontend/yarbi-product-completion-ui.js` utiliza el token de sesión existente para llamar a la nueva ruta. No permite pasar un owner desde el navegador, no contiene URL literal de Production y mantiene el puente seguro al expediente CRM existente.
- Instrucciones y memoria operativa existentes no se duplicaron ni se convirtieron en aprendizaje automático. Se conserva revisión/aprobación y procedencia.

### Rendimiento y esquema

- `scripts/measure-intelligence-crm-performance.cjs` genera evidencia sintética local: búsqueda CRM en caché P95 **0.042 ms** y planificación V4 P95 **0.017 ms**. Son mediciones de CPU local con mocks, no latencia de red ni de Supabase.
- Se preparó, sin ejecutar, `migrations/PROPOSED_20261105_crm_search_indexes.sql` con cuatro índices parciales/compuestos para consultas de mensajes, análisis, agenda y cobranzas. Requiere verificar catálogo, tamaño y plan de ejecución en el proyecto aislado antes de aplicar cualquier SQL.

## Archivos modificados o añadidos

| Archivo | Motivo |
|---|---|
| `lib/yarbi-client-search.js` | Paginación y filtro de recencia para el buscador existente. |
| `lib/yarbi-crm-search-conversation.js` | Plan puro V4 → búsqueda CRM. |
| `lib/yarbi-crm-search-runtime.js` | Lectura acotada por owner, composición de resultados, límites, caché e invalidación. |
| `api_handlers/assistant/crm-search.js` | Handler autenticado y de solo lectura. |
| `api/assistant-router.js`, `vercel.json` | Registro de la ruta en el router agrupado existente. |
| `lib/preview-owner-reference-policy.js` | Allowlist Preview para la ruta. |
| `lib/yarbi-owner-conversation.js`, `lib/yarbi-owner-personal-conversation.js` | Planificación y puente personal sin efectos comerciales. |
| `api/ai/process.js` | Invalida caché de búsqueda después de cambios CRM ya existentes. |
| `frontend/yarbi-product-completion-ui.js` | Búsqueda autenticada y apertura segura del expediente. |
| `migrations/PROPOSED_20261105_crm_search_indexes.sql` | Propuesta local, no aplicada. |
| `tests/intelligence-crm-integration.test.js` | Cobertura sintética de alcance, filtros, UI/handler, privacidad y sin egress. |
| `tests/product-completion.test.js`, `tests/p06-router-contract.test.js` | Contrato de UI autenticada y enrutamiento agrupado. |
| `scripts/measure-intelligence-crm-performance.cjs` | Medición local sanitizada. |

## Validación ejecutada

| Prueba | Resultado |
|---|---|
| Batería CRM/owner/router focalizada | **49/49 PASS** |
| Búsqueda por 7 facetas, paginación, caché e invalidación | PASS |
| Aislamiento owner A/B y rechazo de `owner_id` inyectado | PASS |
| Ruta Preview: Bearer, proyecto aislado, sin escrituras comerciales | PASS con `fetch` simulado exclusivamente al host aislado |
| Plan V4 y abstención sin pista verificable | PASS |
| Puente WhatsApp personal con adaptador inyectado y `execute:false` | PASS |
| Protección de instrucciones/memoria existente | PASS |
| Sintaxis de los 10 módulos modificados | PASS |
| Build web | PASS (`dist/web`) |
| Build Android con origen HTTPS sintético `https://yarbi-preview.invalid` | PASS (`dist/android-www`) |
| Guard de Android sin origen explícito | PASS: falla seguro |
| Pruebas de build frontend unificado | **3/3 PASS** |
| Medición local sanitizada | PASS; evidencia creada |

La suite histórica completa se ejecutó como diagnóstico: **364/432 PASS, 62 FAIL**. No es criterio de aceptación de este sprint. Al menos 15 fallos provienen directamente de expectativas antiguas que buscan `api/assistant/*` pese a la reubicación P0.6 a `api_handlers/assistant/*`; la evidencia P0.6 ya documentaba esta familia. El resto no se modificó ni se ha demostrado como preexistente o causado por este cambio, por lo que queda **NOT PROVEN** y requiere una línea base independiente antes de corregirlo.

## Rutas, Functions y configuración

- `vercel.json` queda con 22 reglas, 20 patrones API; la ruta nueva se agrupa bajo el router existente.
- El modelo de configuración conserva fail-closed: Preview requiere proyecto aislado y configuración explícita. La única referencia al project ref de Production en la política es una lista de bloqueo, no un fallback.
- Variables que debe revisar un Preview futuro, sin mostrar valores: `VERCEL_ENV`, `YARBI_PREVIEW_OWNER_REFERENCES_ONLY`, `YARBI_PREVIEW_SUPABASE_PROJECT_REF`, `SUPABASE_URL`, credencial server-side de Supabase y `YARBI_TRACE_HMAC_KEY`.

## Limitaciones y siguientes decisiones

1. **NOT PROVEN:** compatibilidad contra el catálogo real aislado y rendimiento con volumen real. No se accedió a Supabase remoto.
2. **NOT PROVEN:** aplicación de los cuatro índices propuestos; la migración no se ejecutó.
3. **NOT PROVEN:** prueba HTTP real del endpoint autenticado en Preview y experiencia visual del panel. No se desplegó.
4. **LIMITADO A DISEÑO/MOCK:** la conversación personal de WhatsApp está lista como adaptador inyectable; no se conectó a ningún proveedor ni número real.
5. **PENDIENTE:** establecer una línea base de la suite completa para separar fallos P0.6 heredados de fallos nuevos antes de considerar una promoción.

## Recomendación mínima siguiente

Autorizar un Preview aislado y una prueba HTTP sintética única: Bearer de usuario aislado → scope canónico → búsqueda CRM → apertura de expediente, sin Gemini, sin WhatsApp saliente y sin acciones comerciales. Antes de ello, revisar por catálogo el esquema aislado y decidir explícitamente si los índices propuestos son necesarios.

## Integridad

Los hashes SHA-256 de los módulos, evidencia, informe y manifiesto de este sprint están en `YARBI_INTELLIGENCE_CRM_SHA256SUMS.txt`.
