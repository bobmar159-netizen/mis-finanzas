# Yarbi — hardening final del adaptador v4 y protección de polaridad

Fecha: 2026-11-03  
Estado: **VALIDADO LOCALMENTE Y AISLADO — LISTO PARA SONDA SINTÉTICA SÓLO BAJO AUTORIZACIÓN POSTERIOR**

## Resultado

Se cerraron los dos defectos detectados en la propuesta v4:

1. El adaptador ya no normaliza valores semánticos inválidos a valores por defecto.
2. La ausencia de una coincidencia de negación ya no equivale a una afirmación “verificada”.

Las cuatro suites dirigidas pasaron **59/59**. El adaptador sigue sin conexión a handlers, endpoints o despliegues. No hubo llamadas a Gemini, red, CRM, Agenda, WhatsApp, Supabase ni acciones comerciales.

## Defectos encontrados y correcciones

### 1. Adaptador permisivo

Antes, el adaptador podía degradar `certainty` inválida a `inferred`, `confidence` inválida a `0`, y aceptar formas parciales de objetos endurecidos. También no validaba de forma suficiente que una restricción procediera de una mención afirmada, coherente y verificable.

Se corrigió con validación exacta de:

- objeto v4 endurecido y sus claves obligatorias;
- `plan`, incluyendo `may_auto_select === false` y `requires_clarification === false`;
- `control`, `confidence`, enum de intención/acto/tipo y `missing_information`;
- cada mención, procedencia, guardia de polaridad y atributos verificados;
- contradicciones con estructura exacta y sólo estado `resolved_by_correction`;
- menciones descartadas que deben corresponder a una mención negada real, y contradicciones resueltas que deben corresponder tanto al descarte como a su reemplazo afirmado;
- cada `query_constraint`, que debe corresponder en dimensión, valor, certeza, fuente y atributos con una mención afirmada respaldada;
- ausencia total de exclusiones SQL y razones de bloqueo antes de adaptar;
- `days` sólo `0` o `1`, los únicos valores que el hardener local puede demostrar (`hoy` / `ayer`);
- rechazo explícito de `present` como restricción.

No existe conversión silenciosa de `null`, booleanos, objetos o valores fuera de contrato.

### 2. Polaridad afirmada sin evidencia suficiente

Antes, `verifyPolarity()` devolvía una marca booleana positiva cuando no encontraba una negación mediante una expresión regular. Eso podía confundirse con una confirmación semántica.

Ahora `assessPolarityConsistency()` distingue:

| Estado | Significado |
|---|---|
| `no_detectable_conflict` | Gemini afirmó la mención y la guardia no detectó conflicto explícito; no significa prueba lingüística absoluta. |
| `negation_elsewhere` | Hay una negación explícita en la frase, pero no sobre esa mención; sólo puede pasar como reemplazo de una corrección emparejada y resuelta. |
| `explicit_conflict` | La frase niega esa mención afirmada; se bloquea. |
| `verified_negation` | La mención negada tiene un alcance comprobable. |
| `scope_ambiguous` / `negation_not_evident` | No se puede usar la negación como base de una corrección. |

Gemini continúa interpretando lenguaje natural. Estas guardias sólo detectan conflictos explícitos y fuerzan abstención; no intentan reemplazar el modelo con un diccionario lingüístico.

## Protección de acciones negativas

Las siguientes frases se convierten en aclaración, nunca en una cancelación ejecutable:

- “No canceles la cita”.
- “No quiero cancelar la cita”.
- “No vayas a cancelar la cita”.
- “No canceles todavía”.
- “No se debe cancelar la cita”.
- “No quiero que canceles la cita”.

“Sí, cancela la cita” sigue siendo intención de cancelación, pero el adaptador no la convierte en búsqueda ni en acción comercial. “Cancela la cita anterior, no la nueva” se abstiene por alcance ambiguo.

## Nuevas pruebas ejecutadas

Comando adicional:

```powershell
node .\scripts\test-yarbi-v4-adapter-hardening-local.cjs
```

| Grupo | Resultado |
|---|---:|
| Afirmación errónea bajo “No fue / No es / Nunca fue / No quiero a...” | PASS |
| “No era Carlos, era Carla” y “Carlos no, Carla sí” con afirmación errónea | PASS |
| Negaciones de cancelación | PASS |
| `certainty` inválida | PASS |
| `days=365` manipulado | PASS |
| `present=true` manipulado | PASS |
| Propiedades adicionales | PASS |
| Contradicciones o claves de plan ausentes/manipuladas | PASS |
| `may_auto_select` o `requires_clarification` inseguro | PASS |
| Restricción sin mención positiva correspondiente | PASS |
| `confidence` inválida | PASS |
| La mención negada no cruza a v1 | PASS |

## Regresión dirigida

| Suite | Antes | Ahora |
|---|---:|---:|
| Contrato compacto | 12/12 | 12/12 PASS |
| Polaridad y contradicción | 18/18 | 18/18 PASS |
| Integración v4 → v1 → v3 | 15/15 | 15/15 PASS |
| Hardening final nuevo | — | 14/14 PASS |
| **Total** | **45/45** | **59/59 PASS** |

Los módulos activos (`normalizeUnderstanding`, `hardenUnderstanding`, resolvedores y handlers) no fueron modificados. La única importación de los módulos de propuesta continúa siendo desde scripts locales de prueba.

## Compatibilidad v1/v3

- El adaptador emite la forma real esperada por `normalizeUnderstanding()`.
- La integración atraviesa después `hardenUnderstanding()` y produce v3 correctamente.
- Un payload v1 antiguo sólo se amplía cuando la frase no contiene negación o corrección ambigua; de lo contrario devuelve `legacy_polarity_ambiguous`.
- v1 no recibe menciones negadas, exclusiones ni campos ejecutables.

## Riesgos pendientes

| Riesgo | Estado |
|---|---|
| Gemini genere el contrato v4 con salida estructurada | NOT PROVEN; no hubo llamada real |
| Negaciones complejas fuera de la matriz (ironía, doble negación) | NOT PROVEN; deben seguir provocando abstención si son ambiguas |
| Integración al endpoint real | No realizada |
| Persistencia de metadatos `preservation` en ledger | No realizada |
| Ejecución comercial | Fuera de alcance; no existe |

## Decisión para futura sonda

El adaptador local está preparado para una primera sonda sintética de Gemini **solamente** si se autoriza una fase posterior con estas condiciones:

1. Preview aislado, cuenta y fixture sintéticos.
2. Ruta temporal de diagnóstico sin afectar el endpoint normal.
3. `execute:false`, sin CRM, Agenda, WhatsApp, Maps, Notion ni Calendar.
4. Una sola solicitud y sin reintentos.
5. Evidencia sanitizada y sin datos de clientes.

Esto no declara la comprensión de Gemini cerrada ni autoriza un despliegue automático.

## Archivos modificados o creados

- Modificado: `PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-understanding-polarity-proposal.js`
- Modificado: `PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-v4-v1-adapter-proposal.js`
- Creado: `scripts/test-yarbi-v4-adapter-hardening-local.cjs`
- Creado: `YARBI_GEMINI_ADAPTADOR_V4_HARDENING_FINAL.md`
- Creado: `YARBI_GEMINI_ADAPTADOR_V4_HARDENING_PRUEBA_LOCAL.json`
- Creado: `YARBI_GEMINI_ADAPTADOR_V4_HARDENING_SHA256SUMS.txt`

## Hashes

Los hashes SHA-256 de los artefactos se registran en `YARBI_GEMINI_ADAPTADOR_V4_HARDENING_SHA256SUMS.txt`.
