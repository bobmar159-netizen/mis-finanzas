# YARBI — Instrumentación segura del error HTTP 400 de Gemini

Fecha: 2026-11-02  
Estado: `INSTRUMENTACION_LOCAL_PREPARADA_PENDIENTE_DE_PREVIEW_Y_SONDA`

## Resultado

Se integró localmente el clasificador forense existente en la ruta real de comprensión de Yarbi. Un rechazo de Gemini conserva ahora únicamente un diagnóstico técnico sanitizado en el ledger. No se cambió la comprensión semántica, no se llamó a Gemini y no se desplegó ningún entorno.

La causa real del HTTP 400 continúa `NOT PROVEN`. Esta entrega mejora la evidencia disponible; no corrige ni declara corregido a Gemini.

## Cambios de runtime

### Antes

- El proveedor generaba el código estable `owner_understanding_provider_rejected`.
- El mensaje original del proveedor quedaba temporalmente en `error.detail`.
- La API pública ocultaba el detalle, pero la traza solo conservaba el error genérico.
- No quedaban categoría técnica, hash del esquema ni modelo para investigar el 400.

### Después

- `error.detail` fue eliminado de esta ruta.
- El cuerpo del error se usa únicamente en memoria para clasificarlo.
- El error interno incorpora `provider_diagnostic` inmutable.
- La traza persiste exclusivamente campos permitidos y vuelve a sanitizarlos antes de escribir.
- La respuesta pública mantiene el mismo contrato seguro: no expone categoría, modelo, hash ni texto del proveedor.

Contrato persistido:

```json
{
  "provider": "gemini",
  "http_status": 400,
  "provider_status": "INVALID_ARGUMENT",
  "category": "SCHEMA_UNSUPPORTED",
  "signals": {
    "invalid_argument": true,
    "mentions_schema": true,
    "mentions_complexity": true,
    "mentions_model": false,
    "mentions_generation_config": false,
    "mentions_unknown_field": false
  },
  "schema_sha256": "<64 caracteres hexadecimales>",
  "model": "gemini-3.5-flash-lite"
}
```

No se persisten `message`, `description`, `fieldViolations`, prompt, respuesta, cabeceras, API key ni payload completo.

## Clasificación implementada

| Categoría | Evidencia sanitizada utilizada |
|---|---|
| `SCHEMA_UNSUPPORTED` | Complejidad, keyword o característica de esquema no admitida; incluye “too many states for serving”. |
| `SCHEMA_INVALID` | Esquema inválido, mal formado o con restricciones incompatibles. |
| `MODEL_CONFIGURATION_INVALID` | Modelo inválido o sin soporte para la configuración solicitada. |
| `GENERATION_CONFIG_INVALID` | Parámetro de generación, temperatura o MIME no admitido. |
| `REQUEST_FIELD_UNSUPPORTED` | Campo desconocido o no admitido. |
| `SDK_SERIALIZATION_ERROR` | Fallo local de serialización, circularidad o conversión JSON. |
| `PROVIDER_INVALID_ARGUMENT_UNKNOWN` | Gemini no entregó evidencia suficiente o no coincide con una regla segura. |

El clasificador inspecciona `error.code`, `error.status`, `error.message` y, si existen, `error.details[].fieldViolations`. Esos textos solo participan en la clasificación en memoria y se descartan.

## Comprensión intacta

No se modificaron:

- prompt semántico;
- `entity_mentions` ni tipos de entidad;
- `constraints`;
- reglas de hardening;
- resolvedor ni ranking;
- modelo `gemini-3.5-flash-lite`;
- `responseJsonSchema`;
- `temperature: 0`;
- `responseMimeType: application/json`.

El esquema continúa midiendo 5.513 bytes, tiene 76 propiedades y conserva SHA-256:

`6c37a3d36bf8f43ab17f7a23ba9af79d78bd7e00805f8b278416104b97516e32`

## Archivos modificados o creados

Runtime local:

- `lib/yarbi-gemini-request-forensics.js`
- `lib/yarbi-gemini-owner-understanding.js`
- `lib/yarbi-trace.js`
- `api/assistant/reference-candidates.js`

Candidato de Preview aislado:

- `PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-gemini-request-forensics.js`
- `PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-gemini-owner-understanding.js`
- `PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-trace.js`
- `PREVIEW_REFERENCIAS_AISLADO/api/assistant/reference-candidates.js`

Pruebas y evidencia:

- `tests/yarbi-gemini-owner-understanding.test.js`
- `tests/owner-gemini-reference-route.test.js`
- `tests/phase1-manifest-trace.test.js`
- `tests/preview-gemini-diagnostic-parity.test.js`
- `scripts/gemini-400-diagnostic-instrumentation.cjs`
- `scripts/gemini-400-diagnostic-instrumentation-evidence.json`

