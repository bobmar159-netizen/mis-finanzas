# Yarbi — Comparativa aislada de `responseJsonSchema`

## Resultado final

**`COMPARATIVA_SCHEMA_EJECUTADA`**

La única solicitud comparativa autorizada a Gemini fue aceptada con HTTP de proveedor `200` cuando la ruta experimental omitió únicamente `generationConfig.responseJsonSchema`.

Esto respalda que el rechazo anterior HTTP `400 / INVALID_ARGUMENT` está relacionado con el esquema de respuesta o con su interacción con la configuración actual. No demuestra aún qué restricción concreta del esquema causa el rechazo y no modifica el contrato semántico activo.

## Corrección mínima de autorización

La ruta temporal dejó de reutilizar `authenticatedPreviewOwner`, que corresponde exclusivamente a UI-01. Ahora reutiliza `authenticatedOwnerIdentity`, la validación canónica de identidad utilizada por referencias autenticadas, y compara en servidor el `id` validado contra `YARBI_PREVIEW_GEMINI_SCHEMA_EXPERIMENT_OWNER_ID`.

- La identidad autorizada vive sólo en una variable cifrada de **Preview**.
- El cuerpo sólo acepta `{ "fixture_id": "F3G-SERVICE" }`.
- No existe `owner_id` aceptado desde cliente.
- Un JWT ausente o inválido se rechaza; un propietario distinto recibe `403`.
- UI-01 y `YARBI_OWNER_ACCOUNT_ID` no fueron modificados.

## Pruebas previas al despliegue

| Criterio | Resultado |
| --- | --- |
| Usuario sintético autorizado | PASS |
| Sin autenticación / JWT inválido | PASS — denegado |
| Propietario distinto | PASS — denegado |
| `owner_id` arbitrario desde cliente | PASS — denegado |
| Solo diferencia del request Gemini | PASS — ausencia de `generationConfig.responseJsonSchema` |
| Modelo, endpoint, prompt, fixture, `temperature`, `contents` y `responseMimeType` | PASS — sin cambios |
| Llamadas externas en pruebas locales | PASS — cero |
| Acciones comerciales | PASS — cero |
| Suite local dirigida | PASS — 35 pruebas |

Una comprobación remota sin Bearer devolvió `401 gemini_schema_experiment_unauthorized` antes de Gemini.

## Deployment aislado

| Elemento | Evidencia |
| --- | --- |
| Deployment | `dpl_apYWruRx6nHkDUXCek8XySDUu5Go` |
| URL Preview | `https://misfinanzas-backend-qorqw64zv-omar-dfc4.vercel.app` |
| Entorno | Preview protegido por Vercel Authentication |
| Supabase autorizado | `uevilhbstnmmdlgyshlv` |
| Producción / alias | sin despliegue, promoción ni cambio |

## Única sonda real

| Señal sanitizada | Resultado |
| --- | --- |
| Fixture | `F3G-SERVICE` sintético |
| Solicitudes al endpoint | 1 |
| Reintentos automáticos | 0 |
| HTTP público | 200 |
| HTTP proveedor Gemini | 200 |
| Modelo | `gemini-3.5-flash-lite` |
| `responseJsonSchema` enviado | false |
| JSON de respuesta válido | true |
| Latencia Gemini | 1213 ms |
| Latencia total | 7153 ms |
| `execute` | false |
| Acciones comerciales | false |
| `operation_id` | no emitido por esta ruta diagnóstica temporal |

No se persistieron prompt, respuesta del proveedor, credenciales, texto del fixture ni datos personales. La evidencia conserva sólo campos sanitizados.

## Comparación con la sonda original

| Variante | Esquema de respuesta | Resultado Gemini |
| --- | --- | --- |
| Original | enviado | HTTP 400 `INVALID_ARGUMENT` |
| Comparativa | omitido | HTTP 200 |

El hash de línea base del esquema usado por ambas variantes fue `6c37a3d36bf8f43ab17f7a23ba9af79d78bd7e00805f8b278416104b97516e32`.

## Alcance y riesgos pendientes

- La causa exacta dentro del esquema continúa **NOT PROVEN**.
- La calidad semántica no fue evaluada ni queda cerrada.
- No se ejecutaron baterías semánticas, CRM, Agenda, WhatsApp, UI-01, voz, APK ni acciones comerciales.
- Producción no fue utilizada ni modificada.

## Próximo paso recomendado

Preparar una corrección independiente y mínima del esquema estructurado basada en un experimento local de reducción por partes; no desplegar ni volver a llamar Gemini hasta contar con autorización explícita.

## Retiro seguro de la ruta temporal

Cuando esta evidencia sea aceptada, retirar la ruta temporal de `vercel.json`, el handler `api/diagnostics/gemini-schema-isolation.js`, la política y la variable `YARBI_PREVIEW_GEMINI_SCHEMA_EXPERIMENT_OWNER_ID`; luego desplegar únicamente un Preview para confirmar que la ruta devuelve 404/403. No se retiró nada durante esta fase para conservar la evidencia y evitar cambiar el resultado ya probado.

## Integridad de evidencia

- `scripts/gemini-schema-isolation-comparative-evidence.json`: `DC984C2875349E0A396ADC65ED2CD12BC9264A0E09FC2946F966E9F1021E6623`
- `scripts/gemini-schema-isolation-comparative-attempt.json`: `43C42ACE1EFFD6E2E0C9DED258D3D3D8FDF2D2A19F447534359579E1E64C56C0`
- El manifiesto adjunto registra el hash de este informe y de los artefactos modificados.
