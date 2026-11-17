# Meta Ads oficial en Yarbi Preview

## Estado actual

El importador CSV sigue disponible como herramienta auxiliar y no se considera integración oficial. El backend ahora tiene una ruta de conexión OAuth de solo lectura, consulta de cuentas publicitarias e Insights, almacenamiento cifrado de la sesión Meta y una propuesta de esquema Supabase. El webhook compartido de WhatsApp puede validar la firma oficial de Meta y conserva la referencia de anuncios que Meta incluya en mensajes Click to WhatsApp.

El panel dentro del CRM incluye un presupuesto semanal de referencia de **S/ 200**, editable por propietario. La primera sincronización cubre 30 días; las siguientes vuelven a consultar tres días desde la última sincronización para recoger ajustes recientes. La ruta limita cada ejecución a 20 páginas y etiqueta los datos como parciales si alcanza ese límite.

Finanzas conserva intacta la categoría/columna histórica `META` de cierres. `Publicidad Meta` y `Recarga saldo Meta` usan categorías separadas. Insights no crea movimientos financieros automáticamente: el propietario registra el cargo o recarga verificados desde los botones del panel, evitando que el consumo reportado y una recarga se contabilicen dos veces por automatización. El CSV continúa como fuente auxiliar.

El código todavía no está desplegado ni conectado a una cuenta publicitaria. Las pruebas locales usan eventos sintéticos y no demuestran acceso real a Meta.

### Estado Vercel comprobado el 17-11-2026

- En Settings → Domains, `yarbi-preview-candidate-20261105.vercel.app` aparece asociado a **Production**.
- El deployment de `codex/yarbi-core-domain` aparece con Environment **Preview**, pero la URL visible es específica del deployment: `yarbi-preview-candidate-20261105-3fr7uxpmg-omar-dfc4.vercel.app`.
- El proyecto no muestra actualmente un dominio estable de rama Preview en la lista Domains. Una URL de rama derivada por formato no resolvió; no se debe registrar como callback sin que Vercel la muestre y clasifique como Preview.
- Por ello, aún no se debe configurar ni probar OAuth Meta. Primero debe existir un host estable de rama Preview y debe constar con Environment Preview. No reutilizar el dominio corto de Production.
- La configuración Vercel `SUPABASE_URL` (sin revelar secretos) y `YARBI_PREVIEW_SUPABASE_PROJECT_REF` están limitadas a **Preview** y coinciden exactamente con `uevilhbstnmmdlgyshlv`.
- El proyecto confirmado es `yarbi-audit-preview`, en `sa-east-1`, separado del proyecto `MisFinanzasPro` (`haifktjvyhbsazmiyqps`). Supabase etiqueta la rama primaria de `yarbi-audit-preview` como `main / Production`; en este caso el proyecto completo tiene una referencia distinta de `MisFinanzasPro`. No se inspeccionó ni modificó el proyecto `MisFinanzasPro`.
- La migración Meta se aplicó en `yarbi-audit-preview` mediante SQL Editor, dentro de `BEGIN/COMMIT`. Se verificaron las seis tablas nuevas, RLS activo, acceso SELECT denegado a `anon` y `authenticated`, y SELECT permitido a `service_role`. No existían tablas `yarbi_meta_*` antes de ejecutar. La operación es aditiva y no actualiza filas preexistentes.
- Supabase muestra **No backups** programados (plan Free). La transacción aporta atomicidad ante error durante la ejecución; no hay restauración automática posterior al commit. Las tablas nuevas empiezan vacías.
- No se reveló ningún secreto. Las variables Meta todavía no aparecen con alcance Preview.
- El proyecto Vercel no está conectado a un repositorio Git y la lista Domains solo contiene el dominio corto `yarbi-preview-candidate-20261105.vercel.app`, clasificado como **Production**. El deployment Preview tiene una URL única, no estable.
- El workspace local no tiene un remote Git configurado y `.vercel/project.json` apunta a `misfinanzas-backend`, no al proyecto `yarbi-preview-candidate-20261105`. No ejecutar despliegues desde ese enlace local: podría apuntar al proyecto equivocado.

### Estado Meta for Developers comprobado

- Existe la app empresarial de desarrollo **gas natural** (`24129781223388941`), vinculada al negocio **Omar Bobmar** (`1336060214709781`), con Marketing API, WhatsApp y Webhooks añadidos. No está conectada a Yarbi Preview ni a una cuenta publicitaria mediante OAuth.
- La app publicada **Mis Finanzas Pro** es distinta y no se modificó.
- La verificación del negocio aparece como **No verificado**. Facebook Login for Business figura como producto disponible, no añadido. No se configuró callback OAuth ni se generó/reveló un secreto.

## Bloqueos antes de OAuth y despliegue

