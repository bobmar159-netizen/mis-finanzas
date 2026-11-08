# YARBI F02.1 — Resultados de regresión local

Fecha: 2026-11-08. Todo fue local y con mocks/datos sintéticos. No hubo red ni proveedores.

| Grupo | Resultado | Evidencia |
|---|---:|---|
| Scope de mensajes, paginación, filtros y respuesta defensiva | 3/3 PASS | `tests/f021-identity-whatsapp.test.js` |
| Borradores sin relación canónica y borradores con `contact_id` | 2/2 PASS | `tests/f021-identity-whatsapp.test.js` |
| Rechazo de token legacy y secretos Notion de cliente | 2/2 PASS | `tests/f021-identity-whatsapp.test.js` |
| Separación webhook/proveedor y retirada de fallback de preferencias | 2/2 PASS | `tests/f021-identity-whatsapp.test.js` |
| Identidad F02 anterior | 5/5 PASS | `tests/f02-identity-security.test.js` |
| Firma HMAC YCloud | 4/4 PASS | `tests/f3d-ycloud-webhook-auth.test.js` |
| Handler webhook: firma, deduplicación e interacción estructurada | 2/2 PASS | `tests/f3d-webhook-handler-auth.test.js` |
| WhatsApp Business: autorización de envío, estados y normalización | 4/4 PASS | `tests/f08-whatsapp-business.test.js` |
| Rewrites y orden de routers | 2/2 PASS | `tests/p061-rewrite-matrix.test.js` |
| Total focalizado | **25/25 PASS** | comandos locales documentados abajo |
| Sintaxis inline | PASS | `frontend/index.html`: 8; `index.html`: 8; `www/index.html`: 3 |
| Build web | PASS | release local `p02i-0c5cf70f24e0c587` |
| Build Android | PASS | mismo release, con `https://android-isolated.example.test` sintético |
| Pruebas de frontend unificado | 4/4 PASS | `tests/frontend-unified-build.test.js` |

## Comandos ejecutados

```text
node --test tests/f021-identity-whatsapp.test.js tests/f02-identity-security.test.js \
  tests/f3d-ycloud-webhook-auth.test.js tests/f3d-webhook-handler-auth.test.js \
  tests/f08-whatsapp-business.test.js tests/p061-rewrite-matrix.test.js
node tests/validate-inline-scripts.js frontend/index.html
npm run build:frontend:web
YARBI_ANDROID_API_ORIGIN=https://android-isolated.example.test npm run build:frontend:android
node --test tests/frontend-unified-build.test.js
```

## Integridad heredada

| Manifiesto | Coinciden | Diferencias | Interpretación |
|---|---:|---:|---|
| `F01_SHA256SUMS.txt` | 15 | 8 | Cambios descendientes ya existentes de F02 y artefactos regenerados; no se restauraron porque forman parte de la fuente canónica posterior. |
| `F02_SHA256SUMS.txt` | 16 | 5 | Diferencias esperadas de F02.1: frontend generado, runtime/service worker y `vercel.json`. |

Los manifiestos previos son históricos y no se reescribieron. F02.1 añade su propio manifiesto en lugar de alterar la evidencia anterior.

## Límites

- No existe prueba de bundle real de Vercel; el conteo de 9 entrypoints es estático.
- `draft_actions` no tiene localmente una relación verificable con CRM; su lectura queda bloqueada de forma segura.
- Notion no tiene una proyección contacto/owner verificable y queda bloqueado antes del egress.
- La eliminación completa de construcciones legacy del frontend queda pendiente; los routes migrados ya no dependen de ellas.
