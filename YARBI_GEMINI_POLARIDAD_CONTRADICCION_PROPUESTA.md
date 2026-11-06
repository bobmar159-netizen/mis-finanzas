# Yarbi — propuesta interna de polaridad, negación y contradicción

Fecha: 2026-11-03  
Estado: **PROPUESTA LOCAL VALIDADA — NO ACTIVA, SIN ENDPOINT NI DESPLIEGUE**

## Resultado

Se diseñó y probó localmente una evolución propuesta `yarbi.owner-understanding.v4`. Conserva de manera distinta:

- **polarity**: `affirmed | negated`;
- **certainty**: `confirmed | approximate | inferred`;
- **correction**: `none | discard_active_entity | replace_previous | select_alternative`;
- **contradiction**: resultado derivado por backend al comparar una afirmación con el estado conversacional real; nunca un valor entregado por Gemini.

La propuesta no está importada por handlers ni rutas activas. Sólo la suite local importa el archivo. No hubo Gemini, red, despliegue, Supabase, CRM, Agenda, WhatsApp, APK ni acciones comerciales.

## Contrato propuesto

El proveedor devolvería sólo significado lingüístico compacto:

```text
yarbi.owner-understanding.v4
  schema
  intent
  conversational_act
  target_type
  mentions[]
    kind
    value
    polarity              affirmed | negated
    certainty             confirmed | approximate | inferred
    claimed_source        utterance | conversation_state | unknown
    attributes?           days | day_part | present
  control
    correction
    continuation
    cancel_scope
  confidence             number estricto 0..1
  ambiguity
  missing_information[]
```

`claimed_source` no es evidencia confiable. El hardener propuesto calcula `provenance` de nuevo:

- `utterance` sólo si el valor está respaldado por la frase actual;
- `conversation_state` sólo si coincide con una restricción activa real;
- `unverified` si no puede demostrarse.

Una mención sin procedencia verificada no genera una restricción consultable.

## Compatibilidad y ruta canónica

No se agrega un segundo motor. La arquitectura propuesta es:

```text
Proveedor compacto v4
  → normalización estricta v4
  → hardening de polaridad / procedencia / contradicción
  → plan seguro de restricciones positivas
  → adaptador v4 → forma v1/v3 existente (futura fase autorizada)
  → resolvedores actuales
```

La propuesta actual se detiene en el plan seguro; no toca `normalizeUnderstanding`, `hardenUnderstanding`, `candidate-resolver`, `owner-reference-candidates` ni `reference-candidates` activos.

Para payloads `yarbi.owner-understanding.v1` se agregó una función de compatibilidad aislada:

- si la frase no contiene señal de negación/corrección sin resolver, expande las menciones antiguas como `affirmed` con procedencia pendiente de verificar;
- si la frase contiene `no`, `era`, `me refería`, `corregir` o `mejor dicho`, devuelve `legacy_polarity_ambiguous` y se abstiene;
- por tanto, una carga antigua no recibe polaridad afirmativa automática cuando podría tratarse de una corrección o negación.

## Reglas del hardener propuesto

1. Sólo las menciones `affirmed` con procedencia verificable pueden formar `query_constraints`.
2. Una mención `negated` se conserva en `discarded_mentions`; nunca genera restricción positiva ni exclusión SQL.
3. `replace_previous` exige, para actuar sin aclaración, al menos una mención negada y una afirmada. Deja ambos datos disponibles: el descartado y el reemplazo.
4. El backend compara cada mención afirmada con `state.active_constraints`. Si difieren:
   - con `replace_previous`, genera contradicción `resolved_by_correction`;
   - sin esa corrección explícita, genera contradicción `unresolved`, no consulta candidatos y pide aclaración.
5. La frase `No canceles...` anula el acto de cancelación: se transforma en `clarification`, `cancel_scope=none` y no permite ejecución.
6. Una negación sin reemplazo comprobable o con alcance ambiguo se abstiene.
7. Todo plan resultante mantiene `may_auto_select=false`; esta propuesta no habilita acciones ni selección automática.

## Endurecimiento de entrada

La normalización propuesta rechaza, sin convertir ni recortar silenciosamente:

- objetos, números, booleanos o `null` donde se espera texto;
- texto con espacios de borde o longitud mayor a 120;
- `confidence=null`, booleano, no numérico o fuera de `0..1`;
- `certainty=contradiction`;
- propiedades adicionales no previstas;
- objetos `control`, `attributes` o menciones con forma no exacta;
- días no numéricos, no finitos o fuera de `0..3650`.

El único dato procedimental que puede provenir de Gemini es `claimed_source`; no se reutiliza como procedencia efectiva.

## Auditoría de compatibilidad con consumidores existentes

