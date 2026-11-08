# YARBI F03 — Métricas locales

Las mediciones fueron de CPU local con datos sintéticos y proveedores mock.
No representan HTTP Preview, red Supabase, Gemini real ni Android.

| Nivel | Muestra | p50 total | p95 total | Gemini | Estado |
|---|---:|---:|---:|---:|---|
| FAST Agenda | 60 | 0.68 ms | 0.99 ms | 0 | MEDIDO local |
| STANDARD con provider sintético | 15 | 0.09 ms | 2.01 ms | 15 mock / p95 0.83 ms | MEDIDO CPU, no proveedor |
| DEEP sin cola durable | 15 | 0.01 ms | 0.27 ms | 0 | MEDIDO como rechazo seguro |

## Instrumentación disponible

- `intelligence_tier`: FAST, STANDARD o DEEP.
- `total_ms`, `gemini_ms`, contadores de llamadas Gemini y p50/p95 por tier.
- Contratos para `cache_ms`, `auth_ms`, `owner_scope_ms`, `supabase_ms`,
  `response_ms` y `presentation_ms` sin almacenar texto ni PII.
- `ttft_ms`, `ttfa_ms`, HTTP Preview y Android se marcan `not_measured` hasta
  una prueba real autorizada.

El objetivo FAST de menos de 200 ms se supera solamente en CPU local. No se
declara cumplido para Supabase remoto, Preview ni dispositivo.
