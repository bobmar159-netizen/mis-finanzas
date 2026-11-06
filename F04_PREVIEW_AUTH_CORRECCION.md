# F04 — Corrección de autenticación del Preview aislado

## Hecho comprobado

La interfaz de Preview cargaba, pero la búsqueda CRM mostraba `session_required`.
La inspección local demostró dos bloqueos independientes:

1. La política `YARBI_PREVIEW_OWNER_REFERENCES_ONLY` bloqueaba `GET /api/assistant/preferences?action=auth-config`, aun cuando ese endpoint solo entrega la URL aislada y una clave **publicable**.
2. El entorno Preview no tiene configurada `SUPABASE_PUBLISHABLE_KEY` (ni el alias `SUPABASE_ANON_KEY`), por lo que el navegador no puede solicitar una sesión de Supabase Auth.

No se consultó Production ni se leyó ninguna credencial.

## Corrección local

- `lib/preview-owner-reference-policy.js`: permite exclusivamente el `GET` exacto de `auth-config`, sin parámetros adicionales. Toda otra acción de `preferences` sigue bloqueada. Las consultas CRM continúan exigiendo `POST` y Bearer.
- `api_handlers/assistant/preferences.js`: expone un booleano no sensible que confirma el modo Preview aislado; no expone claves de servicio.
- `frontend/index.html`: agrega el inicio de sesión por contraseña **solo cuando** el servidor confirma el modo Preview aislado. Establece una sesión de Auth y no llama a restauración/sincronización de preferencias, bóveda o datos comerciales.
- `frontend/yarbi-product-completion-ui.js`: ante sesión ausente, dirige a la pantalla de Cuenta en lugar de dejar al usuario sin ruta de acceso.
- `tests/owner-reference-candidates-endpoint.test.js`: apunta al handler real reubicado en `api_handlers/`.
- `tests/f04-preview-auth-ui.test.js`: cubre la limitación Preview, limpieza del campo de contraseña y la ruta de acceso desde la Bandeja.

## Pruebas locales

| Verificación | Resultado |
|---|---|
| Política exacta de `auth-config`; otros métodos, rutas y parámetros | PASS |
| CRM aislado, owner scope y ausencia de egress comercial con mocks | PASS (8/8) |
| Inicio de sesión de Preview sin sincronizaciones | PASS |
| Builds reproducibles Web y Android | PASS |
| Finanzas F04 y build unificado | PASS (8/8) |

## Artefactos relevantes (SHA-256)

- `83D075382BC35A1B6CA78959B9E8D09FD8D15561CFE6D97B9681838E7D82A403` — `lib/preview-owner-reference-policy.js`
- `639ED96C27830191B449E60CBD19398AC89F30734C456A90ACA3124F98DF5729` — `api_handlers/assistant/preferences.js`
- `D066352F3756FEE51D26D54CC7C571EB44611E3C7D3FB2029C2644BE4FD303F2` — `frontend/index.html`
- `8E1480CA77278206F133E0020BD52DDB7C7C0ADD2847A7D0F36726BC57E53D44` — `frontend/yarbi-product-completion-ui.js`
- `30F63592A7512E4A6BF9707413BD564B6E5641D64CF856E0546A0BFA6D1E9815` — `tests/f04-preview-auth-ui.test.js`

## Paso pendiente

Antes del deployment Preview se debe crear `SUPABASE_PUBLISHABLE_KEY` como variable **Config**, únicamente para **Preview**, con la publishable key `sb_publishable_…` de `yarbi-audit-preview`. Esta clave es pública por diseño; no se debe usar ni almacenar la `sb_secret_…` en el navegador.

Después de configurar esa variable, queda pendiente un único deployment Preview y la prueba manual de búsqueda CRM con el propietario sintético autorizado. Production, Supabase de Production, WhatsApp, Notion, Meta Ads y APK no fueron modificados.

## Deployment Preview

- Primer intento: `dpl_8Chy8Kbj2dtAJQwdBVF51aCGGm3K` devolvió `503 yarbi_config_preview_mode_required` para `auth-config`. La causa fue una incompatibilidad demostrada entre `yarbi-runtime-config` y el modo de referencias CRM aislado.
- Corrección: `yarbi-runtime-config` acepta el modo de referencias únicamente cuando pasa la política canónica ya existente: Preview, `project_ref` aislado, URL exacta de Supabase, clave de servicio y sin integraciones externas.
- Deployment corregido: `dpl_Bft6TzyoJ4LBTb8uKc8HgVkzx5L4`
- URL: `https://yarbi-preview-candidate-20261105-demkr78r8-omar-dfc4.vercel.app`
- Estado en Vercel: `READY`
- Target: Preview (`target: null`), sin alias promovido.
- Verificación HTTP sanitizada de `auth-config`: `ok=true`, URL aislada presente, clave publicable presente, modo de referencias activo. No se imprimieron valores.

La validación manual autenticada y la consulta real de CRM siguen pendientes.
