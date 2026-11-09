# Yarbi — Estado Actual de Conversación

## Hallazgos locales

| Área | Evidencia local | Clasificación | Implicación |
|---|---|---|---|
| Router | `api/assistant-router.js` enruta 17 handlers revisados | IMPLEMENTADO Y VERIFICADO en pruebas locales previas | Reutilizar, no crear otro gateway. |
| Conversación autenticada | `api_handlers/assistant/conversation.js` | IMPLEMENTADO SOLO EN CÓDIGO | Usa owner scope, continuidad firmada y trazas; Preview-only. |
| FAST/STANDARD/DEEP | `lib/yarbi-intelligence-router.js` | IMPLEMENTADO Y VERIFICADO localmente | FAST/ STANDARD disponibles; DEEP sigue condicionado a cola durable. |
| CRM y Agenda | handlers y runtimes F03/F04 | IMPLEMENTADO Y VERIFICADO localmente | Deben entregarse como hechos/fuentes tipadas. |
| Finanzas | `lib/yarbi-finance-context.js` | IMPLEMENTADO SOLO EN CÓDIGO | Faltan contratos visuales de tabla/fuente. |
| Historial | migración `YARBI_CHAT_HISTORY_MIGRATION_20261008.sql`, `preferences.js` | PARCIAL | Texto plano por `owner_key`; sin conversación, título o blocks. |
| Continuidad | `lib/yarbi-conversation-continuity.js` | IMPLEMENTADO SOLO EN CÓDIGO | Token corto, no persistencia de historial. |
| Renderer de chat | `frontend/index.html`, `frontend/yarbi-assistant.js` | PARCIAL | Overlay/copilot actual; no renderer tipado común. |
| Voz | `frontend/yarbi-app-voice.js` | IMPLEMENTADO Y VERIFICADO localmente | Dictado y revisión; falta TTS canónico y Android físico. |
| Gemini Live | módulos y pruebas existentes | NO VERIFICABLE en esta Etapa 0 | No se modificó ni se invocó. |
| Streaming | No se halló SSE/contrato de eventos en ruta conversacional | NO IMPLEMENTADO | Especificado para etapa posterior. |
| Persistencia offline | Uso amplio de `localStorage`, IndexedDB puntual | PARCIAL | No existe store conversacional por owner/versionado. |
| Cifrado local | `package.json` revisado: Capacitor 5 y reconocimiento de voz; no se halló SQLite/SQLCipher ni configuración Capacitor en esta inspección | NO DECIDIDO | Falta inspeccionar el árbol Android y plugins antes de elegir IndexedDB, SQLite cifrado y protección de claves. |
| Fuentes PDF / BKE | No se halló contrato de ingesta común | NO IMPLEMENTADO | Requiere fase específica. |
| Restauración de pestaña | Estado local parcial | NO IMPLEMENTADO | Pospuesto por requisito. |
| JPG/share | No se halló generador de respuesta conversacional | NO IMPLEMENTADO | Requiere fase específica. |

## Riesgos de regresión

1. El frontend legacy contiene múltiples almacenes `localStorage`; no debe
   mezclarse con la nueva conversación sin prefijo, owner y versión.
2. Existen referencias históricas a claves en almacenamiento local. El contrato
   nuevo no debe perpetuar ni leer secretos desde el navegador.
3. Las rutas de Preview no prueban automáticamente Production ni Android.
4. La tabla histórica usa `owner_key` hash; cualquier transición necesita una
   estrategia explícita, no una conversión silenciosa a `owner_account_id`.

## No inspeccionado por esta etapa

No se consultó Supabase, Vercel, Gemini, WhatsApp, CRM real, Agenda real,
Finanzas reales ni Android físico. Ningún objeto remoto se declara existente
por esta revisión local.

## Límites para afirmar capacidades futuras

No se han medido aún RAM, CPU, batería, temperatura, almacenamiento temporal,
interrupciones ni reanudación en Android físico. Tampoco se han comprobado
modalidades, formatos, duración, cuota, coste o restricciones del proveedor
Gemini para BKE. Ambos grupos son prerrequisitos de sus capacidades respectivas,
no evidencia de que estén implementadas hoy.
