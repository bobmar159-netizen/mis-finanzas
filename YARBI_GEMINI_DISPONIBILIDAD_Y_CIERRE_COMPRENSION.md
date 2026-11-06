# Yarbi — disponibilidad Gemini y cierre de comprensión

Fecha: 2026-11-02  
Entorno: Preview aislado `uevilhbstnmmdlgyshlv`  
Estado final: `DIAGNOSTICO_FORENSE_COMPLETADO_CAUSA_EXACTA_NOT_PROVEN`

## Resultado ejecutivo

El último gate no constituye un fallo semántico de `F3G-SERVICE`. Las cinco
solicitudes iniciales y la sonda posterior terminaron antes de obtener una
respuesta del modelo.

La causa comprobada hasta el límite seguro de esta fase es:

- la autenticación y la policy de Preview permiten llegar a la ruta de lenguaje;
- la configuración declara Gemini habilitado y el modelo efectivo continúa
  siendo `gemini-3.5-flash-lite`;
- el proveedor recibe la solicitud, pero la rechaza con HTTP 400;
- el backend clasifica el fallo como
  `owner_understanding_provider_rejected_400`;
- no existe `gemini_ms`, salida JSON del modelo ni evaluación semántica válida.

El detalle interno exacto del `INVALID_ARGUMENT` de Google no fue persistido por
el contrato seguro actual. Por ello, la propiedad concreta rechazada dentro de
la solicitud permanece `NOT PROVEN`. La hipótesis inicial de que únicamente el
objeto anidado completo de `entity_mentions` excedía la complejidad no quedó
confirmada: se redujo a `kind` + `value` y la sonda siguió devolviendo 400.

## Recorrido verificado

| Etapa | Estado | Evidencia |
|---|---|---|
| Autenticación sintética | PASS | La ruta no devolvió 401. |
| Policy/guard Preview | PASS | La ruta no devolvió rechazo de policy y alcanzó el proveedor. |
| Supabase aislado | PASS | Ref y host verificados como `uevilhbstnmmdlgyshlv`. |
| Selección NEEDS_LANGUAGE_MODEL | PASS | El error procede de la llamada al proveedor, no de FAST_LOCAL. |
| Configuración Gemini | PASS parcial | Flag habilitado, modelo esperado y variable secreta asignada a Preview; no se leyó su valor. |
| Llamada a Gemini | FAIL | HTTP 400 `provider_rejected`. |
| JSON del modelo | BLOCKED | No hubo respuesta utilizable. |
| Hardening semántico | BLOCKED | No recibió una salida del modelo. |

## Configuración de Preview observada

Se inspeccionaron únicamente nombres, entornos y booleanos no sensibles:

- `YARBI_PREVIEW_OWNER_GEMINI_UNDERSTANDING`: presente en Preview y `true`.
- `YARBI_PREVIEW_OWNER_REFERENCES_ONLY`: presente en Preview y `true`.
- `YARBI_PREVIEW_AUDIT_ONLY`: `false`.
- `YARBI_PREVIEW_OWNER_UI_ONLY`: `false`.
- `YARBI_PREVIEW_SUPABASE_PROJECT_REF`: ref aislado esperado.
- `SUPABASE_URL`: host aislado esperado.
- `GEMINI_API_KEY`: asignada como Secret a Preview; su valor no fue leído.
- modelo: `gemini-3.5-flash-lite`.

No se imprimieron API keys, JWT, service-role keys ni credenciales.

## Cambios de esta recuperación

1. Se preservó una causa técnica sanitizada cuando el contrato del proveedor es
   inválido, sin exponer contenido o respuesta de Gemini.
2. La evidencia local ahora conserva únicamente el código estable
   `understanding_error`.
3. El esquema de `entity_mentions` enviado al proveedor fue reducido a
   `kind` + `value`; la procedencia y seguridad continúan bajo autoridad del
   backend.
4. No se modificaron las reglas semánticas, el resolvedor, ranking, owner scope,
   catálogo de servicios ni lógica comercial.

