# YARBI P0.3.1 — Configuración segura y presupuesto de Functions

Fecha: 2026-11-05  
Alcance: local exclusivamente. No se realizaron conexiones remotas, despliegues, migraciones, llamadas a proveedores ni cambios en Production.

## Resultado

La configuración de las siete rutas priorizadas ahora se valida de forma centralizada antes de cualquier lectura/escritura de Supabase o llamada externa. Ninguna conserva un *fallback* literal hacia el host de Production. P0.2I permanece íntegro: **11/11 hashes protegidos coinciden antes y después**.

El repositorio no contiene metadatos Git en esta copia de trabajo; por ello no se creó rama ni se ejecutó ninguna operación destructiva de Git.

## Política central aplicada

Se añadió `validateServerRouteConfig(...)` en `lib/yarbi-runtime-config.js`. La política es server-side y no expone secretos:

| Entorno | Regla |
|---|---|
| Production | Requiere `SUPABASE_URL` y `SUPABASE_SECRET_KEY` configuradas explícitamente. No hay URL implícita en el código. |
| Preview | Requiere los controles existentes de preview funcional sintético, `YARBI_PREVIEW_SUPABASE_PROJECT_REF`, host de deployment y un `SUPABASE_URL` que coincida con el proyecto aislado. Un host conocido de Production se rechaza. |
| Desarrollo/local | Requiere URL y clave explícitas. Rechaza como destino el host conocido de Production. |
| Configuración ausente o inválida | Respuesta segura `503` con `error: configuration_invalid` y código sanitizado; no se inicia Supabase, proveedor ni procesador. |

Variables base nuevas o formalizadas por la política: `SUPABASE_URL` y `SUPABASE_SECRET_KEY`. La política reutiliza los nombres de preview ya existentes (`VERCEL_ENV`, `YARBI_PREVIEW_FUNCTIONAL_SYNTHETIC_ONLY`, `YARBI_PREVIEW_SUPABASE_PROJECT_REF`, `YARBI_PREVIEW_DEPLOYMENT_HOST`, `YARBI_PREVIEW_AUDIT_ONLY`, `YARBI_TRACE_HMAC_KEY`, `ASSISTANT_API_TOKEN`, `YARBI_PREVIEW_SYNTHETIC_TOKEN`). No se añadieron secretos a archivos ni artefactos.

`AI_PROCESSOR_URL` es obligatorio para el despacho cron de seguimientos, y opcional para `send-whatsapp`: si está ausente, un envío confirmado puede persistirse, pero no se programa un procesador por una URL de Production implícita. Si está presente, se valida contra el host autorizado de Preview.

## Rutas corregidas

| Ruta | Configuración validada antes de efectos | Resultado cuando falta/invalida |
|---|---|---|
| `api/actions/approve.js` | Supabase explícito | 503 seguro |
| `api/assistant/collections.js` | Supabase explícito | 503 seguro |
| `api/assistant/command.js` | Supabase explícito | 503 seguro |
| `api/assistant/preferences.js` | Supabase explícito | 503 seguro, conserva `ok:false` |
| `api/assistant/scheduled-followups.js` | Supabase; cron además exige procesador explícito | 503 seguro antes de despacho |
| `api/assistant/send-whatsapp.js` | Supabase explícito; procesador opcional y validado si existe | 503 seguro antes de proveedor/persistencia |
| `api/supabase-secure.js` | Supabase explícito | 503 seguro |

Se eliminaron los valores por defecto literales a `haifktjvyhbsazmiyqps.supabase.co` y a `misfinanzas-backend.vercel.app` de esas rutas. Los hosts de Production que permanecen en `lib/yarbi-runtime-config.js` son una lista de denegación para evitar su uso fuera de Production, no un destino de fallback.

## Validación local

| Comprobación | Resultado |
|---|---|
| Protección P0.2I | PASS — 11/11 hashes iguales a `YARBI_P0_2I_SHA256SUMS.txt` antes y después |
| Política pura: URL válida aislada, ausente e inválida | PASS — 6/6 pruebas de `p03-server-route-config` |
| Preview sin configuración aislada / con host de Production | PASS |
| Las siete rutas reales devuelven 503 antes de `fetch` ante configuración ausente | PASS — sin efectos secundarios observados |
| Ausencia de fallback literal activo en las siete rutas | PASS — comprobación estática y pruebas de handler |
| Regresión focalizada (configuración, seguridad, procesador, F3A–F3K, referencias, WhatsApp, colecciones) | PASS — 79/79 |
| Sintaxis de las 18 Functions | PASS — 18/18 con `node --check` |
| Suite completa `npm test` | FAIL preexistente/no verde: proceso termina con código 1 por regresiones fuera de este alcance; no se modificaron para forzar una aprobación |

La nueva prueba usa únicamente destinos y credenciales sintéticas en memoria. No permite red, Supabase, Gemini, Notion, WhatsApp ni otro proveedor.

## Presupuesto de Functions: 18 frente a 12

