# Yarbi — propuesta de contrato compacto para Gemini

Fecha: 2026-11-03  
Estado: **PROPUESTA_LOCAL_NO_ACTIVA — NO APTA AÚN PARA REEMPLAZAR EL CONTRATO ACTIVO**

## Alcance y seguridad

Esta revisión se realizó solamente en el workspace local. No hubo llamadas a Gemini, despliegues, cambios de endpoint, modificaciones de CRM, Agenda, WhatsApp, voz, APK, Vercel, Supabase ni datos comerciales.

El nuevo adaptador es una propuesta local sin importar desde las rutas activas. El contrato público e interno vigente continúa siendo `yarbi.owner-understanding.v1`, seguido por su endurecimiento `yarbi.owner-understanding.v3`.

## Evidencia previa que motiva la propuesta

| Prueba previa aislada | Resultado conocido |
|---|---|
| Esquema completo `responseJsonSchema` | Gemini respondió HTTP 400 `INVALID_ARGUMENT` |
| Misma petición sin `responseJsonSchema` | HTTP 200 |
| Esquema mínimo estructurado | HTTP 200 y JSON válido |

Esto demuestra que la salida estructurada puede funcionar en el entorno aislado y que alguna característica del esquema completo es una causa probable del 400. No demuestra todavía cuál es la característica exacta.

## Auditoría de consumidores del contrato v1

| Componente | Qué recibe / conserva | Por qué no puede eliminarse sin adaptación |
|---|---|---|
| `lib/yarbi-owner-understanding.js` | Normaliza el proveedor: referencia, restricciones, pistas, control, ambigüedad y faltantes | Es la puerta única hacia el formato interno. |
| `lib/yarbi-semantic-hardening.js` | Revalida menciones contra frase/estado, normaliza servicio/tiempo y descarta hechos no respaldados | Es la barrera que evita inventar identidades o filtros. |
| `lib/yarbi-candidate-resolver.js` | `constraints`, `target_reference`, `temporal_clues` y estado activo | Construye consultas y ranking de candidatos. |
| `lib/yarbi-owner-reference-candidates.js` | Restricciones, nombre, servicio, distrito y rango temporal | Recupera candidatos del owner scope sin mezclar clientes. |
| `api/assistant/reference-candidates.js` | Expone una forma sanitizada de v3 a la UI | Depende de los campos históricos aun si algunos vienen vacíos. |

Conclusión: `constraints`, `target_reference` y las listas de pistas no pueden desaparecer de los consumidores actuales. Sí pueden derivarse de una salida de Gemini más pequeña de manera determinista antes de entrar a v1.

## Diagnóstico de redundancia

El esquema completo actual contiene 76 propiedades, 15 objetos, 5 arrays y 68 valores enum. Repite la misma señal lingüística en varias formas:

- Una entidad puede aparecer como `entity_mentions`, como `target_reference` y como `constraints`.
- Servicio, ubicación y tiempo aparecen tanto en `constraints` como en tres arrays de pistas.
- Tres banderas de corrección y dos de continuación codifican una elección mutuamente excluyente.
- El backend ya verifica la evidencia contra la frase/estado; no necesita que Gemini duplique evidencia y derivaciones.

El esquema compacto propuesto tiene 21 propiedades, 4 objetos, 2 arrays y 51 valores enum. Mide 1,995 bytes frente a 5,513 bytes del actual: una reducción de 3,518 bytes (63.8%). El aumento de profundidad máxima de 3 a 4 se limita al objeto `attributes` de una mención y elimina tres familias repetidas de objetos `clue`.

| Métrica | Completo activo | Compacto propuesto |
|---|---:|---:|
| Bytes JSON serializados | 5,513 | 1,995 |
| Propiedades | 76 | 21 |
| Objetos | 15 | 4 |
| Arrays | 5 | 2 |
| Valores enum | 68 | 51 |
| Profundidad máxima | 3 | 4 |

## Contrato compacto propuesto

Esquema de entrada para Gemini: `yarbi.owner-understanding.compact.v1`.

Campos obligatorios:

```text
schema
intent
conversational_act
target_type
mentions[]: kind, value, source, certainty, polarity, attributes?
control: correction, continuation, cancel_scope
confidence
ambiguity
missing_information[]
```

Los enums de `intent`, `conversational_act`, `target_type`, tipos de mención y alcance de cancelación se reutilizan desde v1. No incorpora identificadores CRM, teléfonos, candidatos ni campos ejecutables.

### Qué corresponde al proveedor y qué al backend

| Dato | Fuente / responsable |
|---|---|
| Intento, acto conversacional, tipo de objetivo, spans/menciones, control explícito, ambigüedad y faltantes | Gemini compacto, sin resolver identidades |
| `target_reference`, `constraints`, `temporal_clues`, `location_clues`, `service_clues` | Adaptador determinista desde menciones afirmadas |
| Canonicalización de servicio, validación contra frase/estado, evidencia final, seguridad semántica y ranking | Hardener/resolvedor existentes |
| Identidad CRM, contactos, acciones, agenda o WhatsApp | Nunca el proveedor ni el adaptador |

