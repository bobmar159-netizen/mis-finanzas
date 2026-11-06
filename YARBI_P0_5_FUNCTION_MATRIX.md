# YARBI P0.5 — Matriz de Functions y estrategia de empaquetado

Fecha: 2026-11-05  
Alcance: inspección local; no se ejecutó build, deployment ni consulta remota.

## Inventario observado

Se encontraron 18 entrypoints bajo `api/`. En un proyecto Vercel de tipo Other, cada archivo de `api/` se materializa como una Function. Por ello, el árbol actual supera el límite histórico de 12 Functions del plan Hobby para este modelo de despliegue.

| Ruta pública | Archivo | Grupo | Riesgo al consolidar | Estado P0.5 |
|---|---|---|---|---|
| `/api/notion-proxy` | `api/notion-proxy.js` | Integración Notion | Alto: credenciales y contrato externo | Mantener aislada |
| `/api/supabase-secure` | `api/supabase-secure.js` | Seguridad/base | Alto: autorización y acceso de servicio | Mantener aislada |
| `/api/webhook` | `api/webhook.js` | Ingreso WhatsApp | Crítico: firmas, idempotencia y proveedores | Mantener aislada |
| `/api/actions/approve` | `api/actions/approve.js` | Acción controlada | Alto: mutación protegida | Candidata a grupo interno de acciones |
| `/api/ai/process` | `api/ai/process.js` | Procesamiento comercial | Crítico: cola y efectos comerciales | Mantener aislada |
| `/api/assistant/chat` | `api/assistant/chat.js` | Asistente | Medio | Candidata a grupo assistant |
| `/api/assistant/collections` | `api/assistant/collections.js` | Asistente | Medio | Candidata a grupo assistant |
| `/api/assistant/command` | `api/assistant/command.js` | Asistente | Alto: comandos y autorización | Candidata a grupo assistant |
| `/api/assistant/live-token` | `api/assistant/live-token.js` | Asistente/voz | Alto: token de sesión | Candidata a grupo assistant |
| `/api/assistant/owner-action` | `api/assistant/owner-action.js` | Asistente/dueño | Alto: decisión del dueño | Candidata a grupo assistant |
| `/api/assistant/owner-inbox` | `api/assistant/owner-inbox.js` | Asistente/dueño | Medio | Candidata a grupo assistant |
| `/api/assistant/preferences` | `api/assistant/preferences.js` | Asistente | Medio | Candidata a grupo assistant |
| `/api/assistant/proactive-loop` | `api/assistant/proactive-loop.js` | Asistente/proactivo | Alto: ejecución programada | Candidata a grupo assistant |
| `/api/assistant/reference-candidates` | `api/assistant/reference-candidates.js` | Asistente | Medio | Candidata a grupo assistant |
| `/api/assistant/scheduled-followups` | `api/assistant/scheduled-followups.js` | Asistente | Alto: seguimientos | Candidata a grupo assistant |
| `/api/assistant/send-whatsapp` | `api/assistant/send-whatsapp.js` | Salida WhatsApp | Crítico: envío | Mantener aislada o grupo de acciones controladas |
| `/api/audit/trace` | `api/audit/trace.js` | Auditoría | Medio | Candidata a grupo interno de diagnóstico |
| `/api/location/resolve` | `api/location/resolve.js` | Ubicación | Medio: salida Maps | Candidata a grupo auxiliar |

## Alternativas evaluadas

| Alternativa | Conserva URLs | Reduce Functions Hobby | Riesgo | Decisión |
|---|---:|---:|---|---|
| A. Mantener 18 archivos con el runtime Other actual | Sí | No | El límite permanece | No viable en Hobby |
| B. Consolidación física de handlers relacionados detrás de un router interno | Sí, con rutas explícitas | Sí, potencialmente 18 a 9 o menos | Requiere staging, rutas, compatibilidad ESM/CJS y regresiones por contrato | Recomendada para la siguiente fase controlada |
| C. Adoptar framework que empaquete rutas como un único artefacto | Posiblemente | Posiblemente | Es una migración tecnológica; no es una estabilización pequeña | No recomendada ahora |
| D. Vercel Pro | Sí | Ya no bloquea por este límite | Coste recurrente y no elimina la deuda de estructura | Alternativa operativa, no ejecutada |

## Estrategia recomendada: B

Crear un empaquetado de *staging* que agrupe, sin cambiar aún la lógica de cada handler:

1. Un punto de entrada para el conjunto `assistant/*`, con despacho explícito por ruta y método.
2. Un grupo separado para utilidades controladas (`audit/trace`, `location/resolve`) solo tras comprobar sus contratos.
3. Mantener separados `webhook`, `ai/process`, `supabase-secure`, `notion-proxy` y `send-whatsapp` hasta tener pruebas de integración equivalentes.
4. Configurar las rutas públicas únicamente en una fase posterior, con un build local verificable. Mientras subsistan los 18 archivos bajo `api/`, Vercel seguirá detectándolos; un router añadido sin retirar o reubicar físicamente los entrypoints **no reduce** el número de Functions.

El objetivo inicial factible es bajar de 18 a 12 o menos sin fusionar los límites críticos. La implementación exige validar carga ESM/CommonJS: 6 handlers son ESM y 12 CommonJS; cualquier dispatcher CommonJS debe cargar ESM mediante `import()` controlado o una capa de compatibilidad probada. No se efectuó conversión masiva ni se modificó `vercel.json` en P0.5.

## Evidencia y límites

- La limitación de 12 se contrastó con la documentación de [Vercel Limits](https://vercel.com/docs/limits) para Functions de proyectos Other en Hobby.
- La opción Pro se documentó a partir de [Vercel Pro](https://vercel.com/docs/plans/pro-plan) y [Pricing](https://vercel.com/pricing); no se cambió el plan ni se contrató nada.
- La compatibilidad final de un empaquetado solo puede demostrarse con un build aislado de Vercel. P0.5 no realizó build ni deployment por la restricción de fase y el espacio insuficiente en `C:`.

## Recomendación para P0.6

Autorizar una sola subfase de empaquetado local con copia temporal en `D:`, sin tocar los entrypoints originales, para demostrar: rutas, métodos, autenticación, JSON, códigos HTTP y carga mixta ESM/CommonJS. Solo después decidir si se aplica la reducción física o se utiliza Pro.
