# YARBI F02.1 — Matriz de identidad y aislamiento WhatsApp

Fecha: 2026-11-08. Alcance: workspace local. No se hicieron llamadas a
Supabase, Vercel, YCloud, Meta, Notion, Gemini ni Production.

| Superficie | Identidad aceptada | Alcance / operación | Resultado |
|---|---|---|---|
| `GET /api/whatsapp/messages` | Bearer validado por `authenticateScopedOwner` | El servidor resuelve `yarbi_owner_contact_scope`; `contact_id` se filtra antes de consultar y nuevamente en la respuesta. | PASS |
| Filtros de mensajes | No acepta `owner_id`, `owner_account_id`, `contact_id`, `contact_ids` ni `scope` del cliente | Conserva `phone`, `since`, `from_timestamp`, `limit`, `offset`, `order`, `include_deleted`; el orden y la paginación quedan en servidor. | PASS |
| `GET /api/assistant/drafts` | Bearer validado por `authenticateScopedOwner` | Requiere `draft_actions.contact_id` dentro del scope canónico. | FAIL SAFE |
| Esquema actual de borradores | No se demostró localmente una relación canónica desde el campo legacy `client_id` hacia `crm_contacts` | Ante ausencia/incompatibilidad de `contact_id`, responde `424 draft_scope_schema_unavailable`; no devuelve borradores. | BLOCKED, seguro |
| `POST /api/webhook` (YCloud) | Firma HMAC de cuerpo crudo | Conserva deduplicación y clasificación estructurada; peticiones sin firma se rechazan antes de procesar. | PASS |
| `GET /api/webhook` (Meta) | `hub.mode`, `hub.verify_token`, `hub.challenge` | Sigue siendo verificación de proveedor, no una sesión de navegador. | PASS |
| Proceso de fondo hacia `/api/ai/process` | `INTERNAL_PROCESSOR_TOKEN` server-to-server | No es una identidad de usuario y no se expone por CORS en el webhook. | NOT APPLICABLE |
| `/api/notion-proxy` | Bearer y scope canónico obligatorios | Rechaza secretos de Notion enviados por navegador y exige `contact_id` del scope. Sin proyección verificable contacto→recurso Notion, devuelve `424` sin egress. | FAIL SAFE / BLOCKED |
| Frontend canónico | Sesión Supabase fresca para rutas migradas | El bridge borra `X-Assistant-Token`, añade Bearer sólo a rutas exactas autorizadas y no permite que el origen Android use otro host que el configurado. | PASS |

## Flujo separado

```text
Navegador autenticado ──Bearer──> /api/whatsapp/messages ──scope canónico──> Supabase
Proveedor YCloud/Meta ──firma / verificación──> /api/webhook ──dedupe──> cola canónica
Webhook ──token interno server-to-server──> /api/ai/process
```

El navegador ya no usa `/api/webhook` para listar mensajes, pedir borradores ni administrar preferencias. Las operaciones legacy de ese endpoint devuelven una ruta movida o retirada; no se aceptan por token estático.

## Inventario estático de referencias heredadas

| Hallazgo | Clasificación | Tratamiento F02.1 |
|---|---|---|
| `lib/whatsapp-messages.js` conserva `ASSISTANT_TOKEN` | Handler legacy no expuesto por rewrite actual; `api/webhook.js` sólo lo carga para invalidación de caché | No se invoca desde la nueva lectura; pendiente de extracción/eliminación en una fase dedicada. |
| `api/ai/process.js`, webhook y seguimiento programado usan `X-Assistant-Token` | Comunicación interna server-to-server | Permitido; no sustituye Bearer de usuario. |
| `frontend/index.html` mantiene construcciones históricas de `X-Assistant-Token` | Remanente sintáctico; el valor se elimina al cargar y el bridge lo borra para rutas migradas | Deuda de limpieza global; no se presenta como autorización válida. |
| `www/index.html` contiene referencias históricas y hosts literales | Árbol histórico no canónico protegido por P0.2I | No se modificó. No se usó en builds de F02.1. |
| Referencias a `haifktjvyhbsazmiyqps` en políticas/configuración | Guardias que bloquean producción en Preview, además de un backup `api/webhook.js.bak-*` | No son fallbacks activos de F02.1. El backup no fue ejecutado ni modificado. |

## Conteo de rutas y Functions

- 24 patrones API, 26 rutas totales al incluir `/auth/callback` y `/privacy`.
- 9 entrypoints físicos estáticos: webhook, WhatsApp messages, Supabase secure, Notion proxy, approve, AI process, send WhatsApp, assistant router y utility router.
- El conteo real de bundles Vercel queda **NOT PROVEN**: no se ejecutó `vercel build` ni hubo conexión remota. La matriz estática mantiene el presupuesto por debajo de 12 entrypoints.

## Restricciones conservadas

- No se inventó un vínculo entre `draft_actions.client_id` y un contacto CRM.
- No se cambió RLS, migraciones ni esquema remoto.
- No se habilitó la proxy de Notion sin una proyección verificable por contacto/owner.
- No se aceptan acciones de usuario a través del webhook de proveedor.
