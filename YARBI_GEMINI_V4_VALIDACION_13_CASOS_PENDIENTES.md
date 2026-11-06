# YARBI — validación Gemini V4: 13 casos pendientes

**Estado final:** `GEMINI_V4_PENDING_13_VALIDATION_BLOCKED`  
**Fecha:** 2026-11-05  
**Entorno:** Preview aislado `yarbi-audit-preview` (`uevilhbstnmmdlgyshlv`)  
**Producción:** intacta; no utilizada.

## Preflight obligatorio

El preflight se completó antes de llamar a Gemini y confirmó, mediante el
ledger aislado, que F3PC-01, F3PC-02 y F3PC-03 tenían cada uno una operación
cerrada con tres eventos inmutables: inicio, resultado y cierre. F3PC-04 a
F3PC-16 no tenían eventos previos.

Se comprobó la integridad del esquema compacto (`c72ccc5895d02dbbb56fa482cca4397f3d119b73f64a707fb45fea7cfcee87c6`, 2.068 bytes), fixtures, proveedor/prompt, hardener y adaptador antes de iniciar el lote. Las pruebas locales: 90/90 PASS.

## Solicitudes ejecutadas

El límite autorizado era 13; se realizaron **4** solicitudes, una vez cada
una, con un único Bearer, sin renovación ni reintentos. La cuarta se detuvo por
un error temporal 503 del proveedor, tal como exigía la política.

| Fixture | Familia | HTTP público | HTTP Gemini | Resultado semántico | Motivo |
| --- | --- | ---: | ---: | --- | --- |
| F3PC-04 | corrección | 200 | 200 | PASS | Pipeline completo; corrección aceptada. |
| F3PC-05 | temporal | 422 | 200 | FAIL no crítico | Aserción positiva temporal no cumplida; el pipeline se abstuvo. |
| F3PC-06 | temporal | 422 | 200 | FAIL no crítico | Aserción positiva temporal no cumplida; el pipeline se abstuvo. |
| F3PC-07 | temporal | 422 | 503 | BLOCKED | Gemini rechazó temporalmente; no hubo reintento. |

F3PC-08 a F3PC-16 no se ejecutaron. Quedan nueve llamadas de la autorización
original sin consumir.

## Seguridad e aislamiento

- `execute:false` en las cuatro solicitudes.
- Cero acciones comerciales, selección automática, CRM, Agenda, WhatsApp,
  Meta Ads, voz o APK.
- Cero clientes, teléfonos o conversaciones reales.
- F3PC-04 a F3PC-06 conservaron `no_forbidden_positive:true`,
  `negated_never_positive_constraint:true` y `may_auto_select_false:true`.
- F3PC-07 no llegó a producir salida semántica debido al HTTP 503; por tanto no
  hay una violación de polaridad observada, pero tampoco puede declararse
  validado.
- El único egress permitido observado fue Supabase aislado/ledger y Gemini.
- No se ejecutaron reintentos y no se modificó Production ni sus aliases.

## Rendimiento de las cuatro llamadas nuevas

La muestra es de cuatro solicitudes, insuficiente para generalizar a usuarios
reales; el P95 coincide con el máximo por tamaño muestral.

| Medida | Mínimo | Mediana | Máximo / P95 |
| --- | ---: | ---: | ---: |
| Gemini | 1.382 ms | 1.523 ms | 1.828 ms |
| Handler Preview | 3.020 ms | 3.159 ms | 3.355 ms |
| Runner protegido de Vercel | 8.120 ms | 8.267 ms | 8.352 ms |

El tiempo del runner incluye autenticación/protección y transporte Vercel; no
representa la latencia que experimentaría un usuario final.

## Resultado acumulado correcto

Hay siete fixtures con llamadas Gemini reales: F3PC-01 a F3PC-07. Cuatro
fueron semánticamente correctos (01, 02, 03 y 04), dos fallaron aserciones no
críticas (05 y 06) y uno se interrumpió por 503 (07).

El JSON del runner mostró `1/7` por una limitación de agregación: la evidencia
histórica de F3PC-01 a F3PC-03 usa el campo sanitizado `semantic_pass`, mientras
el agregador nuevo esperaba la forma de respuesta en vivo `semantic.pass`.
La evidencia histórica original demuestra que 01, 02 y 03 fueron PASS. Por ello
la lectura correcta es **4/7 semánticos observados**, y **4/6 no ambiguos
observados**. El objetivo de 90% sobre los 13 no ambiguos no puede evaluarse ni
cumplirse mientras el lote esté interrumpido.

Esta corrección es de reporte; no se modificó ni se reintentó ninguna llamada.

## Hashes SHA-256

| Artefacto | SHA-256 |
| --- | --- |
| Evidencia sanitizada | `734E53C53BC27930D7ED665E4C6A8CFF8E972AEBC418462942D0F8277B24579D` |
| Marca de intento | `8300D0BD645CED5B0AD32C314671262A781BC1FAF4D8C5E93A623D13B5BB7773` |
| Handler Preview V4 | `89748253616EFBD5EA2E3843052DF9A0481F7BF8B0FEFD772C2D559A862D1322` |
| Runner de 13 pendientes | `EFD2DAD7C59D8B745F268C694242E791C571D8FC65754D98ADEAE8E3093CAE39` |
| Wrapper PowerShell | `1780FA4A93F961463ED7B21A15FB62DABE2A959E4F529E90FE0FF1040FF3BC05` |
| Prueba local del preflight | `0684F2DC6F4A376B1D97A526DAEBCF442606CAB3EAE1C722079C844AAB593E8F` |

## Conclusión

La validación queda bloqueada por disponibilidad de Gemini (HTTP 503) y por
resultados semánticos insuficientes en los dos casos temporales ejecutados. No
se deben consumir los nueve fixtures restantes sin una nueva autorización que
defina cómo tratar el 503 y que revise los fallos temporales. No se recomienda
integrar V4 al endpoint comercial en este estado.

