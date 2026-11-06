# YARBI — F04: Finanzas, cotizaciones, cobranzas y Notion

**Estado:** `F04_BASE_LOCAL_IMPLEMENTADA — INTEGRACIÓN REMOTA PENDIENTE`  
**Base:** F03 `a32aaca8c55283884a45481443ba61495614e222`

## Implementado localmente

- Nuevo contexto canónico `yarbi.finance-context.v1` para el expediente CRM.
- Las cotizaciones provenientes de evidencia estructurada se muestran con importe, versión, fecha, servicio y estado, pero **nunca** como ingreso cobrado.
- Las cuentas por cobrar usan `yarbi_receivables` como agregado canónico cuando está disponible. Un movimiento enlazado al mismo cobro no se suma una segunda vez.
- Estados normalizados de lectura: `pending`, `partial`, `paid`, `cancelled` y `not_applicable`; los anulados/no aplicables no generan saldo pendiente.
- El expediente muestra la última cotización, monto cobrado, por cobrar, vencidos y la fuente de cobro. La pantalla sigue siendo de solo lectura.
- Se añadió una previsualización pura de importación incremental Notion: exige mapeo explícito de identificador externo y `contact_id`, rechaza filas incompletas y deduplica por identidad externa. No llama a Notion ni escribe datos.

## Pruebas observadas

| Grupo | Resultado |
|---|---|
| Cotización no contabilizada como ingreso | PASS |
| Pago parcial + movimiento enlazado sin doble conteo | PASS |
| Cancelación/no aplica sin saldo inventado | PASS |
| Previsualización Notion con mapeo y deduplicación | PASS |
| Agenda + CRM + owner scope + expediente | PASS — 20/20 |
| Build web y Android unificados | PASS |
| Pruebas del build unificado | PASS — 4/4 |

## Límites explícitos

- No se verificó escritura remota, importación real de Notion ni espejo local/servidor: estas integraciones requieren configuración y autorización de Preview.
- No se inventaron tablas de movimientos ni stock: el contexto marca una fuente como `unavailable` si no está disponible.
- Dos pruebas históricas de cobranzas (`collections-balance` y `readback-integrity`) permanecen bloqueadas en el staging porque referencian la ruta reubicada `api/assistant/collections.js` y una migración que este workspace no contiene. No fueron modificadas ni se usaron para afirmar aprobación.
- No hubo despliegue, migración, APK, producción, Supabase remoto, Notion, Gemini, WhatsApp ni acciones comerciales.

## Próximo tramo de F04

Conectar la lectura a los contratos reales de Movimientos/stock existentes y preparar una importación Notion con preview, read-back y autorización explícita de Preview. No se debe habilitar una escritura ni una sincronización real sin esa autorización.
