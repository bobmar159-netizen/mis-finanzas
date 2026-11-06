# Yarbi — Experimento de aislamiento de `responseJsonSchema`

## Estado final

**`BLOQUEADO_ANTES_DE_GEMINI_POR_AUTORIZACION_DE_RUTA`**

La única petición despachada al endpoint experimental fue rechazada por el propio Preview con HTTP público `403`, antes de invocar Gemini. Por lo tanto, no existe un resultado comparativo del proveedor y la única llamada real a Gemini autorizada para el experimento **no ha sido consumida**.

No se ejecutará otra petición ni se corregirá la ruta sin una nueva autorización explícita.

## Prevalidación local

| Criterio | Resultado |
| --- | --- |
| Constructor normal conserva `responseJsonSchema` | PASS |
| Variante experimental lo omite | PASS |
| Diff estructural | PASS — solo `generationConfig.responseJsonSchema` |
| Modelo, endpoint, prompt, `contents`, `temperature: 0` y `responseMimeType` | PASS — idénticos |
| Fixture | PASS — `F3G-SERVICE` sintético y fijo del lado del servidor |
| Reintentos automáticos | PASS — cero |
| Entrada arbitraria del cliente | PASS — rechazada |
| Salidas de red en pruebas locales | PASS — cero |
| Pruebas locales | PASS — 26/26 |

La variante se implementó como ruta temporal protegida y no modifica el endpoint comercial de referencias. El payload del cliente solo puede contener `fixture_id: "F3G-SERVICE"`; el texto sintético vive fijo en el servidor y nunca pasa desde el cliente.

## Preview temporal

| Elemento | Valor |
| --- | --- |
| Deployment | `dpl_3DYubXPHpzYWhZDZm3hJsGfg9BjZ` |
| URL | `https://misfinanzas-backend-hbn29m0zt-omar-dfc4.vercel.app` |
| Entorno | Preview protegido por Vercel Authentication |
| Supabase autorizado | `uevilhbstnmmdlgyshlv` |
| Production | sin despliegue, sin alias ni cambios |

Una comprobación sin Bearer fue rechazada por aplicación con `401` antes de Gemini. Eso confirmó que la ruta no quedó pública y que su configuración Preview aislada era válida.

## Resultado de la petición despachada

| Señal | Resultado |
| --- | --- |
| Número de peticiones al endpoint experimental | 1 |
| HTTP público observado | `403` |
| Error sanitizado | `owner_ui_forbidden` |
| `execute` | `false` |
| `responseJsonSchema` enviado | `false` |
| HTTP proveedor Gemini | no existe |
| Categoría Gemini | no existe |
| Latencia Gemini | no existe |
| Acciones comerciales | ninguna |
| Datos sensibles persistidos | ninguno |

La evidencia de ejecución confirma que el fallo fue previo al proveedor: `provider_http_status`, `provider_diagnostic`, `provider_ms`, modelo y hash del esquema aparecen nulos porque la función no llegó a construir ni enviar la petición a Gemini.

## Causa demostrada

La ruta temporal llamó a `authenticatedPreviewOwner`, una función diseñada para UI-01. Esa función exige que el `id` del JWT sea exactamente igual a `YARBI_OWNER_ACCOUNT_ID`.

El usuario sintético `owner A` usado por el runner es válido para las referencias autenticadas, pero no coincide con el owner fijo utilizado por la UI. Por eso recibió `owner_ui_forbidden` antes de la llamada a Gemini.

Esto no es un rechazo de Gemini ni una evidencia sobre `responseJsonSchema`.

## Seguridad y aislamiento

- No se llamó a Gemini.
- No se llamó a WhatsApp, YCloud, Maps, Notion, Calendar, Agenda, CRM comercial ni voz.
- No se escribieron datos en Supabase.
- No se usaron clientes, teléfonos ni conversaciones reales.
- No se imprimieron claves, tokens, JWT, contraseñas, prompt ni respuesta de proveedor.
- Production permaneció intacta.

## Corrección mínima propuesta — no aplicada

Para que una futura autorización pueda usar el owner sintético correcto, la ruta temporal debe validar al dueño por el **scope canónico de referencias** o mediante un `owner_id` exclusivo de experimento que coincida con el usuario sintético, en lugar de reutilizar el owner fijo de UI-01.

Después de esa corrección, será necesario una nueva autorización explícita para crear un deployment Preview nuevo y despachar exactamente una llamada real a Gemini. La variante debe seguir omitiendo únicamente `generationConfig.responseJsonSchema`.

## Archivos creados o modificados localmente

- `PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-gemini-owner-understanding.js`
- `PREVIEW_REFERENCIAS_AISLADO/lib/preview-gemini-schema-experiment-policy.js`
- `PREVIEW_REFERENCIAS_AISLADO/api/diagnostics/gemini-schema-isolation.js`
- `PREVIEW_REFERENCIAS_AISLADO/vercel.json`
- `scripts/lib/preview-http-parser.cjs`
- `scripts/test-gemini-schema-isolation-local.cjs`
- `scripts/run-gemini-schema-isolation-experiment.cjs`
- `scripts/run-gemini-schema-isolation-experiment.ps1`

Los hashes verificables están en `YARBI_GEMINI_EXPERIMENTO_AISLAMIENTO_SCHEMA_SHA256SUMS.txt`.
