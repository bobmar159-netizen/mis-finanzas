# Yarbi — adaptador propuesto v4 → v1/v3 y validación local completa

Fecha: 2026-11-03  
Estado: **VALIDADO LOCALMENTE Y AISLADO — NO CONECTADO A ENDPOINTS ACTIVOS**

## Resultado

Se completó un adaptador determinista local desde el resultado ya endurecido de `yarbi.owner-understanding.v4` a `yarbi.owner-understanding.v1`, que después atraviesa los normalizadores y el hardener v3 existentes antes de llegar al plan del resolvedor.

El recorrido local completo pasó **15/15**. Las tres suites relacionadas pasan **45/45**:

| Suite | Resultado |
|---|---:|
| Contrato compacto previo | 12/12 PASS |
| Polaridad y contradicción v4 | 18/18 PASS |
| Integración v4 → v1 → v3 → plan de candidato | 15/15 PASS |

No hubo llamadas a Gemini, red, Supabase/CRM, consultas de clientes, despliegues, acciones comerciales ni imports desde handlers activos.

## Correcciones realizadas antes del adaptador

### Emparejamiento estricto de correcciones

El diseño anterior podía aceptar `replace_previous` si existían una mención negada y una afirmada, aunque fueran de dimensiones diferentes. Se corrigió así:

1. Debe haber exactamente una referencia negada y una afirmada verificadas.
2. Ambas deben corresponder a la misma dimensión: nombre, servicio, ubicación o recencia.
3. Debe existir lenguaje correctivo explícito en la frase.
4. Si existe estado activo para esa dimensión, la referencia negada debe coincidir exactamente con ese estado.
5. Múltiples pares posibles, dimensiones cruzadas o referencia descartada distinta del estado activo bloquean la adaptación.

Sólo una corrección que supera esas reglas marca la contradicción como `resolved_by_correction`. Las demás quedan como `requires_clarification`.

### Procedencia, polaridad y atributos

- `claimed_source` sólo es un dato del proveedor; el backend recalcula la procedencia.
- Una aparición textual respalda la procedencia, pero no cambia una negación en afirmación.
- Si la frase contradice una mención afirmada, se bloquea por `polarity_not_verifiable`.
- Una mención negada debe tener un alcance negado comprobable para intervenir en una corrección.
- `days` sólo se conserva para `hoy=0` o `ayer=1` cuando la frase lo respalda.
- `day_part` sólo se conserva si la frase permite derivarlo exactamente.
- `present` nunca se transforma en restricción: se omite y fuerza abstención porque su mera mención no demuestra existencia.

## Arquitectura y contratos

```text
v4 compacto (proveedor, futuro)
  → strictNormalizeProposed
  → hardenProposed
       verifica procedencia/polaridad/atributos
       conserva descartes y contradicciones
       produce sólo query_constraints seguras
  → adaptV4ToV1
       rechaza aclaraciones/contradicciones no resueltas
       emite v1 con restricciones positivas verificadas
  → normalizeUnderstanding existente
  → hardenUnderstanding existente (v3)
  → resolveCandidateReference (sólo candidatos sintéticos en pruebas)
```

El adaptador nuevo no interpreta texto, no resuelve entidades, no consulta CRM y no crea exclusiones SQL. Únicamente traduce un objeto v4 que ya fue endurecido.

### Entrada v4 endurecida

El adaptador acepta sólo resultados que cumplan todos estos requisitos:

- `schema = yarbi.owner-understanding.v4`;
- `plan.may_query_candidates = true`;
- `plan.requires_clarification = false`;
- `plan.may_auto_select = false`;
- cero contradicciones no resueltas;
- claves de restricciones permitidas y tipos estrictos;
- menciones afirmadas con procedencia y polaridad verificadas.

### Salida v1 exacta

La salida contiene los campos reales esperados por `normalizeUnderstanding()`:

- `schema`, `intent`, `conversational_act`, `target_type`;
- `target_reference` sólo para un `proper_name` positivo y verificado;
- `entity_mentions` positivas verificadas;
- `constraints`, `temporal_clues`, `location_clues`, `service_clues` únicamente desde `query_constraints`;
- banderas históricas de `correction` y `continuation`;
- `cancel_scope`, `confidence`, `ambiguity`, `missing_information`.

La información semántica que v1 no puede transportar se conserva fuera del payload v1 en `preservation`: menciones descartadas y contradicciones resueltas. Esto evita perderla antes de terminar el hardening, sin obligar a los consumidores v1/v3 a aceptar campos nuevos.