Regresión local posterior: `61/61 PASS`.

## Deployments Preview

- Diagnóstico de causa sanitizada:
  `misfinanzas-backend-cwlfh5lx3-omar-dfc4.vercel.app`
- Sonda posterior a simplificación del esquema:
  `misfinanzas-backend-9s6vmn1rk-omar-dfc4.vercel.app`

Ambos son deployments Preview. No se usó `--prod`, no se promovieron alias y no
se modificó Producción.

## Compuertas

| Compuerta | Resultado |
|---|---|
| Diagnóstico de disponibilidad | PASS parcial: proveedor identificado, subcausa del 400 no persistida |
| Sonda mínima posterior a corrección | FAIL: 503 / `provider_rejected_400` |
| F3G-SERVICE 5x semántico | BLOCKED; el intento anterior fue 0/5 por disponibilidad, no por semántica |
| Seis familias, 18 resultados | NOT PROVEN; no ejecutado |
| Batería fresca de 14 | NOT PROVEN; no ejecutada |
| Dataset V2 de 64 | NOT PROVEN; no ejecutado |

## Métricas y seguridad

- alucinaciones evaluables: `NOT PROVEN` (Gemini no respondió);
- provider errors de la sonda: `1/1`;
- timeouts: `0`;
- `gemini_ms`: no disponible;
- `server_total_ms`: no disponible en respuesta fallida;
- `execute:false`: PASS;
- acciones comerciales: cero;
- WhatsApp/CRM/Agenda/Maps/Notion/Calendar: no usados;
- Producción: intacta.

## Hashes SHA-256

- evidencia de sonda: `B0B92BFE8DAE4A155BC903B13F1B200C125547D485E11122496088C300A379AC`
- `lib/yarbi-gemini-owner-understanding.js`: `9AC6EF621D4EDC5586C0BB5522F4C55BE073869550636C85B35564DD1E9BFF8D`
- `api/assistant/reference-candidates.js`: `F6BC98D128892573D8527ABC825A14F4641248A2C5A23143510F8B4DD36C0E3C`
- runner real: `12F91C74F4BBF896EB5D4D72398A7C312607C781A8785768D327B68833E1954F`
- wrapper PowerShell: `ECFCC63D8B320EEB2EF74D84A8E5D4AC061422A67D062FE391E9B82427AD7648`

Los duplicados dentro de `PREVIEW_REFERENCIAS_AISLADO` tienen contenido lógico
equivalente, pero hashes binarios diferentes por formato de fin de línea.

## Riesgo y siguiente paso mínimo

No corresponde seguir reduciendo el esquema a ciegas ni lanzar más baterías. El
siguiente paso seguro requiere clasificar el mensaje 400 del proveedor en una
categoría abstracta y sanitizada (por ejemplo, esquema demasiado complejo,
campo no soportado o modelo inválido) sin guardar el texto completo. Esa
instrumentación necesitaría una nueva autorización antes de otra llamada real.

No se declara cerrada la comprensión semántica.

---

## Investigación forense local del HTTP 400

### Conclusión

La petición se reconstruyó ejecutando el constructor real con un `fetch`
simulado. No se realizó ninguna conexión a Gemini.

Quedó demostrado lo siguiente:

1. La implementación no usa un SDK de Gemini. Usa `fetch` y serializa
   directamente JSON hacia `generateContent`.
2. El modelo configurado, `gemini-3.5-flash-lite`, existe como modelo estable y
   declara soporte para Structured Outputs.
3. `responseMimeType: application/json` y `responseJsonSchema` forman parte del
   contrato documentado de `GenerationConfig`. `responseJsonSchema` aparece
   como una vía obsoleta, pero todavía admitida; no es por sí sola evidencia de
   un campo desconocido.
4. Todos los keywords del esquema actual pertenecen al subconjunto documentado
   por Gemini. No se encontraron keywords ajenos al contrato soportado.
5. La serialización local termina correctamente. Por ello no hay evidencia de
   `SDK_SERIALIZATION_ERROR` y, de hecho, no existe SDK en esta ruta.
