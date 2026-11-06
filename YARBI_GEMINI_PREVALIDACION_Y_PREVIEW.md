# YARBI — Prevalidación y despliegue seguro de instrumentación Gemini

## Resultado

`PREVIEW_INSTRUMENTADO_LISTO_PARA_SONDA`

La instrumentación sanitizada del HTTP 400 fue desplegada únicamente en Preview. No se ejecutó ninguna llamada real a Gemini, no se invocó el endpoint desplegado y Producción permaneció intacta.

## 1. Comparación de los 35 fallos

Se recuperó una línea base verificable desde el código fuente del Preview READY anterior:

- Deployment base: `dpl_9tAQtQEtNbyz36mEYqLH5gprg3bR`.
- URL base: `misfinanzas-backend-9s6vmn1rk-omar-dfc4.vercel.app`.
- `yarbi-trace.js` base: SHA-256 `e6e42bdc9d829c8c2cea90843e05cc15f643aae6719514b3f14113381bbbf0db`, idéntico al manifiesto histórico.
- Para `yarbi-gemini-owner-understanding.js` y la ruta raíz de referencias se retiraron en memoria únicamente los cambios de instrumentación documentados; sus hashes reconstruidos coincidieron con los manifiestos previos.

El Preview anterior aún no contenía `yarbi-gemini-request-forensics.js`, por lo que no existe una copia remota byte a byte de ese archivo. Esta limitación no afecta la comparación de los 35 fallos: esos 16 archivos de prueba no cargan directamente el módulo forense, y su comportamiento nuevo quedó cubierto por la batería dirigida de 34 pruebas.

Los mismos 16 archivos de prueba se ejecutaron dos veces: versión actual y línea base sustituida en memoria. Resultado:

| Archivo o grupo | Fallos actuales | Fallos base | Diferencia |
| --- | ---: | ---: | ---: |
| Barge-in | 1 | 1 | 0 |
| Foco de comando | 1 | 1 | 0 |
| Cierre diario | 2 | 2 | 0 |
| Integridad de datos | 1 | 1 | 0 |
| E2E controlado | 2 | 2 | 0 |
| Lectura rápida | 2 | 2 | 0 |
| Gemini Live | 1 | 1 | 0 |
| Saludo inicial | 1 | 1 | 0 |
| Simulaciones obligatorias | 4 | 4 | 0 |
| Mentor | 1 | 1 | 0 |
| Fases 2D.2/2D.6 | 5 | 5 | 0 |
| Alertas proactivas | 4 | 4 | 0 |
| Estado de procesamiento | 2 | 2 | 0 |
| Arquitectura de dos cerebros | 1 | 1 | 0 |
| Límite Vercel Hobby | 1 | 1 | 0 |
| Regresiones Yarbi | 6 | 6 | 0 |
| **Total** | **35** | **35** | **0** |

Los 35 nombres de fallo fueron idénticos. No apareció ningún fallo nuevo relacionado con `yarbi-trace.js`, `reference-candidates.js` o la instrumentación Gemini. Los fallos son preexistentes respecto de este cambio.

Evidencia:

- TAP actual: SHA-256 `fe2b193d92aaf8dbae0ff78a643cb91513eb8a1fe71aa325b0d5b51f91fa45a2`.
- TAP base: SHA-256 `bde66fdfdbe9fadcf24df78e97cdba6efe57005a372055d7c56e3e92d8684206`.

## 2. Instrumentación verificada

La batería dirigida terminó `34/34 PASS`:

- clasificación sanitizada de HTTP 400;
- un 400 sin evidencia suficiente conserva `PROVIDER_INVALID_ARGUMENT_UNKNOWN`;
- no se persisten mensajes originales del proveedor;
- no se exponen prompts, respuestas, credenciales ni datos personales;
- el contrato público permanece igual;
- el ledger solo admite categorías, modelo y hash permitidos;
- backend y paquete Preview mantienen paridad de esquema, modelo y diagnóstico;
- prompt, modelo, `responseJsonSchema`, hardening y reglas semánticas no fueron modificados.

Las pruebas usaron mocks locales. Llamadas reales a Gemini: **0**.

## 3. Despliegue Preview

- Proyecto: `misfinanzas-backend` (`prj_LzmQFg4ybpNyzeIBjcYZjP1ZGdJq`).
- Equipo: `omar-dfc4`.
- Deployment: `dpl_ZQ8HWhm1qcr7H7itfPox9ZVCYAz5`.
- URL: `https://misfinanzas-backend-gfioh0970-omar-dfc4.vercel.app`.
- Estado: `READY`.
- Target: Preview (`target=null` en la API de Vercel; no fue promovido).
- `productionUrl`: `null`.
- Alias asignados al deployment: ninguno.
- Functions publicadas: 1, `api/assistant/reference-candidates`.
- Protección: Vercel Authentication.

Los SHA-1 publicados por Vercel coinciden exactamente con los archivos locales del paquete para:

- `api/assistant/reference-candidates.js`;
- `lib/yarbi-gemini-owner-understanding.js`;
- `lib/yarbi-gemini-request-forensics.js`;
- `lib/yarbi-trace.js`.

No se invocó la Function después del despliegue; por tanto, no hubo llamada real a Gemini.

## 4. Aislamiento y Producción

- El paquete exige `YARBI_PREVIEW_SUPABASE_PROJECT_REF=uevilhbstnmmdlgyshlv`.
- La guardia permite únicamente `https://uevilhbstnmmdlgyshlv.supabase.co` y rechaza expresamente `haifktjvyhbsazmiyqps`.
- Las variables requeridas existen con target exclusivo `preview`; no se descifraron ni imprimieron sus valores.
- No se usó `--prod`.
- El alias `misfinanzas-backend.vercel.app` apuntaba antes y después a `dpl_3KHdcxT1Hvi7ZufphvQeNKSA4DtJ`.
- No se modificaron Production, Supabase, CRM, Agenda, WhatsApp, Meta Ads, voz ni APK.

## 5. Estado pendiente

La causa exacta del HTTP 400 continúa `NOT PROVEN`. Este deployment solo mejora la evidencia segura. La siguiente sonda real contra Gemini requiere autorización explícita y debe ejecutarse una sola vez con datos sintéticos.

No se declara Gemini corregido ni comprensión cerrada.
