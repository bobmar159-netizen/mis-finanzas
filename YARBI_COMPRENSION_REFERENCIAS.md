# Yarbi — comprensión conversacional y resolución de referencias

## Resultado local

`COMPRENSION_Y_RESOLUCION_ESTRUCTURADA_VALIDADA_LOCALMENTE`

Esta entrega interpreta un turno del dueño mediante un proveedor desacoplado,
mantiene una tarea conversacional compacta, clasifica candidatos de forma
explicable y devuelve una propuesta estructurada con `execute: false`.
No ejecuta ni programa acciones comerciales.

## Inventario previo

| Componente existente | Uso en esta integración | Cambio |
| --- | --- | --- |
| `crm_contacts` y `contact_identifiers` | Fuente conceptual de identidad estable | No modificado. |
| `lib/yarbi-contact-resolution.js` | Identidad canónica por teléfono (F3A) | No reemplazado. |
| `lib/yarbi-commercial-context.js` | Servicio/estado comercial estructurado (F3B/3C) | No modificado. |
| `lib/yarbi-unified-contact-context.js` | Contexto acotado de contacto, teléfono y memoria activa (F3F) | Reutilizable como adaptador de candidatos; no modificado. |
| `lib/yarbi-next-best-action.js` y módulos 3G–3K | Propuestas y autorización del dueño | No invocados. |
| `api/assistant/command.js` | Ruta histórica Gemini/acciones y foco de conversación | No modificado: podría ejecutar flujos fuera de alcance. |
| `api/ai/process.js` | Procesamiento de WhatsApp, memoria, CRM y Agenda | No modificado. |
| `agenda_events` / CRM / memoria / navegación | Datos y UI existentes | No leídos ni modificados en pruebas. |

No existía un contrato local versionado para comprender referencias del dueño ni
un resolvedor de candidatos separado del modelo.

## Arquitectura añadida

```text
turno del dueño
  -> proveedor de comprensión (fake en pruebas; Gemini futuro)
  -> yarbi.owner-understanding.v1 validado
  -> estado compacto de conversación
  -> yarbi.candidate-search-state.v1 explicable
  -> propuesta estructurada (execute: false)
```

### Contratos

- `yarbi.owner-understanding.v1`: intención, acto conversacional, referencia,
  restricciones, correcciones, continuidad, alcance de cancelación, pistas
  temporales/ubicación/servicio, confianza y ambigüedad.
- `yarbi.owner-conversation.v1`: tarea, entidad activa/seleccionada,
  descartes de esta tarea, candidatos, filtros, última pregunta, correcciones,
  origen del módulo/objeto visual y resultado.
- `yarbi.candidate-search-state.v1`: consulta entendida, filtros con certeza,
  candidatos ordenados, razones, contradicciones, descartes y pregunta útil.

El modelo o proveedor interpreta el lenguaje; el resolvedor determina la fila
mediante señales explícitas: ID, teléfono, foco activo, nombre, distrito,
servicio, ubicación, visita, recencia y hora aproximada. Cada coincidencia
incluye peso y razón visibles; no hay selección opaca ni aleatoria.

## Reglas de seguridad y rendimiento

- El proveedor recibe como máximo ocho candidatos compactos, nunca el CRM ni
  historiales completos.
- Las expresiones aproximadas reducen el ranking, pero no descartan por sí
  solas a un candidato real.
- Una cancelación ambigua devuelve una sola pregunta y `execute: false`.
- La capa no contiene `fetch`, SDK Gemini, escritura a Supabase, Agenda, CRM,
  WhatsApp, Maps, Notion, Calendar ni integración de salida.
- Una respuesta inválida del proveedor no produce propuesta ni efecto.

## Archivos modificados

- `lib/yarbi-owner-understanding.js`
- `lib/yarbi-candidate-resolver.js`
- `lib/yarbi-owner-conversation.js`
- `tests/yarbi-owner-conversation.test.js`

## Pruebas locales

Se ejecutaron 24 pruebas: **24 PASS, 0 FAIL**.

| Escenario | Resultado |
| --- | --- |
| A. Carlos → Carlos de Comas | PASS: resuelve sin otra pregunta. |
| B. Corrección de cliente abierto | PASS: descarta solo para la tarea y conserva contexto. |
| C. Escribió en la mañana → Ivón | PASS: conserva filtro temporal y resuelve. |
| D/E. Ventanilla, visita, hace un mes | PASS: usa la pista como aproximada, no elimina cinco semanas. |
| F. “Ese mismo” | PASS: mantiene la entidad activa. |
| G/H. “Déjalo” / “Cancela eso” | PASS: cancela la tarea o pide confirmación; no ejecuta. |
| I/K. Dos Carlos con mismo nombre | PASS: no fusiona; formula una sola pregunta útil. |
| J. Cliente recurrente | PASS: diferencia el contacto de su servicio histórico. |
| L. Actual frente a historial | PASS: prevalece el foco actual salvo evidencia fuerte. |
| Privacidad y latencia | PASS: contexto limitado a 8 candidatos; recorrido unitario bajo 100 ms. |
| Proveedor inválido | PASS: queda sin propuesta ejecutable. |

También pasaron las regresiones relevantes de identidad F3A y contexto unificado
F3F. Las pruebas usan candidatos sintéticos; no hubo red, Gemini, Supabase ni
datos de clientes.

## Límites y puntos `NOT PROVEN`

- `NOT PROVEN`: comprensión Gemini real. Las pruebas usan un proveedor fake
  que entrega el contrato estructurado; no se hicieron llamadas de IA.
- `NOT PROVEN`: carga real de candidatos desde CRM/Agenda/memoria. La capa es
  pura y recibe candidatos acotados; el adaptador de lectura deberá aprobarse
  separadamente.
- `NOT PROVEN`: conversación de voz y UI del chat. Esta fase no toca UI-01,
  Live ni APK.
- `NOT PROVEN`: caso sin `msg.id` estable, deuda técnica previa existente.

## Siguiente paso recomendado

Integrar un adaptador de lectura acotada que forme candidatos a partir de
`yarbi.unified-contact.v1`, seguido de una prueba aislada con un proveedor
Gemini configurado para **solo comprensión**. Esa fase debe mantener
`execute: false` y no habilitar CRM, Agenda ni WhatsApp saliente.

## Integridad

Los SHA-256 de estos cuatro artefactos se publican en
`YARBI_COMPRENSION_REFERENCIAS_SHA256SUMS.txt`.
