# UI-01 — validación del Preview aislado

## Resultado

`PREVIEW_UI01_VALIDADA_SIN_OBSERVACIONES`

Deployment Preview final: `dpl_3Vf3Wmz62fNgbJfmPAj1hCkmo948`.

No se creó alias, no se usó Production, ni se modificaron CRM productivo, WhatsApp, Gemini, Vercel Production o la APK.

## Evidencia real

| Criterio | Resultado | Evidencia |
| --- | --- | --- |
| El Preview usa el proyecto aislado | PASS | La configuración de runtime confirmó `uevilhbstnmmdlgyshlv`; la guardia rechaza la referencia productiva. |
| Inicio de sesión del dueño aislado | PASS | El usuario aislado accedió a la pantalla `Para ti`. |
| Lectura de bandeja | PASS | La UI mostró una recomendación sintética y el resumen de la meta. |
| Posponer | PASS | La recomendación pasó visualmente de `Atención ahora` a `Para después` tras posponer una hora. |
| Texto de recomendación entendible | PASS | En la recarga visual se mostraron frases naturales: “Pide la ubicación para poder coordinar el siguiente paso.” y “Pide un detalle breve del servicio que necesita.” No se mostró el código interno. |
| Autorizar mediante la UI | PASS | Se pulsó manualmente `Autorizar` sobre `UI01-FINAL-AUTH-1793500635769-06f7fa`. La verificación aislada confirmó estado `authorized`, una decisión y una única orden interna `authorized_pending_execution`. |
| Idempotencia observada tras recarga | PASS | Tras refrescar, la tarjeta autorizada dejó de ser accionable. La evidencia conserva exactamente una decisión y una orden. La UI no expone un segundo clic terminal; por ello no se intentó forzar otra mutación. |
| Descartar mediante la UI | PASS | Se pulsó manualmente `Descartar` sobre `UI01-FINAL-DISMISS-1793500635769-06f7fa`. La verificación aislada confirmó estado `dismissed`, una decisión y cero órdenes. La tarjeta no volvió a aparecer como pendiente tras refrescar. |
| Egress comercial | PASS | El paquete de Preview solo permite Supabase aislado; no incluye Gemini, WhatsApp/YCloud, Maps, Notion, Calendar ni cron. |

## Correcciones realizadas durante la validación

- Se añadió flujo de recuperación de contraseña exclusivo del Preview aislado.
- Se sustituyó el UID del usuario aislado en la variable de Preview, sin cambiar Production.
- Se corrigió el uso de `sb_secret_`: la clave se envía únicamente como `apikey`, no como JWT en `Authorization`.
- Se añadieron códigos de diagnóstico sanitizados para fallos de bandeja.
- Se impidió que códigos internos de recomendación lleguen visibles a la UI.

## Pruebas locales finales

`node tests/run-local.cjs` aprobó 10 controles: aislamiento, configuración pública, autenticación, lectura, clasificación segura de fallos, tres decisiones por RPC, bloqueo de no-propietario, dos Functions y ausencia de secretos/referencia productiva en archivos públicos.

## Cierre manual final

Se prepararon dos fixtures independientes, sin nombres, teléfonos ni datos comerciales reales:

- `UI01-FINAL-AUTH-1793500635769-06f7fa` — autorización manual.
- `UI01-FINAL-DISMISS-1793500635769-06f7fa` — descarte manual.

La evidencia sanitizada `ui01-final-verification-evidence.json` confirma lo siguiente:

- autorización: `authorized`, una decisión, una orden interna `authorized_pending_execution`;
- descarte: `dismissed`, una decisión, cero órdenes;
- host permitido: solo `uevilhbstnmmdlgyshlv.supabase.co`;
- egress externo: `false`;
- secretos y PII en evidencia: `false`.

Una orden `authorized_pending_execution` es deliberadamente interna; esta UI no tiene ejecutor comercial y no envía WhatsApp ni activa Agenda, CRM, Calendar, Maps, Notion o Gemini.

## Producción y despliegue

El Preview validado es `dpl_3Vf3Wmz62fNgbJfmPAj1hCkmo948`. Durante el cierre se utilizó exclusivamente el proyecto aislado `uevilhbstnmmdlgyshlv`. No se cambió alias de Production, no se desplegó Production y no se consultaron ni modificaron datos de `MisFinanzasPro`, CRM real, Agenda, WhatsApp, Gemini ni APK.

## Archivos relevantes

- `index.html`, `app.js`, `styles.css`
- `api/assistant/owner-inbox.js`, `api/assistant/owner-action.js`
- `lib/preview-owner-ui-policy.js`, `lib/yarbi-owner-ui-auth.js`, `lib/yarbi-owner-inbox.js`, `lib/yarbi-owner-action.js`
- `tests/run-local.cjs`