## Adaptador local propuesto

Archivo nuevo: `PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-compact-understanding-adapter.js`.

`compactToProviderV1(...)` valida el contrato compacto y sólo entonces construye la forma que `normalizeUnderstanding(...)` ya admite. No altera el hardener ni los consumidores.

Reglas principales:

1. Un `proper_name` afirmado genera `target_reference.name` y `constraints.name`.
2. Servicio, ubicación y tiempo afirmados generan sus pistas v1 equivalentes.
3. `control.correction` y `control.continuation` se expanden en las banderas históricas existentes.
4. El backend continúa revisando que cada dato esté respaldado por frase o estado.
5. Entrada malformada devuelve un código explícito y no se adapta.

### Límite crítico: negación y contradicción

El hardener v3 reduce una mención a `confirmed | approximate | inferred`; no conserva `polarity` ni una contradicción tipada. Convertir “no reparación” o una mención contradicha a una pista positiva cambiaría el significado y podría resolver al cliente equivocado.

Por ello el adaptador local **rechaza de forma segura** menciones `negated` o `contradicted` con el código:

```text
compact_polarity_not_representable_by_v1
```

Esto conserva seguridad, pero significa que el contrato compacto aún no es equivalente para correcciones/contradicciones. Antes de reemplazar el contrato activo hace falta una decisión de diseño explícita: ampliar v1/v3 de manera compatible para conservar polaridad, o acotar formalmente qué tipos de negación se resuelven fuera de Gemini. Esta propuesta no realiza ninguna de esas modificaciones.

## Validación local

Comando ejecutado:

```powershell
node .\scripts\test-yarbi-compact-understanding-local.cjs
```

Resultado: **12/12 PASS**, `network_calls: 0`.

| Caso | Resultado |
|---|---|
| Nombre propio explícito | PASS |
| Servicio no tratado como nombre | PASS |
| Ubicación como pista | PASS |
| Franja temporal | PASS |
| Corrección | PASS |
| Cancelación ambigua | PASS |
| Continuidad/anaphora | PASS |
| Ambigüedad y datos faltantes | PASS |
| Contradicción rechazada de forma segura | PASS |
| Negación rechazada de forma segura | PASS |
| Payload malformado | PASS |
| Enums compartidos con v1 | PASS |

Las pruebas recorren adaptador → `normalizeUnderstanding` → `hardenUnderstanding` para los casos adaptables. No prueban Gemini ni servicios remotos.

## Conservación de información

| Dimensión requerida | Estado |
|---|---|
| Intento, acto, tipo de referencia | Conservada |
| Menciones tipadas y nombre propio explícito | Conservada y revalidada |
| Servicio, ubicación y tiempo aproximado | Conservada mediante adaptación y hardening |
| Corrección, continuidad, cancelación, ambigüedad, faltantes | Conservada |
| Procedencia/evidencia | Propuesta transporta `source`; el hardener vuelve a derivar evidencia segura |
| Negación / contradicción | **No equivalente; rechazo seguro** |

## Hipótesis de latencia

La sonda mínima anterior observó aproximadamente 891 ms de Gemini y 6,798 ms de tiempo de servidor. Reducir el esquema en 63.8% puede reducir serialización, tokens de esquema y validación del proveedor, pero **no prueba** que elimine los ~5.9 s restantes: allí pueden intervenir autenticación, cold start, transporte o instrumentación. Se requieren métricas por etapa antes de afirmar una mejora de latencia.

## Riesgos y decisión

| Riesgo | Estado |
|---|---|
| El error 400 provenga de una propiedad específica, no sólo del tamaño | NOT PROVEN |
| Conservación de negación/contradicción en v1/v3 | BLOCKED para reemplazo |
| Regresión de consumidores v1 | Reducido: el adaptador genera v1 y pasó la ruta local hasta hardening |
| Llamadas/acciones externas | No aplicables; ninguna ejecutada |

Decisión: **no conectar este adaptador a la ruta Gemini activa ni desplegarlo todavía**. Es una propuesta técnicamente útil y segura para casos afirmativos, pero no cumple equivalencia total por la polaridad no representable.

## Protocolo para una futura sonda única (no ejecutado)

1. Autorizar explícitamente una fase que resuelva o acote la representación de polaridad.
2. Añadir una ruta diagnóstica Preview aislada, desactivada por defecto, que use `execute:false`, fixture sintético y sin CRM/Agenda/WhatsApp.
3. Verificar localmente la matriz de equivalencia y una lista de rechazos seguros.
4. Confirmar deployment Preview, owner sintético, Supabase aislado y cero reintentos.
5. Ejecutar **una sola** llamada con el esquema compacto, leer evidencia sanitizada y detenerse.

No corresponde hacer esa sonda bajo el alcance de esta fase.

## Archivos creados

- `PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-compact-understanding-adapter.js`
- `scripts/test-yarbi-compact-understanding-local.cjs`
- Este informe.

## Hashes relevantes

Se registran en `YARBI_GEMINI_CONTRATO_COMPACTO_SHA256SUMS.txt`.
