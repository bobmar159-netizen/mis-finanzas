# YARBI P0.5 — Matriz de fallos históricos

Fecha: 2026-11-05. Esta matriz conserva la línea base de P0.4: 30 fallos heredados. La suite completa local de P0.5 produjo los mismos 30 nombres de prueba fallida; las 61 líneas de fallo del registro incluyen el resumen repetido del runner y no representan 61 fallos independientes.

## Clasificación de continuidad

| Prueba histórica | Clasificación P0.5 | Acción en P0.5 | Estado |
|---|---|---|---|
| `barge-in guard: protected VAD block matches the approved behavior` | Fuente frontend histórica | No se modificó voz/VAD | Pendiente |
| `command keeps the existing phone conflict guard for focused mutations` | Contrato UI/command no verificado | No se cambió command | Pendiente |
| `daily close: behavior excludes future and already completed records` | Expectativa frontend raíz | Migrar prueba a `frontend/` en fase posterior | Pendiente |
| `daily close: waits for canonical Supabase confirmation and reports pending sync honestly` | Contrato remoto/mocks incompletos | Sin acceso remoto | NOT PROVEN |
| `processing failures stop retrying after three attempts and remain traceable` | Procesador/ledger | No incluido en P0.5 | Pendiente |
| `controlled E2E: pending visit flows through close, alerts and visual completion` | E2E histórico | Requiere entorno aislado completo | Pendiente |
| `controlled E2E: manual voice activation greets before using persistent context` | Fuente frontend histórica | No se tocó | Pendiente |
| `fast read: all structured tiers declare that raw history was not used` | Memoria/telemetría | No se tocó | Pendiente |
| `fast read: raw WhatsApp fallback runs only after structured memory misses` | Memoria/WhatsApp | No se tocó | Pendiente |
| `Gemini Live: microphone capture block matches the turn-ownership version` | Voz/Gemini Live | Fuera de alcance | Pendiente |
| `greeting: startup phrase is short and contains no date, time or old task` | Fuente frontend histórica | No se tocó | Pendiente |
| `Caso A - registrar visita abre el formulario existente con cliente, fecha y hora` | Agenda UI | Debe migrarse a fuente canónica | Pendiente |
| `Caso B - construccion reutiliza solo Maps y telefono comprobados y pregunta datos faltantes` | Agenda/CRM | Requiere integración UI completa | Pendiente |
| `Caso H - cierre diario pregunta solo actividades vencidas o de hoy sin cerrar` | Agenda UI | Debe migrarse a fuente canónica | Pendiente |
| `Caso K - preflight Notion exige credenciales y solo marca exito con respuesta HTTP real` | Servicio remoto | Mocks insuficientes | NOT PROVEN |
| `mentor: uses a deterministic read-only briefing before advice` | Asistente histórico | No incluido en P0.5 | Pendiente |
| `proactive alerts: prioritizes balances and due unconfirmed work` | Lógica proactiva | No se modificó | Pendiente |
| `proactive alerts: location without linked agenda is a signal, not a completed visit` | Lógica proactiva | No se modificó | Pendiente |
| `proactive alerts: an availability conflict is a high-priority reprogramming prompt, never an automatic change` | Lógica proactiva | No se modificó | Pendiente |
| `proactive alerts: proactive scope emits at most one unseen alert per session` | Lógica proactiva | No se modificó | Pendiente |
| `processing status: manual update downloads the mirror and never starts AI analysis` | Fuente frontend histórica | Migrar a `frontend/` | Pendiente |
| `processing status: real background work remains visible as background` | Fuente frontend histórica | Migrar a `frontend/` | Pendiente |
| `two brains: Gemini Live startup never starts historical AI processing` | Voz/procesador | Fuera de alcance | Pendiente |
| `Vercel Hobby deployment stays within the 12 serverless function limit` | Infraestructura demostrada | 18 entrypoints vs límite histórico 12 | BLOCKED |
| `WhatsApp confirmations do not repeat a full client phone number` | Seguridad de salida WhatsApp | No se cambió envío | Pendiente |
| `Account recovery restores remote preferences before an empty install can synchronize` | Sincronización remota | Requiere mock/entorno aislado | NOT PROVEN |
| `P1: reprogramming and status changes target the existing canonical event` | Agenda/CRM | Fuera de P0.5 | Pendiente |
| `Forms: Yarbi opens the existing agenda form and does not claim Calendar confirmation early` | Agenda UI/Calendar | Fuera de P0.5 | Pendiente |
| `Manual Yarbi button downloads the local mirror and never starts AI processing` | Fuente frontend histórica | Migrar a `frontend/` | Pendiente |
| `Canonical analysis learns reply style but sending still requires explicit voice confirmation` | Procesamiento/WhatsApp | Fuera de P0.5 | Pendiente |

## Resultado P0.5

No se alteró ninguna expectativa de las 30 pruebas para forzar un PASS. Los nuevos cambios de P0.5 se validaron con 23/23 pruebas focalizadas PASS, incluidas las 3 pruebas de build protegido P0.2I. El fallo de Functions permanece real: no es una prueba obsoleta ni se corrigió artificialmente.

## Próximo tratamiento seguro

1. Migrar de forma aditiva las pruebas puramente UI a `frontend/` y sus dos artefactos generados.
2. Dar mocks locales explícitos a los contratos que hoy requieren servicios remotos.
3. Corregir código solo tras reproducir y aislar cada defecto real, empezando por la estrategia de Functions antes de intentar un deployment.