## Reglas del resolvedor

| Situación v4 | Salida al resolvedor existente |
|---|---|
| Mención afirmada, verificada y coherente | Restricción positiva permitida |
| Mención negada | Nunca se convierte en restricción positiva ni exclusión SQL |
| Corrección emparejada y verificable | Sólo el reemplazo afirmado pasa; el descartado queda en preservación |
| Contradicción no resuelta | No se adapta ni llega al resolvedor |
| Procedencia no verificable | No se adapta |
| Atributo temporal no verificable | No se adapta |
| `select_alternative` | Sin restricciones ni selección automática |
| Cualquier cancelación | Nunca ejecuta nada en esta arquitectura |

## Pruebas de integración ejecutadas

Comando:

```powershell
node .\scripts\test-yarbi-v4-v1-integration-local.cjs
```

| Caso | Resultado |
|---|---|
| Corrección Carlos → Carla con estado coincidente | Carla es la única restricción positiva; Carlos no llega al resolvedor. |
| Descartado distinto del estado activo | Bloqueado. |
| Corrección entre nombre y servicio | Bloqueado. |
| Negación sin reemplazo | Bloqueada. |
| Contradicción de servicio sin corrección | Bloqueada. |
| Servicio afirmado + nombre negado | Bloqueado; no llega ningún filtro positivo. |
| Nombre afirmado + servicio negado | Bloqueado. |
| Atributo temporal inventado | Bloqueado. |
| Procedencia no demostrada | Bloqueada. |
| No canceles / No quiero / No vayas / No todavía | No se trata como acción. |
| Sí, cancela la cita | No ejecuta ni se adapta a consulta. |
| Cancela la anterior, no la nueva | Se abstiene por alcance ambiguo. |
| Payload v1 compatible sin negación | Pasa por adaptación explícita y v1→v3 sigue válido. |
| Múltiples pares correctivos | Bloqueado. |
| Referencia genérica ambigua | Sin selección automática. |

## Compatibilidad y regresiones

- `normalizeUnderstanding()` y `hardenUnderstanding()` no fueron modificados.
- `candidate-resolver`, `owner-reference-candidates` y `reference-candidates` no fueron modificados.
- La prueba valida el formato real de salida v1 con `normalizeUnderstanding()` y genera el formato v3 con `hardenUnderstanding()`.
- `resolveCandidateReference()` se ejecutó únicamente con tres candidatos sintéticos en memoria; `crm_queries=0`.
- La única importación de los dos módulos nuevos ocurre en las pruebas locales. No hay imports desde `api/`, handlers ni módulos activos.
- No se ejecutó una suite global ajena al alcance: los módulos activos no cambiaron y las suites dirigidas cubren el único recorrido nuevo.

## Archivos creados o modificados

- Modificado: `PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-understanding-polarity-proposal.js`
- Creado: `PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-v4-v1-adapter-proposal.js`
- Creado: `scripts/test-yarbi-v4-v1-integration-local.cjs`
- Creado: `YARBI_GEMINI_ADAPTADOR_V4_V1_VALIDACION.md`
- Creado: `YARBI_GEMINI_ADAPTADOR_V4_V1_PRUEBA_LOCAL.json`
- Creado: `YARBI_GEMINI_ADAPTADOR_V4_V1_SHA256SUMS.txt`

## Riesgos residuales

| Riesgo | Estado |
|---|---|
| Gemini produzca v4 válido en Preview | NOT PROVEN; no se llamó a Gemini |
| Ambigüedades lingüísticas más complejas (doble negación, ironía) | NOT PROVEN; se deben ampliar fixtures antes de producción |
| Persistencia de `preservation` en ledger | NOT PROVEN; no se toca trazabilidad activa en esta fase |
| Integración con endpoint real | No realizada por restricción |
| Acciones comerciales | Fuera de alcance y no ejecutadas |

## Recomendación para una futura sonda Gemini

La siguiente fase, si se autoriza, debe ser una sola sonda Preview aislada con un fixture sintético de corrección inequívoca (por ejemplo, “No era Carlos, era Carla”), `execute:false`, sin CRM/Agenda/WhatsApp y sin reintentos. Antes debe agregarse una ruta de diagnóstico temporal que use este adaptador y guarde únicamente evidencia sanitizada. No debe habilitarse el endpoint normal hasta completar una batería representativa de v4.

## Hashes

Los hashes SHA-256 de artefactos y evidencia se encuentran en `YARBI_GEMINI_ADAPTADOR_V4_V1_SHA256SUMS.txt`.
