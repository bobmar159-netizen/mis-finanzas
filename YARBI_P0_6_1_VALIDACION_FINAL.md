# YARBI P0.6.1 — Validación final del candidato

**Estado inicial:** `BLOQUEADO_POR_ALMACENAMIENTO_LOCAL`

**Estado actualizado tras recuperación segura:** `VALIDACION_LOCAL_P0_6_1_COMPLETADA_BUILD_VERCEL_AUN_BLOCKED`

**Ámbito inspeccionado:** `D:\YARBI_P06_STAGING_20261105` exclusivamente.

**Fecha:** 2026-11-05

## Resumen

El candidato P0.6 se preservó y se ampliaron sus verificaciones locales sin tocar el proyecto original. La revisión estática confirma la matriz de 19 URL API públicas para 18 handlers lógicos, incluida la alias de WhatsApp hacia el mismo webhook. Se añadieron pruebas mecánicas adicionales de reescritura, transporte del router, propagación de errores y la modificación CommonJS de `collections`.

La ejecución de esas pruebas nuevas y de un build Vercel legítimo quedó bloqueada antes de arrancar: `C:` no tiene espacio disponible y el host de ejecución no puede escribir su propio log de inicio. No se borró, limpió, movió ni sobrescribió archivo alguno para forzar la ejecución.

Esto significa que el candidato **no está aprobado para integración** todavía: sus verificaciones P0.6 conocidas continúan como evidencia histórica, pero las ampliaciones P0.6.1 quedan pendientes de ejecución reproducible.

## Protección y estado de referencias

| Referencia protegida | Estado conocido antes de P0.6.1 | Estado al cierre |
|---|---:|---|
| P0.2I | 11/11 hashes verificados | No modificada; no se pudo recalcular al cierre por bloqueo del host |
| P0.3.1 | 10/10 hashes verificados | No modificada; no se pudo recalcular al cierre por bloqueo del host |
| P0.5 | 16/16 hashes verificados | No modificada; no se pudo recalcular al cierre por bloqueo del host |
| Proyecto original | Solo lectura durante P0.6/P0.6.1 | No modificado |
| Staging P0.6 | Preservado | Cambios únicamente aditivos: pruebas e informe P0.6.1 |

La verificación previa P0.6 comprobó las tres familias de hashes indicadas. Para esta fase se intentó ejecutar la batería posterior; el host rechazó la creación del proceso antes de poder ejecutar `Get-FileHash` o `node --test`. Por esa razón no se presenta una verificación posterior falsamente como completada.

## Matriz completa de rewrites

La configuración contiene 21 reglas: 19 patrones API, una ruta de callback no API y un recurso estático. Los 19 patrones API resuelven 18 handlers lógicos porque `/api/webhook` y `/api/whatsapp/messages` comparten el mismo handler.

| URL pública | `dest` exacto | Router/identificador | Handler final | Métodos |
|---|---|---|---|---|
| `/api/webhook` | `/api/webhook.js` | directo:webhook | `api/webhook.js` | Contrato real pendiente; el rewrite no filtra método |
| `/api/whatsapp/messages` | `/api/webhook.js` | directo:webhook_alias | `api/webhook.js` | Contrato real pendiente; alias del webhook |
| `/api/supabase-secure` | `/api/supabase-secure.js` | directo:supabase-secure | `api/supabase-secure.js` | Contrato real pendiente |
| `/api/notion-proxy` | `/api/notion-proxy.js` | directo:notion-proxy | `api/notion-proxy.js` | Contrato real pendiente |
| `/api/actions/approve` | `/api/actions/approve.js` | directo:approve | `api/actions/approve.js` | Contrato real pendiente |
| `/api/ai/process` | `/api/ai/process.js` | directo:process | `api/ai/process.js` | Contrato real pendiente |
| `/api/assistant/send-whatsapp` | `/api/assistant/send-whatsapp.js` | directo:send-whatsapp | `api/assistant/send-whatsapp.js` | Contrato real pendiente |
| `/api/assistant/chat` | `/api/assistant-router.js?__p06_route=chat` | assistant:chat | `api_handlers/assistant/chat.js` | Router transmite método; contrato real pendiente |
| `/api/assistant/collections` | `/api/assistant-router.js?__p06_route=collections` | assistant:collections | `api_handlers/assistant/collections.js` | Router transmite método; contrato real pendiente |
| `/api/assistant/command` | `/api/assistant-router.js?__p06_route=command` | assistant:command | `api_handlers/assistant/command.js` | Router transmite método; contrato real pendiente |
| `/api/assistant/live-token` | `/api/assistant-router.js?__p06_route=live-token` | assistant:live-token | `api_handlers/assistant/live-token.js` | Router transmite método; contrato real pendiente |
| `/api/assistant/owner-action` | `/api/assistant-router.js?__p06_route=owner-action` | assistant:owner-action | `api_handlers/assistant/owner-action.js` | Router transmite método; contrato real pendiente |
| `/api/assistant/owner-inbox` | `/api/assistant-router.js?__p06_route=owner-inbox` | assistant:owner-inbox | `api_handlers/assistant/owner-inbox.js` | Router transmite método; contrato real pendiente |
| `/api/assistant/preferences` | `/api/assistant-router.js?__p06_route=preferences` | assistant:preferences | `api_handlers/assistant/preferences.js` | Router transmite método; contrato real pendiente |
| `/api/assistant/proactive-loop` | `/api/assistant-router.js?__p06_route=proactive-loop` | assistant:proactive-loop | `api_handlers/assistant/proactive-loop.js` | Router transmite método; contrato real pendiente |
| `/api/assistant/reference-candidates` | `/api/assistant-router.js?__p06_route=reference-candidates` | assistant:reference-candidates | `api_handlers/assistant/reference-candidates.js` | Router transmite método; contrato real pendiente |
| `/api/assistant/scheduled-followups` | `/api/assistant-router.js?__p06_route=scheduled-followups` | assistant:scheduled-followups | `api_handlers/assistant/scheduled-followups.js` | Router transmite método; contrato real pendiente |
| `/api/audit/trace` | `/api/utility-router.js?__p06_route=trace` | utility:trace | `api_handlers/audit/trace.js` | Router transmite método; contrato real pendiente |
| `/api/location/resolve` | `/api/utility-router.js?__p06_route=resolve` | utility:resolve | `api_handlers/location/resolve.js` | Router transmite método; contrato real pendiente |

