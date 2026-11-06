# Yarbi — primera sonda real Gemini con contrato compacto V4

## Resultado

**GEMINI_V4_PRIMERA_SONDA_EXITOSA**

Se ejecutó una única solicitud real, sintética y aislada desde el Preview
`dpl_HicTemA7jmtFUvNxM8iwLLMjwLWq`. Gemini aceptó el contrato completo
`yarbi.owner-understanding.v4` y la salida recorrió correctamente:

`v4 → normalización estricta → hardener v4 → adaptador v4/v1 → normalización v1 → hardening v3`.

No se ejecutó ninguna acción comercial.

## Entorno y control de ejecución

| Control | Resultado |
| --- | --- |
| Deployment | Preview aislado `misfinanzas-backend-j1u30ej9t-omar-dfc4.vercel.app` |
| Supabase | Solo `yarbi-audit-preview` (`uevilhbstnmmdlgyshlv`) |
| Fixture | `F3V4-CORRECTION`, sin datos de clientes |
| Solicitudes Gemini | 1 |
| Reintentos automáticos | 0 |
| `execute` | `false` |
| Acciones comerciales | 0 |
| Producción | No utilizada |
| Persistencia de credenciales, frase o respuesta cruda | No |

La operación quedó trazada y cerrada correctamente. Su identificador se
mantiene solo como referencia técnica sanitizada en la evidencia local.

## Resultado del proveedor

| Medida | Valor |
| --- | --- |
| HTTP público | 200 |
| HTTP Gemini | 200 |
| Modelo | `gemini-3.5-flash-lite` |
| Esquema v4 | 2,068 bytes |
| SHA-256 del esquema | `c72ccc5895d02dbbb56fa482cca4397f3d119b73f64a707fb45fea7cfcee87c6` |
| Latencia Gemini | 1,533 ms |
| Latencia del handler | 2,998 ms |
| Tiempo total observado por runner | 9,174 ms |

No hubo diagnóstico de error del proveedor.

## Comprobaciones del recorrido local

Todas pasaron:

- JSON v4 válido mediante `strictNormalizeProposed`.
- Hardener v4 completado (2 ms).
- Adaptación v4 → v1 completada (1 ms).
- Normalización v1 completada.
- Hardening v3 completado (2 ms).
- La mención descartada no llegó como restricción positiva.
- La mención de reemplazo se preservó como restricción positiva.
- La corrección se interpretó como reemplazo de contexto previo.
- `may_auto_select` permaneció en `false`.
- No se generaron exclusiones SQL.
- La procedencia de las menciones se verificó contra frase/estado sintético.

## Egress y trazabilidad

Los únicos destinos permitidos y observados por el contrato fueron:

- Autenticación y ledger del Supabase aislado.
- `generateContent` de Gemini.

No intervino CRM, Agenda, WhatsApp, Maps, Notion, Calendar, Meta Ads, voz ni APK.

## Artefactos y hashes SHA-256

| Artefacto | SHA-256 |
| --- | --- |
| `scripts/gemini-v4-first-probe-evidence.json` | `53455299748e254f0c99bcdaa23070974613b38fd0b56e9ad51575c10100ab1b` |
| `PREVIEW_REFERENCIAS_AISLADO/api/diagnostics/gemini-v4-first-probe.js` | `9e29e046a72b9a458e86756c99765be6e1ea4ad55d9b6097e0081a940c606d2c` |
| `PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-gemini-v4-probe.js` | `ff36a83765c071c20b868b22e011b4d4319d5b4697dcea08b533fd6265fb34a0` |
| `PREVIEW_REFERENCIAS_AISLADO/lib/preview-gemini-v4-probe-policy.js` | `dbff56719a63aa0b6b406de9434f01921c3d2788b69c8b5cc5c233d5978a643f` |
| `PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-understanding-polarity-proposal.js` | `b044533e6d5c097c7b94adec338eb9d452d3644912bc9d4ecaba2d0e6c672155` |
| `PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-v4-v1-adapter-proposal.js` | `b7fcf691b5e417b611b046ce4cecb8610e40133cf020be5a126fb57b86ba4615` |

## Límites que permanecen

Esta sonda demuestra que Gemini acepta el esquema compacto v4 y que el
recorrido técnico funciona para una corrección sintética. No valida todavía
la batería semántica completa ni autoriza conectar el adaptador experimental
al endpoint comercial.

El siguiente paso seguro sería una batería semántica v4 acotada en Preview,
si se autoriza expresamente, antes de cualquier integración de producto.
