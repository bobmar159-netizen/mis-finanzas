# F02 — Resultados de regresión local

Fecha: 2026-11-08. No se ejecutaron despliegues, SQL remoto, Gemini, WhatsApp, Notion, Meta, ni se generó APK.

| Verificación | Resultado | Evidencia |
|---|---|---|
| Rechazo de `owner_id` / `contact_ids` del cliente | PASS | `tests/f02-identity-security.test.js` |
| Scope A no contiene contacto ajeno | PASS | mock local de `yarbi_owner_contact_scope` |
| Token legado sin Bearer | PASS | devuelve `owner_reference_unauthorized` sin llamar Auth |
| Rutas interactivas migradas no declaran `ASSISTANT_TOKEN` | PASS | inspección automatizada de seis handlers |
| Bridge frontend: borra token y coloca Bearer | PASS | inspección automatizada de `frontend/index.html` |
| Sintaxis de handlers CommonJS migrados | PASS | `node --check` en cinco handlers y librería compartida |
| Scripts inline web / Android | PASS | 8 / 3 scripts válidos |
| Build frontend web | PASS | `p02i-799033592836338b` local |
| Build frontend Android con origen sintético HTTPS | PASS | `https://android-isolated.example.test`; sin red |
| Pruebas de fuente unificada | PASS | 4/4 `tests/frontend-unified-build.test.js` |
| Rewrites / presupuesto de functions | PASS parcial | matriz P0.6: 23 patrones API; no existe build Vercel local para contar bundles reales |
| Escaneo de secretos reconocibles en frontend y artefactos | PASS | no hubo coincidencias de Gemini, `sb_secret` ni `sk_live/test` |
| Router assistant cargado como módulo local | BLOCKED | falta dependencia local `@vercel/functions`; no se instaló ni se consultó red |
| Test histórico de rutas directas `api/assistant/*` | BLOCKED | el workspace sólo conserva handlers tras router en `api_handlers/`; los tests apuntan a archivos ausentes |
| `p061-collections-export` | EXPECTED CHANGE | espera igualdad byte a byte con el handler anterior; F02 cambió control de autorización de forma intencional |

## Límites de las métricas

No se reportan p50/p95 HTTP: no hubo solicitudes a Preview, Supabase ni proveedores. El build Android utilizó un host sintético exclusivamente para validar que el artefacto requiere un origen HTTPS explícito.