| Consumidor actual | Dependencia | Compatibilidad propuesta |
|---|---|---|
| `normalizeUnderstanding` | Forma v1 y claves históricas | Futuro adaptador v4→v1 generará sólo pistas positivas verificadas. |
| `hardenUnderstanding` | Evidencia, restricciones, nombre tipado | Continúa siendo el guardrail final; no se modificó. |
| `yarbi-candidate-resolver` | Restricciones, referencia, temporal | Recibiría sólo `query_constraints`, sin negaciones como filtros SQL. |
| `yarbi-owner-reference-candidates` | Nombre/servicio/distrito/rango | Conservado vía adaptación determinista cuando existe evidencia positiva. |
| `reference-candidates` | Forma sanitizada v3 para UI | No se modifica; v4 no se expone hasta una fase posterior. |

## Matriz local ejecutada

Comando:

```powershell
node .\scripts\test-yarbi-polarity-proposal-local.cjs
```

Resultado: **18/18 PASS**, `network_calls=0`, `commercial_actions=0`.

| Caso | Resultado comprobado |
|---|---|
| No era Carlos, era Carla | Carlos queda negado, Carla es positiva; contradicción resuelta por corrección. |
| No era reparación, era instalación | Servicio anterior descartado; instalación positiva. |
| No canceles la cita | No se trata como cancelación ni ejecución. |
| No era ayer, fue hoy | Temporal anterior negado, hoy positivo. |
| Carlos no era el cliente | Sin restricción positiva; requiere aclaración. |
| No estoy seguro si era Carlos | Se abstiene por ambigüedad. |
| Me refería al otro cliente | Conserva `select_alternative`; nunca autoelige. |
| Conflicto con estado sin corrección | Contradicción no resuelta; no consulta candidatos. |
| Negación de alcance ambiguo | Se abstiene. |
| Continuación activa | Conserva control de continuidad, sin selección automática. |
| v1 sin polarity, frase segura | Ruta explícita de compatibilidad. |
| v1 sin polarity, frase con negación | Rechazo `legacy_polarity_ambiguous`. |
| Mención malformada | Rechazo. |
| `confidence=null` | Rechazo. |
| `confidence=true` | Rechazo. |
| Nombre objeto | Rechazo. |
| Referencia >120 caracteres | Rechazo. |
| Propiedad adicional / source no verificable | Rechazo de forma o abstención de uso. |

## Complejidad de esquema

| Métrica | v1 activo | Compacto previo | v4 polaridad propuesto |
|---|---:|---:|---:|
| Bytes JSON | 5,513 | 1,995 | 2,068 |
| Propiedades | 76 | 21 | 21 |
| Objetos | 15 | 4 | 4 |
| Arrays | 5 | 2 | 2 |
| Valores enum | 68 | 51 | 50 |
| Profundidad máxima | 3 | 4 | 4 |

v4 añade sólo 73 bytes frente al esquema compacto anterior, pero elimina la ambigüedad entre certeza, polaridad y contradicción. Sigue siendo 62.5% menor que v1 activo.

## Riesgos y límites pendientes

| Punto | Estado |
|---|---|
| Equivalencia local para afirmación, negación, corrección y contradicción | PASS en 18 casos de propuesta |
| Entrada de Gemini que cumpla v4 | NOT PROVEN: no se llamó a Gemini |
| Adaptación v4 → v1/v3 en una ruta real | NOT PROVEN: no está conectada por alcance |
| Casos lingüísticos complejos de doble negación | NOT PROVEN; deben ampliar la matriz antes de activar |
| Regresión de consumidores activos | No aplicable: ningún consumidor activo fue modificado |
| Consultas SQL negativas | No implementadas ni justificadas |

## Recomendación para una futura sonda Gemini

Antes de una llamada real única, debe autorizarse una fase que:

1. Complete un adaptador v4→v1/v3 explícito que sólo emita restricciones positivas verificadas.
2. Pruebe con fixtures sintéticos el recorrido adaptador → hardener actual → plan de candidato, sin CRM ni acciones.
3. Despliegue únicamente un Preview aislado con `execute:false`, una cuenta sintética, sin reintentos y sin integración comercial.
4. Ejecute una única sonda v4 y lea sólo evidencia sanitizada.

No se recomienda conectar v4 al endpoint ni ejecutar esa sonda en esta fase.

## Archivos creados

- `PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-understanding-polarity-proposal.js`
- `scripts/test-yarbi-polarity-proposal-local.cjs`
- `YARBI_GEMINI_POLARIDAD_CONTRADICCION_PROPUESTA.md`
- `YARBI_GEMINI_POLARIDAD_CONTRADICCION_PRUEBA_LOCAL.json`
- `YARBI_GEMINI_POLARIDAD_CONTRADICCION_SHA256SUMS.txt`
