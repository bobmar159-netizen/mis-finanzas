# Yarbi — Prueba controlada de esquema estructurado mínimo

## Conclusión

**`ESQUEMA_ESTRUCTURADO_MINIMO_ACEPTADO_EN_PREVIEW_AISLADO`**

Gemini aceptó la única solicitud autorizada que incluyó un `responseJsonSchema` mínimo. El proveedor devolvió HTTP `200`, JSON válido y una respuesta que pasó la validación del propio subconjunto experimental.

Esto demuestra que el modelo y el mecanismo de Structured Output funcionan con un esquema pequeño en este entorno. Refuerza la hipótesis de que una característica del esquema completo, o su interacción con otra característica de ese esquema, produce el anterior HTTP `400`. No identifica todavía la propiedad concreta y no modifica el contrato semántico activo.

## Esquema experimental

El subconjunto conserva los tipos y enums del contrato vigente; no introduce ningún significado nuevo:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["schema", "intent", "conversational_act", "entity_mentions", "ambiguity"],
  "properties": {
    "schema": { "type": "string", "enum": ["yarbi.owner-understanding.v1"] },
    "intent": { "type": "string", "enum": ["reference_lookup", "open_client", "continue_task", "cancel", "clarify", "general"] },
    "conversational_act": { "type": "string", "enum": ["request", "correction", "confirmation", "cancellation", "continuation", "clarification", "unknown"] },
    "entity_mentions": {
      "type": "array",
      "maxItems": 12,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["kind", "value"],
        "properties": {
          "kind": { "type": "string", "enum": ["proper_name", "service_reference", "location_reference", "temporal_reference", "generic_reference", "anaphoric_reference", "unknown"] },
          "value": { "type": "string" }
        }
      }
    },
    "ambiguity": { "type": "boolean" }
  }
}
```

SHA-256 del esquema mínimo: `a5d362ca80359b0d02bade39cc1c67e895647ff09e9b05b267846e4d608c98c9`.

## Diferencia controlada

Respecto de la solicitud inmediatamente anterior que respondió HTTP 200 sin esquema, la única diferencia fue:

`generationConfig.responseJsonSchema = <subconjunto mínimo>`

Se conservaron modelo, endpoint, prompt, fixture `F3G-SERVICE`, `contents`, `temperature: 0`, `responseMimeType: application/json`, autenticación, owner sintético autorizado, Preview aislado y `execute:false`.

## Validaciones previas

| Criterio | Resultado |
| --- | --- |
| Propiedades usadas admitidas: object, array, string, boolean, enum, required | PASS |
| Serialización del esquema y de la solicitud | PASS |
| Diferencia contra la solicitud sin esquema | PASS — sólo `responseJsonSchema` |
| Owner sintético autenticado y fijado en servidor | PASS |
| Sin Bearer | PASS — 401 antes de Gemini |
| Reintentos automáticos | PASS — 0 |
| Acciones comerciales posibles | PASS — ninguna |
| Cambio al esquema original de Yarbi | PASS — ninguno |
| Pruebas locales dirigidas | PASS — 29/29 |

La referencia técnica consultada fue la documentación oficial de [Gemini Structured Output](https://ai.google.dev/gemini-api/docs/structured-output), que documenta esquemas JSON con objetos, arrays, strings, booleanos y enums.

## Única llamada real

| Señal sanitizada | Resultado |
| --- | --- |
| Deployment Preview | `dpl_GCUYCrFEEKcMcE7zXp1zTNyrQXhF` |
| Proyecto Supabase | `uevilhbstnmmdlgyshlv` |
| Fixture | `F3G-SERVICE` sintético |
| Solicitudes al endpoint | 1 |
| Reintentos | 0 |
| HTTP público / proveedor | 200 / 200 |
| Modelo | `gemini-3.5-flash-lite` |
| `responseJsonSchema` enviado | true |
| JSON válido | true |
| Validación estructural mínima | true |
| Latencia Gemini | 891 ms |
| Latencia total | 6798 ms |
| `execute` | false |
| Acciones comerciales | false |

No se persistieron prompt, respuesta del proveedor, tokens, contraseñas, conversaciones, teléfonos ni datos de producción.

## Comparación observada

| Variante | Resultado de Gemini |
| --- | --- |
| Esquema completo | HTTP 400 `INVALID_ARGUMENT` |
| Sin `responseJsonSchema` | HTTP 200 |
| Esquema mínimo | HTTP 200 |

## Producción y aislamiento

- Production, sus alias y Vercel Production no se modificaron.
- Sólo se usó el proyecto aislado `uevilhbstnmmdlgyshlv`.
- No se tocó CRM, Agenda, WhatsApp, Meta Ads, voz ni APK.
- No se ejecutaron baterías semánticas adicionales.

## Recomendación de arquitectura

El siguiente paso seguro es una reducción local y gradual del esquema completo, por grupos independientes de campos, para encontrar la primera característica que provoque el rechazo. No sustituir automáticamente el contrato activo por este subconjunto: perdería información que Yarbi necesita para resolver referencias y acciones.

## Integridad

- `scripts/gemini-minimal-schema-probe-evidence.json`: `00ef6bb56974157add85753ce40451c7da2bc4dfea2b24a715ce7f6ee6600939`
- `scripts/gemini-minimal-schema-probe-attempt.json`: `93c63681bb764f707aba1abdb36cd561fb3358c0c2ddfb06fefff6bdd16851d7`
- Los hashes del informe y de los artefactos se incluyen en `YARBI_GEMINI_SCHEMA_MINIMO_SHA256SUMS.txt`.