## Pruebas locales

Comando dirigido:

```powershell
node --test tests/yarbi-gemini-request-forensics.test.js tests/yarbi-gemini-owner-understanding.test.js tests/owner-gemini-reference-route.test.js tests/phase1-manifest-trace.test.js tests/preview-gemini-diagnostic-parity.test.js
```

Resultado: **34/34 PASS**.

Casos cubiertos:

- esquema excesivamente complejo;
- esquema inválido;
- parámetro no admitido;
- modelo incompatible;
- error genérico;
- ausencia de detalles;
- `fieldViolations` estructurados;
- redacción de secretos y texto sensible;
- contrato público estable;
- allowlist del ledger;
- paridad lógica entre backend y candidato Preview.

Evidencia reproducible local:

```powershell
node scripts/gemini-400-diagnostic-instrumentation.cjs
```

Resultado: `LOCAL_DIAGNOSTIC_INSTRUMENTATION_PASS`, siete respuestas simuladas, siete `fetch` simulados y **cero llamadas de red reales**.

La suite completa del repositorio no está verde: 430 pruebas, 386 PASS, 35 FAIL y 9 TODO. Los fallos observados pertenecen a VAD, frontend/HTML, formularios, fast-read y otras regresiones generales fuera de este cambio. Sin una línea base verde previa no se atribuyen ni se corrigen dentro de este alcance. Las 34 pruebas directamente afectadas sí pasan.

## Privacidad

Se inyectaron deliberadamente marcadores sintéticos con forma de API key, token Bearer, prompt y descripción de proveedor. Ninguno aparece en:

- `provider_diagnostic`;
- fila del ledger;
- respuesta pública;
- evidencia JSON generada.

La traza acepta solo siete campos de primer nivel, categorías enumeradas, seis booleanos, un hash hexadecimal de 64 caracteres y un nombre de modelo restringido. Un diagnóstico con categoría, modelo o hash inválidos se descarta por completo.

## Procedimiento propuesto de despliegue solo Preview

No ejecutado. Requiere autorización explícita.

1. Confirmar que el directorio de despliegue es `PREVIEW_REFERENCIAS_AISLADO` y que el proyecto Vercel vinculado es el preview de `misfinanzas-backend`.
2. Verificar que las variables sensibles existen únicamente en Preview y que `SUPABASE_URL` y `YARBI_PREVIEW_SUPABASE_PROJECT_REF` apuntan a `uevilhbstnmmdlgyshlv`.
3. Ejecutar nuevamente las 34 pruebas dirigidas.
4. Desde `PREVIEW_REFERENCIAS_AISLADO`, ejecutar `npx.cmd vercel@latest deploy` **sin** `--prod`.
5. Verificar el deployment generado, sus Functions y sus variables de entorno sin imprimir valores.
6. Confirmar que no se promovió ni cambió el alias público de Production.
7. No ejecutar baterías semánticas ni llamadas de prueba en esta etapa.

## Procedimiento propuesto para una única sonda posterior

No ejecutado. Requiere una segunda autorización explícita después del despliegue Preview.

1. Usar un único usuario y un único contacto completamente sintéticos del proyecto aislado.
2. Enviar una sola frase sintética al endpoint autenticado de referencias con `execute=false`.
3. No repetir automáticamente la llamada aunque falle.
4. Leer exclusivamente la traza sanitizada de esa `operation_id`.
5. Comprobar: HTTP abstracto, `provider_status`, categoría, señales, modelo y hash del esquema.
6. Confirmar que no existen mensaje del proveedor, prompt, respuesta, credenciales ni datos personales.
7. Detenerse y presentar la evidencia. No reducir el esquema ni ejecutar la batería semántica.

## Riesgos y pendientes

- La categoría exacta del error real sigue `NOT PROVEN` hasta una sonda autorizada en Preview.
- El ledger JSON admite el nuevo campo sin migración, pero la persistencia real del diagnóstico todavía no se ha demostrado en Preview.
- La suite general conserva 35 fallos fuera del alcance que deben tratarse por separado.
- No se debe reducir el esquema basándose solo en la hipótesis de complejidad.

## Conclusión

`INSTRUMENTACION_LOCAL_PREPARADA_PENDIENTE_DE_PREVIEW_Y_SONDA`

Gemini no se declara corregido. La comprensión no se declara cerrada. No hubo llamadas reales a Gemini, despliegues, cambios en Production, CRM, Agenda, WhatsApp, Meta Ads, voz, Vercel remoto ni migraciones.