6. El esquema es considerable: 5,513 bytes serializados, 76 propiedades, 76
   entradas `required`, 68 valores de enum, 27 tipos nullable y profundidad 5.
   El subesquema `clue` se expande nueve veces en el JSON enviado.
7. Google documenta que puede rechazar esquemas grandes o complejos con HTTP
   400. Esto convierte la complejidad en la hipótesis principal, pero no en una
   causa demostrada.

La causa exacta continúa `NOT PROVEN` porque la ejecución que recibió el 400
solo conservó `owner_understanding_provider_rejected_400`; el detalle
estructurado del `INVALID_ARGUMENT` no quedó disponible en la evidencia. Con
la información actual, la clasificación correcta es:

`PROVIDER_INVALID_ARGUMENT_UNKNOWN`

No corresponde afirmar `SCHEMA_UNSUPPORTED` hasta observar una señal
sanitizada que mencione esquema, complejidad o keyword rechazado.

### Objeto lógico exacto de la solicitud

La reconstrucción usa un texto completamente sintético. Los headers de
autenticación se reducen a su nombre; nunca se conserva el valor.

```json
{
  "url": "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
  "method": "POST",
  "headers": {
    "Content-Type": "application/json",
    "x-goog-api-key": "[REDACTED]"
  },
  "body": {
    "contents": [
      {
        "role": "user",
        "parts": [
          {
            "text": "<prompt fijo del parser + contexto sintético minimizado>"
          }
        ]
      }
    ],
    "generationConfig": {
      "temperature": 0,
      "responseMimeType": "application/json",
      "responseJsonSchema": "<esquema completo indicado abajo>"
    }
  }
}
```

No se envían `tools`, function calls, teléfonos, IDs de contacto, owner scope,
candidatos, JWT ni secretos dentro del body.

La petición reconstruida completa y el esquema completo sin abreviaciones
están en `scripts/gemini-request-forensics-evidence.json`. Ese artefacto es la
fuente canónica del objeto lógico: contiene el body exacto generado por el
constructor real con un fixture sintético y la API key reemplazada por
`[REDACTED]`.

### Esquema completo y contrato

El root es un objeto cerrado (`additionalProperties:false`) y exige:

```text
schema, intent, conversational_act, target_type, target_reference,
entity_mentions, constraints, correction, continuation, cancel_scope,
temporal_clues, location_clues, service_clues, confidence, ambiguity,
missing_information
```

Estructura completa:

- `schema`: string enum `yarbi.owner-understanding.v1`.
- `intent`: string enum de 6 valores.
- `conversational_act`: string enum de 7 valores.
- `target_type`: string enum de 6 valores.
- `target_reference`: objeto cerrado, `name` y `relation` obligatorios.
- `entity_mentions`: array, máximo 12; cada item es un objeto cerrado con
  `kind` enum de 7 valores y `value` string.
- `constraints`: objeto cerrado con seis pistas obligatorias: `name`,
  `district`, `service`, `location`, `visit`, `recency`.
- Cada pista es un objeto cerrado que exige `value`, `certainty`, `days`,
  `day_part`, `present`; `days`, `day_part` y `present` aceptan `null`.
- `correction`: objeto cerrado con tres booleanos obligatorios.
- `continuation`: objeto cerrado con dos booleanos obligatorios.
- `cancel_scope`: string enum de 5 valores.
- `temporal_clues`, `location_clues`, `service_clues`: arrays de pistas,
  máximo 6 cada uno.
- `confidence`: number, mínimo 0 y máximo 1.
- `ambiguity`: boolean.
- `missing_information`: array de strings, máximo 8.

La representación JSON completa —incluidos todos los enums, required,
nullable y límites— se conserva dentro del artefacto forense; no se sustituyó
ningún fragmento para ejecutar las pruebas.

### Compatibilidad con documentación oficial

Fuentes primarias consultadas:

- Structured Output de Generate Content:
  https://ai.google.dev/gemini-api/docs/generate-content/structured-output
