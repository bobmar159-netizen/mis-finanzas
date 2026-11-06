# Yarbi — Sonda real única: diagnóstico Gemini HTTP 400

## Resultado

**Diagnóstico demostrado: `NOT PROVEN`.**

La única sonda autorizada alcanzó Gemini desde el Preview aislado y Gemini devolvió `400 INVALID_ARGUMENT`. La instrumentación conservó solamente información técnica sanitizada y clasificó el rechazo como `PROVIDER_INVALID_ARGUMENT_UNKNOWN`.

No se ejecutó una segunda sonda, ningún reintento automático, despliegue, acción comercial ni cambio de configuración.

## Entorno comprobado

| Elemento | Evidencia | Resultado |
| --- | --- | --- |
| Deployment | `dpl_ZQ8HWhm1qcr7H7itfPox9ZVCYAz5` | PASS |
| URL Preview | `misfinanzas-backend-gfioh0970-omar-dfc4.vercel.app` | PASS |
| Estado del deployment | `READY`, sin alias | PASS |
| Supabase | `uevilhbstnmmdlgyshlv` | PASS |
| Alias de Production | continúa en `dpl_3KHdcxT1Hvi7ZufphvQeNKSA4DtJ` | PASS |
| Fixture | `F3G-SERVICE`, sintético | PASS |
| Solicitudes a Gemini | una | PASS |
| Reintentos automáticos | cero | PASS |
| `execute` | `false` | PASS |

La ruta estática aplicable al payload es `NEEDS_LANGUAGE_MODEL`: el payload contiene `utterance` y no contiene `understanding`, por lo que no puede tomar `FAST_LOCAL`.

## Resultado real de la sonda

| Señal | Valor |
| --- | --- |
| Resultado del runner | `REQUEST_COMPLETED` |
| Código público recibido por el runner | `NOT PROVEN` (el parser del runner registró `0`) |
| Código estable público | `understanding_unavailable` |
| Código sanitizado | `owner_understanding_provider_rejected_400` |
| HTTP de Gemini en ledger | `400` |
| Estado del proveedor | `INVALID_ARGUMENT` |
| Categoría | `PROVIDER_INVALID_ARGUMENT_UNKNOWN` |
| Modelo | `gemini-3.5-flash-lite` |
| Hash del esquema | `6c37a3d36bf8f43ab17f7a23ba9af79d78bd7e00805f8b278416104b97516e32` |
| `gemini_ms` | no disponible para un rechazo HTTP 400 |
| Latencia servidor | no disponible en el cuerpo de error sanitizado |
| Ida y vuelta medida por el runner | `29,399 ms` |

El handler fuente corresponde al camino que responde públicamente con HTTP `503` cuando el proveedor falla; sin embargo, **no se declara como hecho observado**, porque el marcador HTTP del runner no fue interpretado correctamente. La respuesta JSON y el ledger sí prueban el rechazo del proveedor y que no fue un fallo de autenticación ni de transporte.

## Trazabilidad

La operación recuperada fue `op1-owner_reference-8716991a3b63e450229cb497fd71225f` y contiene exactamente tres eventos:

1. `reference_lookup_started`.
2. `understanding_unavailable`, con el diagnóstico Gemini sanitizado.
3. `operation_closed`.

El cierre quedó persistido. El resultado global del ledger se reconstruye como cerrado; esto no significa éxito semántico: el estado de negocio de esta operación fue indisponibilidad de comprensión y permanece visible en el evento intermedio.

## Señales sanitizadas

| Señal | Valor |
| --- | --- |
| `invalid_argument` | `true` |
| `mentions_schema` | `false` |
| `mentions_complexity` | `false` |
| `mentions_model` | `false` |
| `mentions_generation_config` | `false` |
| `mentions_unknown_field` | `false` |

No existe evidencia sanitizada que señale una propiedad concreta del esquema, modelo, `generationConfig` o campo de solicitud. Por ello no es seguro reducir ni modificar el contrato actual.

## Límites y seguridad

- No se conservaron prompt, utterance, respuesta de Gemini, JWT, claves ni contenido de clientes.
- La ejecución terminó antes de recuperar candidatos y antes de cualquier ejecución comercial. No hubo envío de WhatsApp, Agenda, Calendar, Maps, Notion ni acciones de CRM.
- Production no fue utilizada por la sonda y no fue modificada. La única inspección de Production fue metadato de Vercel de solo lectura para comprobar el alias existente.
- La evidencia de red completa por host no está disponible en el ledger; se marca `NOT PROVEN`. La traza sí demuestra una llamada a Gemini y almacenamiento únicamente en el Supabase aislado.
- El caso sin `msg.id` estable no fue tocado.

## Defecto del runner observado

El ejecutor de esta sonda tenía dos defectos de telemetría que no afectan la llamada ya realizada:

1. Esperaba 64 caracteres en `operation_id`; el contrato real usa 32. Por eso el identificador no quedó en su archivo de evidencia, aunque fue recuperable en el ledger por la ventana exacta de despacho.
2. El marcador de estado usado con `vercel curl` no devolvió el HTTP público al runner. Por ello `public_http_status` quedó en `0`.

No se corrigen ni se vuelve a ejecutar durante esta autorización: hacerlo requeriría una nueva sonda.

## Siguiente corrección recomendada

Una fase posterior, con autorización explícita, debe realizar un experimento comparativo mínimo y con una sola variable por vez para aislar el `INVALID_ARGUMENT`: primero una petición Gemini con el mismo modelo y `responseMimeType` pero sin `responseJsonSchema`, y solo después —si corresponde— una variante mínima del esquema. No se debe aplicar ninguna reducción a producción ni al Preview actual sin esa evidencia.

## Integridad de artefactos

Los SHA-256 se generan en `YARBI_GEMINI_SONDA_REAL_DIAGNOSTICO_400_SHA256SUMS.txt` después de fijar estos archivos. La evidencia original no se ha modificado.
