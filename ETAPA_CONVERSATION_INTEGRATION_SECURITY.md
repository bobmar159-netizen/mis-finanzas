# Integración del chat — Seguridad

- Los borradores Live continúan usando `textContent` y no se persisten por fragmento.
- El final normal se renderiza mediante el renderer canónico; el caso `<script>alert(1)</script>` se valida como parcial seguro.
- Los IDs Live se derivan de identificadores internos de sesión y turno, normalizados a caracteres seguros antes de formar el ID persistido.
- El callback repetido no vuelve a persistir ni renderizar el mismo final.
- Si falla el renderer, no se establece la marca de finalización y el borrador permanece visible; no se pierde la evidencia ni se declara éxito falso.
- No se tocó autenticación, CRM, Agenda, Finanzas, WhatsApp, VAD, AudioWorklet, micrófono, buffers de reproducción ni Gemini Live.

No se consultaron ni modificaron servicios remotos. Los resultados sólo demuestran mocks y builds locales; Barge-in físico en Android permanece pendiente.
