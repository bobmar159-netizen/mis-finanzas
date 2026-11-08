# F02 — Matriz de identidad y autorización

Fecha: 2026-11-08. Alcance: código local, sin llamadas remotas ni despliegues.

| Superficie | Método | Identidad tras F02 | Scope / autorización | Estado |
|---|---|---|---|---|
| `/api/location/resolve` | POST | Bearer validado por Supabase Auth | identidad autenticada; no recibe owner del cliente | PASS |
| `/api/assistant/collections` | GET/POST | Bearer validado | `yarbi_owner_contact_scope`; lectura y cobro limitados a `contact_id` canónico | PASS |
| `/api/assistant/preferences` | GET/POST | Bearer validado | `owner_key` hash estable de `auth.uid`; rechaza owner/scope del cuerpo | PASS |
| `/api/assistant/scheduled-followups` | POST | Bearer validado | teléfono debe pertenecer a un `contact_id` del scope canónico | PASS |
| `/api/assistant/scheduled-followups` | GET cron | `CRON_SECRET` | flujo de cron interno; no es autenticación de navegador | PASS / independiente |
| `/api/actions/approve` | POST | Bearer validado | agenda/contacto existente debe estar en scope; alta sin relación de propietario se rechaza | PASS con limitación explícita |
| `/api/supabase-secure` | POST | Bearer validado | mensajes importados, archivados o restaurados requieren `contact_id` dentro del scope | PASS |
| `/api/assistant/send-whatsapp` | POST | ya usaba Bearer validado | autorización firmada, destinatario y contenido vinculados a owner; token queda sólo para despertar procesador interno | PASS |
| `/api/ai/process` | interno | token de proceso interno | cola canónica; no invocable como sesión de usuario | NOT APPLICABLE |
| `/api/webhook` | webhook | firma YCloud/Meta o control interno | proveedor o procesamiento interno; no sustituible por sesión de usuario | NOT APPLICABLE |
| `/api/whatsapp/messages` / `lib/whatsapp-messages.js` | GET/POST | token legado aún presente | mezcla de espejo local, historial y memoria sin filtro canónico homogéneo | **BLOCKED** |
| `/api/notion-proxy` | integración | token legado interno | no se demostró una ruta de navegador ni scope canónico por recurso | **NOT PROVEN** |

## Decisiones de seguridad

- `auth.uid`, `owner_account_id` y `contact_id` se tratan como identidades distintas. El cliente no puede enviar ninguno de los dos últimos para ampliar alcance.
- Las rutas migradas validan primero la configuración server-side, luego el Bearer contra Supabase Auth y finalmente resuelven la relación `yarbi_owner_contact_scope` en servidor.
- Un token `X-Assistant-Token` legado deja de servir para las seis rutas interactivas migradas. El frontend elimina el valor persistido y sustituye el encabezado por un Bearer fresco exclusivamente en esas rutas.
- `ASSISTANT_API_TOKEN` conserva uso interno temporal para cron/procesador y para el webhook firmado; no se usa como identidad de navegador en las rutas marcadas PASS.
- La creación de contactos desde `approve` se cierra con `owner_scope_new_contact_unavailable`: sin una transacción canónica que cree a la vez contacto y relación de propietario, permitirla sería una escalada de alcance.

## Bloqueo que impide cerrar F02

`lib/whatsapp-messages.js` mezcla sincronización local, historial, instrucciones y consultas de memoria con el mismo mecanismo de token legado. No es seguro sustituir el token por una sesión global sin filtrar por scope cada consulta y cada mutación. Esta matriz no presenta esa ruta como migrada.

Siguiente corrección mínima: extraer la superficie de usuario de `/api/whatsapp/messages` a handlers autenticados por acción, aplicar `yarbi_owner_contact_scope` antes de toda lectura/escritura, y conservar el webhook firmado en una ruta separada. No requiere cambiar RLS ni producción.
