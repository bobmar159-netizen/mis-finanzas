# Yarbi — endurecimiento semántico antes de autonomía

## Estado

`GEMINI_COMPRENSION_ENDURECIDA_CON_OBSERVACIONES`

La compuerta de seis casos se ejecutó realmente en Preview aislado y se detuvo de forma segura: 15/18 respuestas fueron correctas, pero `F3G-SERVICE` presentó una alucinación de nombre en tres de tres rondas. La batería fresca de 14 no se ejecutó. Este documento no convierte el resultado en aprobado.

## Responsabilidades separadas

| Capa | Responsabilidad vigente | No puede hacer |
|---|---|---|
| Gemini | Extraer señales lingüísticas bajo contrato v1 | Consultar CRM, decidir cuántos candidatos existen, ejecutar acciones o usar datos no enviados. |
| Backend | Validar procedencia, retirar hechos no respaldados, normalizar servicio y tiempo, calcular `semantic_safety` | Inventar hechos para completar una frase. |
| Candidate resolver | Recuperar y comparar candidatos dentro del scope verificado; pedir aclaración si corresponde | Atribuir conocimiento de CRM a Gemini. |
| Política determinista | Decidir si pregunta, espera o propone; siempre `execute=false` en este alcance | Enviar mensajes o cambiar entidades comerciales. |

## Cambios locales realizados

- Nuevo `lib/yarbi-semantic-hardening.js` y copia equivalente del Preview.
- `yarbi.owner-understanding.v2` como salida endurecida; la entrada de Gemini sigue siendo `yarbi.owner-understanding.v1`.
- Procedencia por pista: `utterance`, `conversation_state` o `unknown`; evidencia reducida y señal `semantic_safety` (`safe`, `uncertain`, `unsupported`).
- Normalización acotada: `punto_adicional`, servicios explícitos del catálogo, mañana/tarde/noche, anoche y tiempo aproximado de mes/año.
- Corrección temporal sustituye la pista anterior dentro de la tarea actual.
- La referencia por nombre sin desambiguador queda `partial`; Gemini ya no anuncia una ambigüedad CRM que no puede conocer.
- El endpoint expone solo el resultado semántico sanitizado, su procedencia y el resumen de la barrera; no incorpora teléfonos, IDs ni scope en la salida de comprensión.
- Dataset v2 preparado: 64 frases sintéticas de corrección, pronombres, continuidad, transcripción de voz, lenguaje peruano, tiempo, servicios, contradicción y abstención. No fue ejecutado masivamente.

## Pruebas locales

Las pruebas locales relevantes pasaron **43/43** antes de la llamada real. Cubrieron:

- eliminación de nombre o servicio no respaldado;
- relación histórica sin servicio inventado;
- cancelación ambigua sin alcance inventado;
- sustitución temporal morning → night;
- separación entre referencia parcial y decisión de ambigüedad del resolvedor;
- abstención con `unsupported`;
- scope autenticado, privacidad, `execute=false` y cero egress ajeno a las dependencias simuladas.

## Resultado real de la compuerta

| Criterio | Resultado |
|---|---|
| Cancelación ambigua | PASS 3/3 |
| Day part | PASS 3/3 |
| Corrección temporal | PASS 3/3 |
| Servicio explícito | FAIL 3/3: `invented_name` |
| Referencia parcial | PASS 3/3 |
| Cliente recurrente | PASS 3/3 |
| Contrato v2 | PASS 18/18 |
| Alucinaciones | FAIL: 3/18, todas en servicio |
| Proveedor/timeouts | PASS: 0/0 |
| `execute=false` | PASS 18/18 |

## Hallazgo pendiente

El guard de procedencia actual acepta una cadena como nombre si aparece en la frase, sin distinguir que la misma cadena es un alias de servicio. La siguiente corrección debe introducir validación de tipo para que `target_reference.name` no admita valores pertenecientes al catálogo de servicio, salvo que una regla de estado conversacional lo fundamente de manera explícita.

No se corrigió en este bloque ni se hicieron más llamadas reales: el criterio de detención exigía documentar el fallo sistemático.

## Evidencia y límites