Se verificaron **18 Functions** activas: `actions/approve`, `ai/process`, `assistant/chat`, `assistant/collections`, `assistant/command`, `assistant/live-token`, `assistant/owner-action`, `assistant/owner-inbox`, `assistant/preferences`, `assistant/proactive-loop`, `assistant/reference-candidates`, `assistant/scheduled-followups`, `assistant/send-whatsapp`, `audit/trace`, `location/resolve`, `notion-proxy`, `supabase-secure` y `webhook`.

La prueba histórica `tests/vercel-deployment.test.js` exige como máximo 12 y falla exactamente al hallar 18. `vercel.json` no define límite de Functions ni empaquetado que imponga ese número. La evidencia local demuestra una expectativa arquitectónica histórica, pero **NOT PROVEN** que sea una limitación vigente del plan o de Vercel: confirmarlo requeriría una consulta autorizada al proyecto/plataforma.

Alternativas para P0.4, sin ejecutarlas aquí:

1. Confirmar el límite vigente en Vercel y actualizar la expectativa solo si se prueba que 12 ya no aplica. Es la opción de menor riesgo de contrato.
2. Conservar las 18 rutas y medir build/cold starts en un Preview controlado.
3. Consolidar únicamente un grupo cohesivo de rutas auxiliares tras pruebas de contrato por ruta. Reduce el recuento, pero eleva radio de impacto, tamaño de bundle y riesgo de mezclar autenticación/errores.
4. Crear un dispatcher general no se recomienda ahora: cambia demasiado el aislamiento y los contratos de rutas.

No hay evidencia local de un coste directo por tener 18 Functions; sí existe riesgo de mayor superficie de despliegue y de límites de plataforma que debe verificarse antes de cambiar la prueba o consolidar.

## ESM y CommonJS

Seis handlers usan ESM: `webhook`, `notion-proxy`, `supabase-secure`, `actions/approve`, `ai/process` y `assistant/collections`. Doce usan CommonJS: `location/resolve`, `audit/trace`, `assistant/chat`, `command`, `live-token`, `owner-action`, `owner-inbox`, `preferences`, `proactive-loop`, `send-whatsapp`, `reference-candidates` y `scheduled-followups`.

Los 18 pasan sintaxis local. `package.json` no declara `type: module`; por tanto, la compatibilidad final de la mezcla depende del empaquetado de Vercel y queda **NOT PROVEN** sin un build/deployment de Preview. No se hizo conversión masiva. La recomendación es validar el build aislado primero y decidir una transición incremental únicamente ante un fallo real del empaquetador.

## Archivos modificados y SHA-256

| Archivo | SHA-256 |
|---|---|
| `lib/yarbi-runtime-config.js` | `5668d0b22fa56e8a9c725d0379d8c8d3781ad1a168529f430d1576a684e2215a` |
| `api/actions/approve.js` | `3b24a9f94b9be5972cfaa133532e439b1e4081388bcb2ab31510f86d3f59c86e` |
| `api/assistant/collections.js` | `90cd6a3e9299f58e3d19d6326293877817330652fd6783f16245d00337847163` |
| `api/assistant/command.js` | `dd3780a48c7a9e61599868306c55b3996238eda203955ec048a58cd1c27e13d2` |
| `api/assistant/preferences.js` | `1aab69ce0b3fe1981260c39f516c09af5ecd46e71c4f19f57b41b0aeeefca606` |
| `api/assistant/scheduled-followups.js` | `7a1a67c15dc1b3c8b5b617b3eeb9476af6d89fc5fdee4920a040b71c88660b09` |
| `api/assistant/send-whatsapp.js` | `04d6393b9c85a9f0d69e22260699d48408fe0fc1c53b131b4ae5ce5bbdd9c701` |
| `api/supabase-secure.js` | `9c5f4572e0a7471a1609678897af09f71b1b4f2428761dfa103e3351bc83d810` |
| `tests/p03-server-route-config.test.js` | `99855be1c44dd67ff8b6140331f7ac4ce2849e27f031bc0cb8bc5baa3ddcdadd` |
| `tests/whatsapp-send-provider.test.js` | `72edb67f4b21f120936e322b8995f5847f1d65ba2ee460c496c4e05abd9af75e` |

## Riesgos pendientes y recomendación P0.4

- La suite completa no está verde por fallos fuera de P0.3.1; requieren clasificación contra su propia línea base antes de cualquier despliegue.
- El límite de 12 Functions y la compatibilidad de build ESM/CommonJS deben verificarse contra Vercel en un Preview aislado antes de modificar arquitectura o la prueba histórica.
- Las integraciones externas mantienen sus propios requisitos de credenciales; este cambio garantiza que las siete rutas no alcanzan esos efectos si la configuración de Supabase/Preview es inválida.

Recomendación: una P0.4 limitada a preflight de build Vercel Preview, confirmación documentada del presupuesto real de Functions y clasificación de la suite completa. No desplegar Production ni consolidar rutas hasta contar con esa evidencia.
