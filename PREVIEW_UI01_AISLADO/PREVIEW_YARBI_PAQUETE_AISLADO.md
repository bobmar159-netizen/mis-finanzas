# Preview aislado — Yarbi UI-01

## Resultado

`PREPARADO_LOCALMENTE_PENDIENTE_DE_DEPLOYMENT_PREVIEW`

No se ejecutó ningún deployment, consulta remota, migración ni acción comercial durante esta preparación.

Como antecedente previo a esta autorización, un intento de desplegar la raíz del backend fue rechazado por Vercel Hobby por exceder 12 Functions. No produjo un Preview utilizable, no cambió aliases y no alcanzó producción. Este paquete existe precisamente para evitar ese límite sin eliminar ni alterar Functions del backend principal.

## Arquitectura

`PREVIEW_UI01_AISLADO/` es una raíz de deployment independiente. Contiene una interfaz estática y exactamente dos Functions:

1. `GET /api/assistant/owner-inbox` — entrega la bandeja saneada al dueño autenticado. El modo `?mode=auth-config` entrega únicamente URL aislada, project ref y clave *publishable*; nunca la clave de servicio.
2. `POST /api/assistant/owner-action` — llama únicamente a `apply_yarbi_owner_action`, la RPC validada en Fase 3K.

El frontend obtiene la configuración de la misma origin del Preview. Rechaza cualquier host que no sea `uevilhbstnmmdlgyshlv.supabase.co`; no contiene el dominio ni claves de producción. La contraseña se usa sólo para solicitar un token de Supabase aislado y se borra del campo; el access token se mantiene sólo en `sessionStorage`.

`vercel.json` declara solo las dos rutas API. No existe un catch-all que convierta llamadas API desconocidas en HTML ni un handler para operaciones empresariales fuera de alcance.

## Archivos creados

- `package.json`, `vercel.json`
- `index.html`, `styles.css`, `app.js`
- `api/assistant/owner-inbox.js`, `api/assistant/owner-action.js`
- `lib/preview-owner-ui-policy.js`, `lib/yarbi-owner-ui-auth.js`, `lib/yarbi-owner-inbox.js`, `lib/yarbi-owner-action.js`
- `tests/run-local.cjs`
- `PREVIEW_UI01_SHA256SUMS.txt`

No se modificó ningún archivo del backend principal. El package es una carpeta paralela y Vercel deberá recibirla explícitamente como raíz de un futuro Preview.

## Variables requeridas para Preview

- `SUPABASE_URL` — URL del proyecto aislado.
- `SUPABASE_PUBLISHABLE_KEY` — clave pública del proyecto aislado, necesaria para iniciar sesión en el navegador.
- `SUPABASE_SECRET_KEY` — servidor solamente.
- `YARBI_PREVIEW_SUPABASE_PROJECT_REF=uevilhbstnmmdlgyshlv`.
- `YARBI_PREVIEW_AUDIT_ONLY=false`.
- `YARBI_PREVIEW_OWNER_UI_ONLY=true`.
- `YARBI_OWNER_ACCOUNT_ID` — UUID del usuario propietario de prueba.
- `YARBI_OWNER_INBOX_OWNER_KEY=primary` (opcional; `primary` es el valor por defecto).

La guardia falla cerrada si el entorno no es Preview, si el ref/URL no son exactamente los aislados, falta una clave, el UUID es inválido, o aparece una integración externa prohibida.

## Pruebas locales

| Criterio | Resultado | Evidencia |
|---|---|---|
| Carga/estructura de interfaz estática | PASS | `index.html`, `app.js` y sintaxis Node correctas. |
| Configuración aislada y rechazo de producción | PASS | `tests/run-local.cjs`. |
| Autenticación de propietario válida | PASS local simulado | JWT válido resuelve solamente el UUID propietario. |
| Sesión inválida | PASS local simulado | Rechazo 401 antes de consultar `owner-inbox`. |
| Lectura de bandeja | PASS local simulado | Respuesta saneada; no expone payload interno. |
| Autorizar / posponer / descartar | PASS local simulado | Tres llamadas al contrato RPC Fase 3K. |
| Usuario no propietario | PASS local simulado | Rechazo 403 sin llamada RPC. |
| Ausencia de duplicación | NOT PROVEN remoto | La UI delega la idempotencia a la RPC Fase 3K; no se invocó Supabase remoto. |
| Cero egress no permitido | PASS local simulado | Todos los `fetch` falsos se comprobaron contra el host aislado. |
| Cero egress real | NOT PROVEN | No hubo deployment ni ejecución remota autorizada. |
| Ausencia de producción en archivos públicos | PASS | Escaneo de `index.html`, `app.js` y `styles.css`. |
| Ausencia de secretos en archivos públicos | PASS | Escaneo estático: no contiene claves de servicio, audit token ni referencias a variables secretas. |
| Compatibilidad Fase 3K | PASS local simulado | Mismo payload de `apply_yarbi_owner_action`; sin acciones externas. |

El comando ejecutado fue `node tests/run-local.cjs`: siete pruebas aprobadas. No se usaron fixtures remotos ni datos de clientes.

## Auditoría de aislamiento

- El paquete tiene **2 Functions**, por debajo del límite Hobby de 12.
- El frontend no referencia `haifktjvyhbsazmiyqps` ni el backend público.
- La única salida del navegador tras autenticación es la URL aislada recibida desde la Function, validada contra el ref fijo.
- Las Functions sólo construyen solicitudes hacia `uevilhbstnmmdlgyshlv.supabase.co`.
- El ref de producción aparece únicamente en la guardia de servidor como valor explícitamente rechazado; no se envía al navegador.
- No hay imports de Gemini, WhatsApp/YCloud, Maps, Notion, Calendar ni cron.

## Riesgos y pendientes

1. Falta configurar `SUPABASE_PUBLISHABLE_KEY` exclusivamente para Preview. Es pública, pero debe pertenecer al proyecto aislado.
2. Falta verificar en Vercel que `YARBI_OWNER_ACCOUNT_ID` sea el UUID y no una credencial. El CLI cifra el valor recién añadido en su listado, por lo que sólo el runtime del Preview puede validarlo sin exponerlo.
3. Autenticación, lectura y acciones reales permanecen `NOT PROVEN` hasta un deployment Preview y pruebas con datos sintéticos UI01-PREVIEW.
4. La UI usa inicio de sesión de correo/contraseña de Supabase aislado. Debe existir un usuario de prueba propietario con contraseña conocida por el dueño; no se usa ningún usuario ni token de producción.

## Hashes

Los hashes SHA-256 definitivos están en `PREVIEW_UI01_SHA256SUMS.txt`. Deben verificarse antes de cualquier deployment.

## Próximo paso recomendado

Autorizar la configuración de `SUPABASE_PUBLISHABLE_KEY` solamente en Preview y un único deployment de `PREVIEW_UI01_AISLADO/`. Antes de abrir la interfaz se verificará el modo Preview, el ref aislado, las dos Functions y la ausencia de alias/producción.