Reglas adicionales no incluidas en el conteo API:

| URL | `dest` | Motivo |
|---|---|---|
| `/auth/callback` | `/api/assistant-router.js?__p06_route=preferences&action=auth-callback` | callback de navegación existente |
| `/privacy` | `/privacy.html` | recurso estático |

### Orden y colisiones

La nueva prueba estática comprueba que cada `src` es único, que existen exactamente 21 reglas, que las siete rutas API directas preceden a las rutas del router de Assistant y estas preceden a las dos rutas del router de utilidades. También comprueba `src` y `dest` exactos de las 19 API, la existencia de cada handler final y la ausencia de entradas API directas para handlers agrupados.

Esta evidencia **no** sustituye una ejecución de Vercel. Vercel conserva la autoridad final sobre la semántica de `routes`, el orden efectivo y la preservación de query strings en un deployment real.

## Pruebas ampliadas preparadas

Se añadieron, sin modificar handlers ni routers:

| Archivo | Cobertura preparada | Estado |
|---|---|---|
| `tests/p061-rewrite-matrix.test.js` | 19 patrones API, 18 handlers, `src`, `dest`, orden y colisiones | `NOT_EXECUTED` |
| `tests/p061-router-functional.test.js` | solicitudes sintéticas autorizadas, GET/POST/OPTIONS, headers, body, query strings, JSON de validación, 404, propagación de error y ejecución única | `NOT_EXECUTED` |
| `tests/p061-collections-export.test.js` | diferencia exacta de export y carga CommonJS con rechazo seguro sin token | `NOT_EXECUTED` |

Las pruebas de router usan módulos simulados en memoria. Esto valida el transporte y dispatch del router sin proveedores, autenticación remota, escritura ni operaciones comerciales. Las pruebas de paridad de autorización inválida ya existentes continúan siendo evidencia P0.6 de comportamiento seguro sin proveedores; no prueban el recorrido comercial autorizado de cada handler.

La batería P0.6 anterior había completado 32/32 pruebas seleccionadas antes de añadir estas ampliaciones. Eso no permite afirmar que los tres archivos nuevos hayan pasado.

## `collections.js`: comparación de export

El único cambio funcional-candidato revisado para `api_handlers/assistant/collections.js` es el token de exportación:

```diff
- export default async function handler(req, res) {
+ module.exports = async function handler(req, res) {
```

No se modificaron imports, cuerpo del handler, dependencias ni respuestas. La prueba P0.6.1 compara el archivo staging con el original tras aplicar precisamente esta sustitución única y prueba una solicitud sintética sin bearer para confirmar la respuesta segura esperada. Su ejecución está pendiente por el mismo bloqueo local.

## Viabilidad del build Vercel

### Hechos comprobados

