# YARBI F03 — Cerebro inteligente FAST / STANDARD / DEEP

## Resultado

**F03 IMPLEMENTADA LOCALMENTE CON DEEP BLOQUEADO DE FORMA SEGURA.**

Se consolidó la selección de estrategia dentro del cerebro conversacional
existente, sin crear otro asistente:

- FAST: Agenda, Finanzas, FAQ y continuidad determinista sin Gemini.
- STANDARD: Gemini V4 y contexto existente para lenguaje natural, con
  abstención segura ante fallo de proveedor.
- DEEP: contrato idempotente para cola durable. No inicia análisis hasta que
  exista infraestructura persistente demostrable.

La respuesta autenticada publica el tier y una telemetría sanitizada. Sigue
siendo sólo de lectura: `execute:false` y efectos comerciales desactivados.

## Archivos creados

- `lib/yarbi-intelligence-router.js`
- `lib/yarbi-deep-analysis.js`
- `tests/f03-intelligence-router.test.js`
- Informes y manifiesto F03.

## Archivos modificados

- `lib/yarbi-conversation-runtime.js`
- `api_handlers/assistant/conversation.js`
- `tests/f05-conversation-handler.test.js`

## Pendientes y riesgos

1. DEEP requiere una tabla/RPC/worker durable autorizado; no se reutilizó
   `ai_message_analysis` por no demostrar que sirva para analítica general.
2. Las pistas CRM reutilizan fuentes existentes. Una tabla nueva de pistas
   exige evidencia de esquema y autorización de migración.
3. Rendimiento HTTP Preview, Gemini real, TTFT/TTFA y Android siguen sin medir.
4. El cache CRM existente es scoped e invalidable; para una invalidación total
   de nuevas fuentes deberá conectarse la futura cola durable a sus mutadores.

No se modificaron Production, Supabase remoto, migraciones, APK, Gemini Live,
proveedores comerciales ni el worktree auditado por Antigravity.