1. Hace falta conectar el proyecto `yarbi-preview-candidate-20261105` al repositorio remoto correcto y fijar/confirmar `main` como Production Branch antes de habilitar la rama `codex/yarbi-core-domain` como Preview. Vercel no ofrece ahora un alias estable de rama. No reasignar el dominio actual Production ni conectar el proyecto hasta revisar en la interfaz el efecto sobre la Production Branch.
2. Una vez enlazado el repositorio, confirmar un dominio de rama estable que Vercel clasifique como **Preview**. Usar exactamente `https://<host-preview-confirmado>/api/assistant/meta-ads?action=callback` como callback. No registrar el host Production ni un deployment URL que cambie en cada build.
3. Reutilizar la app empresarial de desarrollo **gas natural** solo después de confirmar que el propietario la quiere para Yarbi. Mantenerla en Development para pruebas y limitar el permiso a `ads_read`. Añadir/configurar Facebook Login for Business y la allowlist solo después de confirmar el host estable. No tocar la app publicada `Mis Finanzas Pro`.
4. Configurar en Vercel estas variables con alcance **Preview solamente**, enmascarando secretos:
   - `META_APP_ID`: identificador público de la app Meta.
   - `META_APP_SECRET`: secreto de la app; exclusivamente backend.
   - `META_OAUTH_REDIRECT_URI`: la URI exacta del host Preview confirmado.
   - `META_OAUTH_STATE_SECRET`: valor aleatorio de al menos 32 caracteres.
   - `META_API_VERSION`: `v27.0` para este código; actualizar en conjunto solo tras comprobar la versión vigente y compatibilidad.
   - `YARBI_VAULT_KEY`: clave de cifrado de al menos 32 caracteres; debe coincidir con la que usa la bóveda existente.
   - `YARBI_PREVIEW_DEPLOYMENT_HOST`: el host Preview confirmado; debe coincidir con la rama Preview de Vercel y diferir de `VERCEL_PROJECT_PRODUCTION_URL`.
   - `YARBI_PREVIEW_SUPABASE_PROJECT_REF`: `uevilhbstnmmdlgyshlv` (coincidencia comprobada).
   - Las variables Supabase actuales quedan con alcance Preview; no duplicar valores desde Production.
5. El SQL está aplicado; la verificación descrita arriba confirma las tablas y RLS. Como no hay backups programados, antes de una operación que escriba datos Meta revisar el mecanismo de respaldo disponible o limitar las pruebas al esquema vacío.
6. Desplegar exclusivamente el commit de la rama enlazada como Preview. Abrir OAuth con la cuenta autorizada y confirmar que Meta solicita solo `ads_read`, sin permisos de escritura.
7. Seleccionar la cuenta publicitaria devuelta por OAuth. La primera sincronización cubre hasta 30 días; las siguientes usan una ventana incremental de tres días. La ruta también admite rangos manuales de hasta 93 días. Verificar inversión, impresiones, clics y acciones reportadas por Meta.
8. Confirmar que un resultado con límite de paginación aparece como parcial y que el sistema no lo usa para recomendar cambios de presupuesto.

## Webhook oficial de WhatsApp

Cuando exista un host de rama estable, configurar el webhook de Preview como `https://<host-preview-confirmado>/api/webhook`, elegir `whatsapp_business_account`, y suscribir `messages`. **No utilizar** `https://yarbi-preview-candidate-20261105.vercel.app/api/webhook`: ese dominio actualmente apunta a Production.

- `META_APP_SECRET`: el mismo secreto de la app, usado para validar `X-Hub-Signature-256` sobre los bytes originales.
- `META_WEBHOOK_VERIFY_TOKEN`: token aleatorio independiente para el challenge GET.

El webhook comparte el endpoint y la ruta de persistencia canónica existentes; no crea un segundo integrador de WhatsApp. `ctwa_clid`, `source_id`/`ad_id`, tipo de origen, URL y texto del referral se conservan únicamente cuando venían en el mensaje Meta autenticado. No se fabrican referencias si Meta no las incluye.

## Límites de atribución y Conversions API

- Los Insights de Meta son métricas reportadas por la plataforma; no equivalen a clientes ni ventas confirmadas.
- El consumo de Insights no genera movimientos de caja automáticamente. Registra el cargo o recarga verificados una sola vez en Movimientos. Las categorías nuevas no reutilizan la columna `META` histórica.
- El webhook guarda la evidencia de referral por mensaje. Aún hace falta materializar la relación canónica mensaje → contacto/oportunidad y definir la regla primer/último toque antes de atribuir ingresos.
- La propuesta de migración incluye un outbox de eventos `Lead`/`Purchase` con `event_id` único y estados, pero no envía nada a Conversions API. La transmisión real requiere autorización expresa, consentimiento, eventos CRM/Finanzas verificados y deduplicación acordada.
- No hay permiso de escritura de campañas y no se implementan cambios de presupuestos.
- El procesamiento de callback puede recuperar cuentas publicitarias; la sincronización de Insights está limitada a 20 páginas por ejecución. Un resultado que alcance el límite debe reportarse como parcial antes de presentarse como sincronización completa.

## Lo que Yarbi todavía no calcula

Hasta que CRM/Agenda/Finanzas tengan llaves y relaciones verificadas con la evidencia de referral, no se reportarán “campaña ganadora por ventas”, costo por cliente, ingresos conciliados o ROAS real. Se distinguen siempre acciones/lead reportados por Meta de contratación/cobro verificados en Yarbi. Las recomendaciones de aumentar o recortar presupuesto requieren esas métricas y seguirán siendo consultivas; el sistema no editará campañas.

## Prueba segura de aceptación

1. Confirmar que la URL de la app y el proyecto Supabase corresponden a Preview.
2. Iniciar OAuth autenticado y comprobar que Meta presenta solo `ads_read`.
3. Confirmar que el token no aparece en respuestas, logs ni navegador y que la DB guarda solo el ciphertext.
4. Seleccionar cuenta, sincronizar periodo sintético/de bajo impacto y comprobar paginación, idempotencia por fecha/anuncio y métricas.
5. Usar Webhooks → Test o un evento de prueba y verificar firma/referral sintéticos; no enviar mensaje a clientes.
6. Revisar aislamiento A/B con dos usuarios de prueba autorizados antes de declarar aceptación.
7. No habilitar Conversions API ni enviar eventos reales en esta fase.
