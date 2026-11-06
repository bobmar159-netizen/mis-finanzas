# YARBI — F04: validación funcional del Preview aislado

**Resultado:** `PREVIEW_F04_FUNCIONAL_VALIDADO_CON_OBSERVACIONES`

## Entorno verificado

- Proyecto Vercel aislado: `yarbi-preview-candidate-20261105` (`prj_XLJfUU1Kbz921OtThefimBy3XQIJ`).
- Deployment funcional autenticado: `dpl_2zzZT4YsgfwsTjsmAadGS3YTqeVk`.
- Deployment final corregido: `dpl_G3wTWAoDV9E5x6ZzvSKqNa54Z7Em`.
- URL final: `https://yarbi-preview-candidate-20261105-ige9j6prq-omar-dfc4.vercel.app`.
- Estado final Vercel: `READY`, Preview, sin alias de Production y sin promoción.
- Deployment Protection: SSO activa para los deployments; el bypass temporal de automatización permanece revocado.
- Supabase aislado confirmado por el endpoint público de configuración: `uevilhbstnmmdlgyshlv.supabase.co`.
- El modo `previewOwnerReferencesOnly` está activo.
- Functions generadas: 9, dentro del límite de 12 del plan Hobby.

## Defectos corregidos

1. La UI conservaba el refresh token, pero las consultas CRM reutilizaban un access token vencido. Se añadió renovación previa y un único reintento controlado exclusivamente tras HTTP 401.
2. Al recargar el Preview de solo lectura se intentaban restaurar configuración, bóveda y deudas. Esto consultaba la tabla opcional `yarbi_user_settings`, ausente en el aislado, y producía HTTP 502. El arranque Preview ahora solo valida/renueva la sesión y no ejecuta esas lecturas ni escrituras.

La conducta normal fuera del modo CRM Preview conserva el flujo anterior.

## Validación funcional real

| Criterio | Resultado | Evidencia |
|---|---|---|
| Carga visual de la interfaz Preview protegida | `PASS` | La aplicación “Mi Negocio” cargó en navegador bajo Vercel Authentication. |
| Autenticación con propietario sintético | `PASS` | Sesión sintética activada sin exponer credenciales. |
| Búsqueda por teléfono | `PASS` | El teléfono sintético del owner A devolvió su contacto; el del owner B no devolvió coincidencias. |
| Búsqueda por nombre | `PASS` | Devolvió únicamente los dos contactos sintéticos scoped del owner A. |
| Búsqueda por distrito | `PASS` | `Comas` devolvió únicamente el registro esperado del owner A. |
| Búsqueda por servicio | `PASS` | `reparacion` devolvió únicamente el registro esperado del owner A. |
| Búsqueda por historial | `NOT PROVEN` | No se ejecutó una consulta remota específica por historial. |
| Aislamiento entre propietarios | `PASS` | El teléfono sintético perteneciente al owner B quedó excluido de la sesión owner A. |
| Apertura de expediente | `PASS` | Expediente correcto con estado `tibio`, procedencia y pendientes estructurados. |
| Agenda | `PASS` con datos vacíos | La pantalla cargó sin error y mostró la semana; no había actividades sintéticas remotas. |
| Cotización ausente | `PASS` | Se mostró `No disponible · unavailable`, sin inventar información. |
| Cobros parciales remotos | `NOT PROVEN` | El expediente remoto observado tenía S/ 0 cobrado y S/ 0 pendiente; no existía fixture parcial. |
| Prevención de doble contabilización | `PASS` local | Cubierta por las pruebas focalizadas de finanzas; no demostrada con cobro parcial remoto. |
| Persistencia de sesión tras recarga | `PASS` | Después de recargar, una búsqueda autenticada continuó funcionando en el deployment funcional. |
| Arranque Preview sin restauración opcional | `PASS` local y de artefacto | La rama read-only no llama configuración, bóveda, deudas ni restauración completa. |
| Ausencia de acciones comerciales | `PASS` | Solo se observaron lecturas del Preview/Supabase aislado; no hubo Gemini, WhatsApp, Notion, Meta ni acciones CRM. |

## Pruebas y builds

- Regresión local relacionada anterior: 33/33 `PASS`.
- Pruebas focalizadas después de la corrección final: 19/19 `PASS`.
- Build unificado: 4/4 `PASS`.
- Build Web: `PASS`.
- Build Android WebView: `PASS` con origen Preview explícito; no se generó ni publicó APK.
- Sintaxis de scripts inline: 8/8 `PASS`.

Los SHA-1 del código fuente local y del código subido al deployment final coinciden exactamente:

- `frontend/index.html`: `dfd1af33a3218b11fc5630d307179a74e478e479`.
- `frontend/yarbi-product-completion-ui.js`: `74b2ccfbd670950a786acbcf9a6190020234a9e9`.

## Observabilidad y rendimiento

- La comprobación HTTP final de `auth-config` respondió correctamente y confirmó el host aislado.
- No se observó un nuevo fallo funcional 5xx durante la comprobación final.
- Vercel registró una advertencia deprecada de Node sobre `url.parse()`; no bloqueó la respuesta. Debe corregirse en mantenimiento posterior.
- Las entradas disponibles no incluían una duración HTTP uniforme; por ello p50 y p95 remotos permanecen `NOT PROVEN`. No se presentan tiempos de navegador como si fueran latencia de servidor.

## Seguridad y estado externo

- No se revelaron claves, contraseñas, JWT, UUID privados ni secretos.
- No se aplicaron migraciones ni se modificó Supabase.
- Production, sus alias y su deployment permanecen sin cambios.
- No se modificaron WhatsApp, Notion, Meta Ads, Gemini ni APK.
- No hubo escrituras ni acciones comerciales.

## Conclusión

El Preview aislado está **listo para pruebas funcionales desde Android**, pero no para declarar un APK de release. Antes de un cierre de release siguen pendientes una prueba real en dispositivo Android, una muestra remota con cobro parcial y mediciones HTTP instrumentadas suficientes para p50/p95.
