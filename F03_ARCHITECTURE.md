# YARBI F03 — Arquitectura del cerebro único FAST / STANDARD / DEEP

Fecha: 2026-11-08. Rama aislada: `f03-intelligence-isolated`, base `07283d9`.

## Un solo cerebro

`/api/assistant/conversation` continúa siendo la superficie autenticada. No se
crearon asistentes adicionales ni se modificaron los helpers de autenticación
de F02.1.

```text
sesión Bearer → identidad canónica → scope de propietario → contexto firmado
                                                   │
                         yarbi-intelligence-router │
             ┌─────────────────────────────────────┼───────────────────────┐
             FAST                                  STANDARD                 DEEP
             Agenda / Finanzas / FAQ               Gemini V4 existente      petición durable
             sólo lecturas verificables             lenguaje y contexto      nunca memoria Vercel
```

### FAST

- Agenda, Finanzas y FAQ deterministas siguen usando los módulos existentes.
- Las búsquedas CRM conservan `yarbi_owner_contact_scope` y `yarbi-scoped-cache`.
- La caché se segmenta por hash de propietario y admite invalidación por contacto; el procesador canónico ya invalida la caché CRM al actualizar un contacto.
- Una respuesta FAST nunca ejecuta acciones comerciales ni invoca Gemini.

### STANDARD

- Reutiliza Gemini V4, continuidad firmada, resolvedor de referencias y
  normalización/hardening existentes.
- Si el proveedor falla, devuelve abstención segura, preserva el contexto y no
  inventa clientes, pagos ni visitas.
- No se modificó Gemini Live, el prompt, el modelo ni sus credenciales.

### DEEP

- `yarbi-deep-analysis.js` sólo acepta un `durableStore.enqueue` explícito y
  una llave de idempotencia.
- No se encontró una tabla/migración local verificable para trabajos analíticos
  genéricos; `ai_message_analysis` es la cola del procesador de mensajes, no
  una cola demostrada para ventas, Meta Ads o rentabilidad.
- Sin store durable, DEEP responde `deep_infrastructure_unavailable` antes de
  Gemini y sin escribir en memoria de proceso. Por tanto, DEEP está preparado
  como contrato, pero **no está operativo**.

## Seguridad y contexto

- El owner se obtiene de la sesión, no del cuerpo de la petición.
- `conversation_token` sigue firmado y enlazado al owner.
- El router no acepta `owner_id`, candidatos ni scope enviados por navegador.
- Las métricas no almacenan frase, respuesta, credenciales ni datos de cliente.
- Todo resultado devuelve `execute:false` y `commercial_effects_allowed:false`.

## Pistas de reconocimiento CRM

La búsqueda existente combina contactos scoped, identificadores, memoria
operativa, mensajes, análisis, Agenda y cobranzas. No se encontró una tabla
local autenticada específicamente destinada a «pistas de reconocimiento» ni
una relación adicional que sea seguro inventar. F03 conserva el diseño dentro
del buscador CRM existente; la integración de nuevas pistas requiere primero
un esquema durable autorizado.