- Referencia de `generateContent` y `GenerationConfig`:
  https://ai.google.dev/api/generate-content
- Ficha de `gemini-3.5-flash-lite`:
  https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite

| Elemento | Resultado | Evidencia |
|---|---|---|
| Modelo | PASS | La ficha oficial lo marca estable y con Structured Outputs. |
| Endpoint `v1beta/...:generateContent` | PASS | Es un endpoint documentado. |
| `responseMimeType=application/json` | PASS | Es el MIME compatible documentado. |
| `responseJsonSchema` | PASS con observación | Campo documentado, hoy obsoleto frente a `responseFormat`. |
| Tipos string/number/boolean/object/array/null | PASS | Admitidos por la guía. |
| enums | PASS | Admitidos para strings. |
| objetos y arrays anidados | PASS individual | Admitidos; la complejidad acumulada puede ser rechazada. |
| required/additionalProperties | PASS | Ambos documentados. |
| minimum/maximum/maxItems | PASS individual | Admitidos; la cantidad de restricciones aumenta complejidad. |
| tools/function calling | NOT APPLICABLE | La petición no configura herramientas. |
| causa concreta del 400 | NOT PROVEN | No se conservó el detalle estructurado del proveedor. |

### Captura actual del error

`classifyFailure()` conserva actualmente:

- código estable interno;
- status HTTP;
- hasta 160 caracteres del mensaje en una propiedad transitoria.

La API pública devuelve solo el código estable y el status. Las trazas no
conservan el detalle, por eso la evidencia actual no permite distinguir un
esquema demasiado complejo de otro `INVALID_ARGUMENT`.

Se añadió un clasificador forense local y no integrado al runtime. Solo produce
una categoría y señales booleanas; nunca devuelve ni persiste el mensaje:

- `SCHEMA_UNSUPPORTED`
- `SCHEMA_INVALID`
- `MODEL_CONFIGURATION_INVALID`
- `GENERATION_CONFIG_INVALID`
- `REQUEST_FIELD_UNSUPPORTED`
- `SDK_SERIALIZATION_ERROR`
- `PROVIDER_INVALID_ARGUMENT_UNKNOWN`

Con un error sin detalle, el resultado permanece `UNKNOWN` por diseño.

### Pruebas locales

Se ejecutaron 13 pruebas con mocks, sin red:

- constructor real de la petición;
- URL, método, nombres de headers y redacción de la API key;
- body y `generationConfig` exactos;
- ausencia de tools y secretos en el body;
- igualdad del esquema capturado con el esquema runtime;
- inventario de keywords soportados;
- serialización, nullable, enums, required y límites;
- siete categorías de error simuladas;
- preservación de `UNKNOWN` cuando no hay evidencia.

Resultado: `13/13 PASS`.

### Propuesta separada, no aplicada

El siguiente paso mínimo no es reducir el contrato semántico. Es integrar el
clasificador sanitizado en la captura de errores y autorizar una sola llamada
controlada. Esa llamada debería conservar únicamente:

- status HTTP;
- status abstracto del proveedor;
- categoría sanitizada;
- señales booleanas;
- hash del esquema y versión del modelo.

Si la categoría resultara `SCHEMA_UNSUPPORTED`, la corrección candidata sería
preservar todos los campos semánticos pero evitar la expansión repetida de
`clue` mediante `$defs/$ref`, ambos documentados, y migrar de manera separada
del campo obsoleto `responseJsonSchema` a `responseFormat.text.schema`. Ninguna
de estas correcciones fue aplicada ni probada contra Gemini en esta fase.

### Seguridad y límites

- llamadas reales a Gemini: `0`;
- llamadas de red desde las pruebas: `0`;
- Production/Vercel/APK: sin cambios;
- CRM, Agenda, WhatsApp, Meta Ads, voz, resolvedor, ranking, owner scope y
  catálogo de servicios: sin cambios;
- contrato semántico: sin cambios;
- acciones comerciales: `0`.
