# F05 — Inteligencia natural y velocidad

## Resultado

**F05_LOCAL_VALIDADA — preparada para validación aislada posterior.**

Se integró una conversación autenticada de solo lectura al router existente. Reutiliza FAST_LOCAL para lecturas verificables de Agenda y Finanzas, y el adaptador Gemini V4 compacto para lenguaje abierto cuando el proveedor esté explícitamente habilitado en un entorno futuro. No se hizo ninguna llamada real a Gemini en esta fase.

## Implementación

- Nueva ruta interna: `POST /api/assistant/conversation`, alojada en el router de Assistant existente; no crea una Function Vercel adicional.
- Autenticación con el Bearer de Supabase y resolución del alcance canónico del propietario en el servidor.
- Continuidad de conversación firmada, expirable a 20 minutos y ligada al propietario autenticado. El navegador no puede declarar propietarios, contactos ni candidatos.
- FAST_LOCAL resuelve lecturas deterministas de Agenda, seguimientos y cobros verificados sin invocar un proveedor.
- El proveedor V4 pasa por normalización estricta, hardener V4, adaptador V4→V1 y el hardener existente. Una mención negada no se convierte en restricción positiva.
- Fallos de proveedor, timeout, JSON/contrato inválido o indisponibilidad conservan el contexto y devuelven una abstención útil; no inventan clientes, pagos, visitas ni cotizaciones.
- Todas las propuestas devuelven `execute:false` y `commercial_effects_allowed:false`.
- La interfaz unificada usa la ruta autenticada en Preview de referencias; ante configuración ausente falla cerrada y no vuelve al chat heredado.

## Pruebas focalizadas

`node --test` ejecutó **52/52 PASS** con mocks locales y fixtures sintéticos.

- Batería independiente F05: 10/10 casos. Los 7 casos inequívocos pasaron (100%); los 3 casos que requieren comprensión de proveedor y el caso «No envíes nada todavía» se abstuvieron de forma segura con el proveedor no disponible.
- Negación/corrección: «No era Carlos, era Carla» conserva a Carla y nunca promueve a Carlos como filtro positivo.
- Continuidad: «El segundo cliente» usa solamente candidatos firmados del mismo propietario y no abre ni modifica un expediente sin confirmación.
- Owner scope: Bearer ausente y campos de owner/contacto inyectados se rechazan antes de leer datos.
- Egress: el handler se probó con un interceptor que permite exclusivamente el host sintético del Supabase aislado; Gemini, WhatsApp, Agenda externa, Notion y otros destinos no se invocaron.
- Builds: `npm run build:frontend:web` y `npm run build:frontend:android` terminaron correctamente. Android usó el origen sintético `https://yarbi-android-build.invalid`.

## Rendimiento

Las 40 lecturas FAST_LOCAL sintéticas tuvieron p50 **0.32 ms** y p95 **0.46 ms** de CPU local. La separación de métricas está en `F05_METRICAS_RENDIMIENTO.json`.

Preview HTTP, Supabase remoto, Gemini real y dispositivo Android permanecen **no medidos**; no se presentan como equivalentes al rendimiento de usuario.

## Archivos funcionales

- `api_handlers/assistant/conversation.js`
- `api/assistant-router.js`
- `lib/yarbi-v4-provider.js`
- `lib/yarbi-conversation-continuity.js`
- `lib/yarbi-conversation-runtime.js`
- `lib/preview-owner-reference-policy.js`
- `frontend/index.html` y artefactos web generados (`index.html`, `runtime-config.js`, `service-worker.js`)
- `vercel.json` y pruebas F05/routers/frontend.

## Estado por capacidad

| Capacidad | Local | Preview | Android físico |
| --- | --- | --- | --- |
| FAST_LOCAL Agenda/Finanzas | Validado | No ejecutado | No ejecutado |
| V4 → hardening → V1/V3 | Validado con respuesta sintética | No ejecutado | No ejecutado |
| Autenticación y owner scope | Validado con mock aislado | No ejecutado | No ejecutado |
| Gemini real | No autorizado / no invocado | Pendiente | Pendiente |
| Acciones comerciales | Bloqueadas | No ejecutado | No ejecutado |
| Builds web y Android | Generados | No desplegado | No instalado |

## Límites pendientes

- La comprensión real de Gemini y sus latencias requieren una autorización posterior y un Preview aislado; no se infieren a partir de respuestas simuladas.
- El caso sin `msg.id` estable permanece como deuda técnica previa a producción.
- El flujo de recordatorio prepara una propuesta no ejecutable: crear o modificar actividades sigue requiriendo el flujo existente de confirmación.

## Siguiente paso

F06 puede reutilizar la memoria operativa existente para añadir recuperación y entrenamiento revisable sobre este mismo recorrido, sin crear un segundo cerebro ni una segunda memoria.
