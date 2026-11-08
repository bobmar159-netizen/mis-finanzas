# YARBI F03 — Matriz de enrutamiento

| Entrada / condición | Nivel | Módulo | Proveedor | Resultado seguro |
|---|---|---|---|---|
| «¿Qué tengo mañana?» | FAST | `yarbi-agenda-intelligence` | No | Agenda verificable o ausencia de información. |
| «¿Cuánto hemos cobrado por instalaciones?» | FAST | `yarbi-finance-context` | No | Sólo cobros verificados; cotización no se trata como ingreso. |
| FAQ conocida | FAST | `yarbi-fast-local` | No | Respuesta determinista sin efectos. |
| «El segundo cliente» con continuidad firmada | FAST | `yarbi-conversation-runtime` | No | Referencia provisional, no apertura ni acción automática. |
| «¿Qué pasó con Carlos?» | STANDARD | Gemini V4 + hardeners existentes | Gemini cuando está configurado | Busca/aclara sólo tras validar owner scope. |
| FAST sin datos suficientes | STANDARD | mismo contexto y continuidad | Gemini si está configurado | No inventa hechos; puede pedir aclaración. |
| análisis de ventas/rentabilidad/campañas/ROAS | DEEP | `yarbi-deep-analysis` | No inicialmente | Encola sólo con store durable; hoy se bloquea seguro. |
| fallo Gemini | STANDARD | `yarbi-conversation-runtime` | No reintento nuevo en F03 | `provider_unavailable`, contexto conservado. |
| store DEEP ausente o fallo de enqueue | DEEP | `yarbi-deep-analysis` | No | `deep_infrastructure_unavailable` / `deep_enqueue_failed`. |

## Transferencias

- FAST → STANDARD: cuando no existe una lectura determinista segura.
- STANDARD → DEEP: contrato `transitionFor`, para solicitudes analíticas que
  una futura interpretación estructurada clasifique como profundas.
- Ninguna transferencia ejecuta acciones ni comparte contexto entre owners.
