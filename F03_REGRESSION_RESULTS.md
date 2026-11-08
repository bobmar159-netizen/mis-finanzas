# YARBI F03 — Resultados de regresión local

| Grupo | Resultado | Evidencia |
|---|---:|---|
| Router FAST / STANDARD / DEEP | 7/7 PASS | `tests/f03-intelligence-router.test.js` |
| Conversación F05: continuidad, negación, FAST, provider failure y métricas | 5/5 PASS | `tests/f05-conversation-runtime.test.js` |
| Handler conversacional autenticado, scope y Agenda sin Gemini | 2/2 PASS | `tests/f05-conversation-handler.test.js` |
| Memoria e instrucciones F06 | 3/3 PASS | `tests/f06-owner-memory.test.js` |
| Política de voz F07 | 3/3 PASS | `tests/f07-app-voice-policy.test.js` |
| Identidad F02 | 5/5 PASS | `tests/f02-identity-security.test.js` |
| Aislamiento WhatsApp F02.1 | 8/8 PASS | `tests/f021-identity-whatsapp.test.js` |
| Total focalizado | **33/33 PASS** | Node test local |

También se verificó sintaxis de los dos módulos nuevos, runtime y handler.

## No ejecutado

- Gemini real, Gemini Live, Supabase remoto, Vercel, Meta Ads, WhatsApp,
  Notion, producción y APK: **NOT RUN**, por restricciones de F03.
- Trabajo DEEP real: **BLOCKED** por falta de infraestructura durable
  verificable; la prueba cubre su rechazo seguro y el contrato de enqueue.
