# YARBI F02 — Unificación de identidad y seguridad

## Resultado

**F02 parcialmente implementada; cierre bloqueado por la superficie legacy de WhatsApp.**

Se sustituyó el token estático de navegador por identidad Supabase Auth y scope canónico en:

- ubicación;
- instrucciones, memoria conversacional, entrenamiento y ledger de preferencias;
- cobranzas;
- seguimientos programados creados por usuario;
- aprobaciones de Agenda sobre contactos ya asociados al owner;
- importación, archivado y restauración de mensajes con `contact_id` verificable;
- autorización de WhatsApp saliente (la ruta ya usaba sesión, y el token queda sólo como llamada interna al procesador).

El frontend elimina `fnz_assistant_token` al arrancar. Un puente limitado añade el Bearer fresco a las rutas que ya migraron; no inyecta sesiones en destinos externos ni conserva credenciales.

## Archivos modificados

- `lib/yarbi-authenticated-route.js`
- `api_handlers/location/resolve.js`
- `api_handlers/assistant/collections.js`
- `api_handlers/assistant/preferences.js`
- `api_handlers/assistant/scheduled-followups.js`
- `api/actions/approve.js`
- `api/supabase-secure.js`
- `api/assistant/send-whatsapp.js`
- `frontend/index.html` y artefactos web generados (`index.html`, `runtime-config.js`, `service-worker.js`)
- `tests/f02-identity-security.test.js`

## Pruebas

Las pruebas nuevas pasan 5/5. La fuente unificada pasa 4/4 y los dos builds locales pasan cuando Android recibe un origen HTTPS sintético. Detalle completo: `F02_REGRESSION_RESULTS.md`.

## Riesgo pendiente / decisión necesaria

No se declara F02 cerrada porque `/api/whatsapp/messages` todavía mantiene un token legado y realiza lecturas no separadas por owner scope. El siguiente paso seguro es dividir su parte de usuario de la recepción firmada del webhook y migrarla por acción, sin usar el token compartido como compatibilidad.

No se modificaron Production, Supabase remoto, RLS, migraciones, proveedores externos, Vercel ni el APK.