- El staging no tiene `.vercel/project.json`: no hay un vínculo local a proyecto.
- La ayuda local de `vercel build` muestra opciones que pueden obtener entorno o configuración remota (`--deployment`, `--yes`, `--prod`, `--project`).
- La documentación de CLI indica que `vercel link` y `vercel pull` son el flujo normal para asociar proyecto y obtener entorno. Esas acciones están prohibidas para esta fase. Ver [Vercel CLI](https://vercel.com/docs/cli) y [desarrollo local](https://vercel.com/docs/deployments/overview#developing-locally).
- Un intento anterior de consultar la CLI intentó descargar su binario a `C:` y recibió `ENOSPC`.

### Decisión

`vercel build` queda `BLOCKED`. Ejecutarlo ahora podría solicitar asociación, configuración remota o variables de entorno; crear un proyecto falso o un vínculo artificial no sería una validación legítima. Por tanto no existe `.vercel/output/functions/` y no hay recuento real de Functions generadas.

El conteo de ocho puntos de entrada API del candidato es únicamente un indicador estático; **no** se presenta como confirmación de límites reales de Vercel Hobby. La referencia oficial para límites de Functions sigue siendo [Vercel Limits](https://vercel.com/docs/limits).

## Almacenamiento y cachés

| Ubicación inspeccionada | Estado |
|---|---|
| `C:` | 0.00 GB libres; 465.14 GB usados |
| `D:` | 401.65 GB libres; staging conservado |
| `%LOCALAPPDATA%\com.vercel.cli` | Existe; 0.00 MB medibles |
| `npm config get cache` | `C:\Users\BOB\AppData\Local\npm-cache`; 0.00 MB medibles |
| `%TEMP%` | `C:\Users\BOB\AppData\Local\Temp`; 1326.89 MB medibles |

La ejecución de la batería final falló antes de iniciar Node con:

```text
helper_log_failed: failed to write setup log line: Espacio en disco insuficiente. (os error 112)
```

No se borró contenido de `%TEMP%`, cachés, staging ni proyecto original. Para un intento posterior, se puede preparar un directorio temporal en `D:` y ejecutar explícitamente con `TEMP`, `TMP` y `npm_config_cache` apuntando a ese directorio; no obstante, esto no está verificado como redirección del descargador interno de binarios de Vercel, que ya mostró intentar escribir en `C:`. Antes de usarlo debe autorizarse una fase separada de recuperación de espacio o validación de redirección, sin eliminación automática.

## Bloqueos y recomendación

1. **Crítico — espacio en `C:`:** impide iniciar herramientas, recalcular hashes posteriores y ejecutar las pruebas agregadas.
2. **Build Vercel local:** sin vínculo/configuración local no puede realizarse legítimamente bajo las restricciones vigentes; no se debe simular un proyecto ni usar datos remotos.
3. **Vercel runtime:** la matriz local no prueba comportamiento desplegado; no hay deployment autorizado en P0.6.1.

### Recomendación de integración

No integrar el candidato P0.6 todavía. El paso mínimo seguro es autorizar una recuperación de espacio **reversible y con objetivos exactos** o proporcionar un entorno de ejecución cuyo directorio temporal esté realmente en `D:`. Después se deberán ejecutar, sin cambios de código, los tres tests P0.6.1 y la batería seleccionada P0.6, recalcular los tres manifiestos protegidos y decidir de nuevo la viabilidad de `vercel build` sin enlace remoto.

## Confirmaciones de alcance

- Sin deployment ni `--prod`.
- Sin acceso a Vercel remoto, Supabase remoto ni Production.
- Sin migraciones, APK, Gemini, WhatsApp ni acciones comerciales.
- Sin eliminación, limpieza automática o modificación del proyecto original.

## Actualización — recuperación segura y reanudación (2026-11-05)

La investigación posterior de `%TEMP%` encontró 27 archivos con más de 14 días, 884.00 MB en total. Ninguno tenía extensión temporal estándar, atributo temporal ni procedencia técnica verificable de Codex, Node, npm o Vercel. Para evitar mover archivos posiblemente no prescindibles, se movieron **0 archivos** y se recuperaron **0 bytes**. Esta es una abstención deliberada, no una limpieza incompleta.

Se crearon únicamente estos directorios de trabajo nuevos en `D:`:

```text
D:\YARBI_P06_RECOVERY_20261105\temp
D:\YARBI_P06_RECOVERY_20261105\npm-cache
```

La sesión se ejecutó con `TEMP`, `TMP` y `npm_config_cache` dirigidos a esas rutas. Con ello Node pudo iniciar sin usar cachés nuevas de `C:`.

### Pruebas ejecutadas tras la recuperación

| Grupo | Resultado |
|---|---:|
| Pruebas nuevas P0.6.1: matriz, router funcional y export de collections | **8/8 PASS** |
| Batería focalizada heredada P0.6 | **32/32 PASS** |
| Total ejecutado en la reanudación | **40/40 PASS** |
| P0.2I protegido | **11/11 SHA-256 PASS** |
| P0.3.1 protegido | **10/10 SHA-256 PASS** |
| P0.5 protegido | **16/16 SHA-256 PASS** |

Las dos correcciones realizadas durante la reanudación afectaron exclusivamente los dobles de prueba P0.6.1: el encadenamiento del mock `setHeader`, el filtro que excluye `/auth/callback` de la comparación de orden API y la expectativa del mensaje de rechazo seguro real de `collections`. Ningún router ni handler fue modificado.

### Estado final P0.6.1

La validación local del candidato queda completada: la configuración de rewrites, el transporte de los routers, el export CommonJS de `collections`, los contratos focalizados y las referencias protegidas pasaron sus comprobaciones disponibles.

El build Vercel local y el recuento de bundles reales permanecen **BLOCKED**, no por una prueba fallida sino porque no existe `.vercel/project.json` en el staging y la única ruta documentada de configuración exigiría enlace/pull remoto, que sigue prohibido. Tampoco está demostrado que redirigir `TEMP`/`npm_config_cache` redirija el descargador interno del binario de Vercel; no se intentó descargar binarios en `C:`.
