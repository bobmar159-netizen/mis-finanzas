# YARBI P0.6 — Empaquetado local y validación de 18 rutas

Fecha: 2026-11-05  
Workspace candidato: `D:\YARBI_P06_STAGING_20261105`  
Estado: **P0.6 PARCIAL — CANDIDATO LOCAL VALIDADO; BUILD VERCEL BLOQUEADO DE FORMA SEGURA**.

## Protección y aislamiento

El proyecto original en `C:\Users\BOB\Desktop\Codex Finanzas\YARBI_BACKEND_MERGED_20260930` no fue modificado.

| Referencia protegida en original | Resultado antes y después |
|---|---|
| P0.2I | 11/11 SHA-256 coinciden |
| P0.3.1 | 10/10 SHA-256 coinciden |
| P0.5 | 16/16 SHA-256 coinciden |

La copia de trabajo se creó sin `.vercel`, `.git` ni variables locales. Se copiaron fuentes y dependencias ya disponibles a `D:`; no se instalaron paquetes ni se importaron secretos. El espacio pasó aproximadamente de 401.86 GB libres en `D:` a 401.65 GB. `C:` comenzó con aproximadamente 30 MB y acabó sin espacio libre medible: Vercel CLI intentó descargar su binario y recibió `ENOSPC`, aunque su fallback Node permitió consultar versión y ayuda. No se borró ningún archivo para recuperar espacio.

## Inventario y arquitectura candidata

Los 18 entrypoints iniciales se mantienen como contratos públicos. La copia candidata contiene:

- 5 endpoints críticos independientes: `webhook`, `ai/process`, `supabase-secure`, `notion-proxy`, `assistant/send-whatsapp`.
- 1 endpoint independiente de acciones: `actions/approve`.
- 1 router Assistant para 10 rutas cerradas.
- 1 router de utilidades para `audit/trace` y `location/resolve`.

Resultado de inventario estático: **8 archivos Function bajo `api/`**, con 12 handlers reubicados en `api_handlers/`. No existen comodines de ejecución: ambos routers usan un mapa cerrado de rutas y devuelven `404` ante una clave no permitida.

| URL pública | Destino candidato | Validación disponible |
|---|---|---|
| `/api/webhook`, `/api/whatsapp/messages` | `api/webhook.js` | Firma YCloud/regresiones existentes |
| `/api/ai/process` | `api/ai/process.js` | Estática; no se ejecutó procesamiento comercial |
| `/api/supabase-secure` | `api/supabase-secure.js` | Guardia de configuración P0.3.1 |
| `/api/notion-proxy` | `api/notion-proxy.js` | Estática; proveedor mock pendiente |
| `/api/assistant/send-whatsapp` | `api/assistant/send-whatsapp.js` | Regresión de confirmación/sender |
| `/api/actions/approve` | `api/actions/approve.js` | Guardia de configuración P0.3.1 |
| 10 rutas `/api/assistant/*` | `api/assistant-router.js` | Paridad local con handler reubicado para entrada sin autorización/configuración |
| `/api/audit/trace`, `/api/location/resolve` | `api/utility-router.js` | Paridad local con handler reubicado para entrada inválida |

`vercel.json` fue modificado solo en `D:` con rewrites explícitos; conserva cada URL pública y no usa wildcard ambiguo. Los query strings se preservan, removiendo únicamente el parámetro interno `__p06_route` antes de invocar el handler.

## ESM/CommonJS

El análisis real encontró cinco entrypoints restantes con `export default` y los doce handlers agrupados son CommonJS una vez corregido `collections` en el candidato. El archivo `collections.js` mezclaba `require(...)` con `export default`; Node local lo interpretaba como ESM y fallaba con `require is not defined`. Se cambió exclusivamente su exportación en el staging a `module.exports = async function handler(...)`, conservando cuerpo, validaciones y respuestas. No se realizó conversión masiva ni se tocó el original.

Comprobación de sintaxis: **20/20** archivos del candidato (`api/` + `api_handlers/`) aceptados por `node --check`.

## Pruebas ejecutadas

| Prueba | Resultado |
|---|---|
| Router Assistant: 10 rutas cerradas, query restaurada y equivalencia frente al handler en entrada de rechazo | PASS |
| Router utilidades: 2 rutas cerradas, query restaurada y equivalencia en entrada inválida | PASS |
| Rutas públicas explícitas y 8 entrypoints detectables | PASS |
| Configuración segura P0.3.1 con rutas reubicadas | 6/6 PASS |
| P0.5 identidad/conversación/audio personal | 9/9 PASS |
| Firma y webhook YCloud | 6/6 PASS |
| Sender WhatsApp: confirmación y ambigüedad | 4/4 PASS |
| Build fuente unificada P0.2I | 3/3 PASS |
| Regresión focalizada final | **32/32 PASS** |

La prueba original `tests/p03-server-route-config.test.js` se conserva sin modificación en el proyecto fuente. En staging no puede localizar cuatro rutas porque fueron reubicadas intencionalmente; por ello se creó `tests/p06-server-route-config-compat.test.js`, copia que modifica solo la ubicación de lectura de las rutas reubicadas y mantiene todas las mismas aserciones de política y ausencia de efectos. No se alteró ninguna expectativa para forzar PASS.

## Build Vercel

- CLI comprobado: Vercel CLI 65.11.0, con fallback Node por falta de espacio al descargar binario.
- `vercel build --help` comprobado localmente.
- El staging no posee `.vercel/project.json` a propósito.
- La ayuda del CLI confirma que, sin configuración local, `--yes` autoriza el pull de variables/configuración del proyecto. P0.6 prohíbe vincular, descargar variables, importar secretos o consultar remoto.

Por ese motivo **no se ejecutó `vercel build`** y no existe `.vercel/output` candidato. El conteo de 8 es un resultado estático de entrypoints, no una afirmación de Functions generadas por Vercel. No es lícito declarar el build PASS sin una configuración local aislada aprobada.

## Fallos y límites

1. El build Vercel está bloqueado por ausencia deliberada de vínculo/configuración local y la prohibición de obtenerlos desde remoto.
2. No se realizó una prueba HTTP real de las 18 rutas: los contratos de proveedor (Notion, Supabase, Gemini, WhatsApp) quedan en mocks/guards. La paridad demostrada de los routers cubre entradas que terminan antes de efectos externos.
3. La corrección de `collections` necesita ser revisada en un build Vercel real aislado antes de integración; localmente resuelve el defecto ESM/CommonJS demostrado.
4. Los 30 fallos históricos de la suite general no se ocultaron ni se resolvieron en P0.6.

## Recomendación de integración futura

Autorizar una fase separada para crear una configuración de build **puramente local y sintética** para Vercel, sin `.vercel/project.json` ni pull de variables remotas, o autorizar expresamente un enlace aislado que no herede Production. Con ello se podrá ejecutar `vercel build`, contar `.vercel/output/functions` y verificar los bundles antes de considerar cualquier integración al proyecto original.

## Confirmación de restricciones

No hubo deployment, `vercel deploy`, `vercel promote`, `vercel alias`, `vercel env pull`, llamadas a Gemini, WhatsApp, Meta, Notion, Supabase remoto, migraciones, APK, Capacitor sync ni cambios de Production.