- Evidencia sanitizada: `scripts/gemini-semantic-hardening-real-evidence.json`.
- El Preview usado fue protegido y aislado; no se desplegó Production ni se cambió alias.
- No hubo WhatsApp, Gemini Live, Agenda, CRM write, Maps, Notion, Calendar, APK ni operaciones de producción.
- El caso sin `msg.id` estable sigue fuera de este alcance y no se presenta como demostrado.

## Siguiente paso recomendado (no ejecutado)

Aplicar una corrección mínima y tipada al guard de nombre/servicio, repetir solamente el gate de seis casos y ejecutar los 14 frescos solo si la compuerta queda en 18/18, cero alucinaciones y `execute=false` completo.

---

## Corrección tipada y segunda compuerta — 2 de noviembre de 2026

### Cambio aplicado

La barrera ahora clasifica el papel de una evidencia antes de aceptarla en un
campo. Un alias canónico completo del catálogo es de tipo `service`; una
referencia temporal explícita es de tipo `temporal`. Ninguno puede sostener
`target_reference.name` o `constraints.name` por mera coincidencia léxica.

La única excepción es explícita y estructurada: si el estado conversacional
ya contiene exactamente el nombre, se conserva con fuente
`conversation_state`. No se infiere esa excepción desde el texto entrante.

Cada rechazo tipado se conserva de forma sanitizada en
`semantic_guard.rejected_facts` con `field`, `reason=evidence_type_conflict`
y el tipo de evidencia; no contiene frases, clientes ni secretos.

### Cobertura local nueva

La regresión local pasó **49/49**. Se añadieron casos para:

- `punto adicional`, `reparación` e `instalación nueva` como servicio y nunca
  como nombre;
- `mañana` como referencia temporal y nunca como nombre;
- servicio y nombre independientes: `Punto adicional de Carlos`;
- la excepción de un nombre reservado declarado explícitamente en el estado;
- servicio desconocido, que no se normaliza ni se convierte en nombre por
  descarte.

### Segunda compuerta real

Se creó un único Preview nuevo y aislado:

- Deployment: `dpl_FCSUYqcVuWCVbX62vM87eWDwZv2p`.
- URL: `misfinanzas-backend-e0zstcbjq-omar-dfc4.vercel.app`.
- Target: Preview; sin `--prod`, sin promoción ni cambios de alias.
- Supabase: `uevilhbstnmmdlgyshlv`.

| Criterio | Resultado |
|---|---:|
| Gate de seis familias | 16/18 |
| Contrato v2 válido | 18/18 |
| `execute=false` | 18/18 |
| Errores de proveedor | 0 |
| Timeouts | 0 |
| Alucinaciones | 2: ambas `F3G-SERVICE` / `invented_name` |
| Batería fresca de 14 | No ejecutada |

`F3G-SERVICE` pasó una ronda y falló dos. La evidencia sanitizada conserva la
clasificación `invented_name`, pero deliberadamente no almacena el valor que
Gemini propuso; por tanto la variante textual concreta sigue `NOT PROVEN`.
No es aceptable inferirla ni relajar el evaluador para declarar éxito.

### Latencia observada

| Etapa | n | Mínimo | p50 | p95 | Máximo |
|---|---:|---:|---:|---:|---:|
| Gemini | 18 | 1,936 ms | 2,198 ms | 2,915 ms | 2,915 ms |
| Servidor | 18 | 3,311 ms | 4,212 ms | 4,978 ms | 4,978 ms |

### Estado final de esta corrección

`GEMINI_COMPRENSION_ENDURECIDA_CON_OBSERVACIONES`

La fase se detiene aquí, conforme a la regla acordada: no se ejecutaron los
14 casos frescos, no se modificó el modelo, y no se inició pizarra,
autonomía, WhatsApp, CRM write, Agenda, Maps, voz ni Production.

La siguiente corrección, si se autoriza, debe capturar de forma local y
sanitizada la **clase** de la variante rechazada (por ejemplo, alias envuelto
en una referencia gramatical), ampliar la clasificación por spans completos
sin usar coincidencias parciales agresivas y repetir primero las seis familias.
