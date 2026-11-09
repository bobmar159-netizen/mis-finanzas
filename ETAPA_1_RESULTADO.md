# Etapa 1 — Nueva experiencia conversacional y renderer

## Resultado local

Se implementó una capa declarativa de renderer para el chat existente, con
tipografía Inter y fallback local, cuerpo de 16 px, jerarquía H1/H2/H3,
interlineado aproximado 1.5, mensajes diferenciados, tablas desplazables en
pantallas pequeñas y soporte de ampliación por el navegador/sistema.

El cerebro F03, FAST/STANDARD/DEEP, Gemini, Gemini Live, autenticación,
continuidad, CRM, Agenda y Finanzas permanecen sin cambios. El texto plano
heredado continúa visible y las respuestas estructuradas se validan antes de
presentarse. No se añadieron acciones comerciales, streaming backend, BKE,
historial persistente, TTS, dependencias ni servicios externos.

## Checkpoint para Antigravity

- Commit fijo inicial: `5ccdbc1feecabdec2f1b1ff0be23f1a5871b2594`.
- Contiene contrato, renderer inicial, integración básica y pruebas de
  seguridad. La revisión independiente debe realizarse en solo lectura.

## Estado de validación

- Renderer y regresiones focalizadas: PASS.
- Build Web y Android-Web: PASS.
- Android físico (lectura, scroll, teclado, composer, micrófono y tabla):
  **NO VERIFICADO**; el build Android-Web no equivale a APK ni dispositivo.
- Suite completa histórica: no utilizable sobre la base F03 autorizada; ver
  `ETAPA_1_REGRESSION_RESULTS.md`.

No se desplegó, no se modificó Production ni se inició Etapa 2.
