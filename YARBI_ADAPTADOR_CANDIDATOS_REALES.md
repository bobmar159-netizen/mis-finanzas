# Yarbi — Adaptador acotado de candidatos reales

## Resultado

`ADAPTADOR_CANDIDATOS_REALES_VALIDADO_LOCALMENTE`

La implementación queda deliberadamente fuera de handlers, UI y cualquier ruta de acción. Produce candidatos compactos y el resolvedor conversacional existente conserva la decisión, descartes y pregunta mínima. Todas las propuestas de conversación siguen siendo `execute:false`.

## Inventario remoto aislado (solo metadatos)

Proyecto consultado exclusivamente: `yarbi-audit-preview` (`uevilhbstnmmdlgyshlv`). No se leyeron filas de clientes ni mensajes.

| Fuente | Campos utilizables | Uso |
|---|---|---|
| `crm_contacts` | `id`, `display_name`, `full_name`, `commercial_status`, `latest_service`, `last_contact_at` | Identidad visible, temperatura, servicio actual, actividad reciente. |
| `contact_identifiers` | `contact_id`, `identifier_type`, `identifier_value`, `normalized_value`, `is_primary` | Búsqueda exacta por teléfono y teléfonos del candidato. |
| `yarbi_contact_operational_memory` | `contact_id`, `memory_type`, `value`, `occurred_at`, `state` | Distrito, ubicación y paso operativo, únicamente activos. |
| `whatsapp_messages` | Solo relación de esquema; **no se consulta** | Excluida para no escanear historiales. |
| `ai_message_analysis` | Solo relación de esquema; **no se consulta** | Excluida del adaptador. |

No existen en el proyecto aislado tablas de agenda, visitas ni servicios históricos. Por tanto, una visita completada y un servicio histórico se exponen como `not_available`, nunca se inventan.

El catálogo no expone un campo o relación de propietario sobre `crm_contacts`. Para impedir que una búsqueda salte de un dueño a otro, el adaptador exige `ownerScope = { owner_id, contact_ids }` coincidente con el dueño autenticado y falla cerrado ante cualquier ausencia, discrepancia o ámbito mayor de 96 contactos. Esta es la razón por la que aún no se crearon fixtures remotos: no es seguro certificar el caso de otro propietario sin una fuente estructurada de pertenencia.

## Arquitectura y consultas

Archivo nuevo: `lib/yarbi-owner-reference-candidates.js`.

`turno → comprensión v1 → restricciones → getOwnerReferenceCandidates → resolver existente → candidate-search-state → propuesta execute:false`

- Reutiliza candidatos activos de la conversación: 0 consultas.
- Teléfono exacto: identificador, contactos y memoria: 3 consultas acotadas.
- Nombre/distrito/tiempo: contactos, identificadores y memoria: 3 consultas acotadas.
- Máximo 8 candidatos; no consulta conversaciones completas ni llama Gemini, Maps, Agenda, WhatsApp, Notion o Calendar.
- La actividad aproximada mantiene ventanas flexibles (por ejemplo, ±21 días) para no eliminar un cliente de cinco semanas solo porque se recordó “un mes”.

Cada candidato conserva la procedencia de distrito, ubicación, servicio y último contacto. Estado del proceso, temperatura comercial y acción recomendada siguen separados.

## Pruebas locales

`node --test tests/yarbi-owner-reference-candidates.test.js tests/yarbi-owner-conversation.test.js tests/yarbi-contact-resolution.test.js tests/f3f-unified-contact-context.test.js`

Resultado: **37 PASS, 0 FAIL**. Las fixtures locales usan únicamente el prefijo `YARBI-REF-REAL-`, teléfonos sintéticos y el propietario `F3R-owner`.

| Criterio | Estado | Evidencia |
|---|---|---|
| Carlos + Comas | PASS | Recupera candidatos compactos; el resolvedor escoge el nombre exacto. |
| Dos Carlos de Comas | PASS | Ambos llegan al resolvedor; solicita una única aclaración. |
| Esta mañana / mes aproximado | PASS | Aplica ventana temporal acotada sin perder cinco semanas. |
| Visita e histórico | NOT PROVEN | El aislado no tiene fuente estructurada de visita completada ni servicio histórico. |
| Recurrente / mismo nombre | PASS | Mantiene `contact_id` y teléfonos separados. |
| Corrección / búsqueda progresiva | PASS | Conserva descartes y reutiliza candidatos sin reconsultar. |
| Inexistente | PASS | Devuelve cero; no inventa. |
| Otro owner | PASS local / NOT PROVEN remoto | Falla cerrado si el alcance no es verificable; falta pertenencia real remota. |
| Cero egress externo | PASS local | El adaptador solo acepta un cliente Supabase inyectado; las pruebas registran rutas REST y no hay hosts externos. |

Medición observada local: 0 consultas al reutilizar contexto; 3 en búsquedas de almacenamiento; suite completa de regresión directa en ~107 ms.

## Archivos modificados

- `lib/yarbi-owner-reference-candidates.js`
- `tests/yarbi-owner-reference-candidates.test.js`
- `YARBI_ADAPTADOR_CANDIDATOS_REALES.md`
- `YARBI_ADAPTADOR_CANDIDATOS_REALES_SHA256SUMS.txt`

## Límites y siguiente paso recomendado

No hubo fixtures ni escrituras remotas, no se consultó producción y no se tocó Vercel, APK, CRM/Agenda reales ni integraciones externas.

Para validación aislada remota falta, como paso más pequeño, una fuente verificable de pertenencia `owner → contactos` (campo, relación o RPC de solo lectura ya autorizada). Con ello se podrán crear fixtures sintéticos `YARBI-REF-REAL-*` y probar el adaptador contra datos reales aislados sin abrir datos de otro dueño. No se requiere Gemini para ese paso.
