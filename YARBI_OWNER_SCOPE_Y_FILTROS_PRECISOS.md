# Yarbi — owner scope verificable y filtros precisos

## Resultado

`BLOQUEADO_PARA_INTEGRACION_REMOTA_POR_OWNER_SCOPE_FALTANTE`

El adaptador local y sus filtros precisos están validados. No se aplicó ninguna migración ni se escribió dato alguno en `yarbi-audit-preview`. Falta autorizar y aplicar una relación canónica entre la cuenta autenticada y los contactos antes de conectar este adaptador a datos remotos.

## Inventario remoto de solo lectura

Proyecto inspeccionado: `yarbi-audit-preview` (`uevilhbstnmmdlgyshlv`).

- `crm_contacts`, `contact_identifiers`, `yarbi_contact_operational_memory`, `whatsapp_messages` y `ai_message_analysis` tienen RLS habilitado.
- No existen políticas RLS sobre esas cinco tablas en el catálogo observado.
- `crm_contacts` no posee columna `owner_id`, `account_id`, `workspace_id`, `business_id` ni `user_id`.
- No se encontró una tabla intermedia que relacione `auth.users` con `crm_contacts`.
- Las relaciones verificadas hacia contactos son técnicas: análisis, identificadores, mensajes, memoria, órdenes e inbox del dueño.
- `yarbi_owner_inbox`, `yarbi_owner_action_decisions`, `yarbi_owner_notification_state` y `yarbi_proactive_runs` usan `owner_key` textual para la bandeja, pero no lo vinculan a contactos ni a `auth.users`.
- Las funciones existentes de dueño gestionan bandeja/decisiones; ninguna devuelve el alcance de contactos de una cuenta.

No se leyeron filas de clientes, conversaciones, teléfonos ni mensajes.

## Propuesta mínima pendiente de autorización

Archivo: `migrations/PROPOSED_20261101_yarbi_owner_contact_scope.sql`.

Propone una sola relación canónica:

`auth.users.id (owner_account_id) → yarbi_owner_contact_scope → crm_contacts.id`

Propiedades:

- clave primaria `(owner_account_id, contact_id)` para impedir duplicados;
- no duplica nombre, teléfono, servicio ni conversación;
- FK con cascada al borrar dueño o contacto;
- índice inverso por contacto;
- RLS y lectura del propio usuario autenticado;
- preflight que aborta si la tabla ya existe o si `crm_contacts.id` no es `bigint`.

Es una propuesta local: **no fue ejecutada**. Antes de aplicarla debe revisarse la política de `service_role`, la compatibilidad con las ACL reales y cómo se poblará el primer alcance sin inventar pertenencias.

## Cambios locales

### `lib/yarbi-owner-reference-candidates.js`

- El scope ya no se acepta como una lista manual de producción. Exige `ownerScopeResolver` o un scope previamente verificado y marcado explícitamente para reutilización.
- `createFixtureOwnerScopeResolver()` solo existe para pruebas sintéticas.
- Falla cerrado con `owner_scope_unavailable` o `owner_scope_unverified` antes de leer almacenamiento.
- Distrito se consulta en `yarbi_contact_operational_memory` dentro del scope **antes** de consultar/limitar `crm_contacts`.
- `latest_service` se filtra en `crm_contacts` antes del límite final.
- Teléfono exacto continúa comenzando por `contact_identifiers`.
- Las franjas horarias se centralizan en `TIME_BANDS`; requieren zona horaria explícita.
  - mañana: 06:00–12:00;
  - tarde: 12:00–18:00;
  - evening/noche: 18:00–24:00;
  - `anoche` usa el día local anterior si llega como `days: 1, day_part: night`.
- Las pistas aproximadas conservan tolerancia de ±21 días. Las intradía usan límites exactos locales.
- Reutilizar candidatos activos no consulta Supabase cuando contiene un scope verificado reutilizable.
- No hay lecturas de `whatsapp_messages`, ni Gemini, ni acciones comerciales, ni egress HTTP externo.

## Estrategias y rendimiento

| Estrategia | Consultas | Límite aplicado después de |
|---|---:|---|
| Reutilización activa | 0 | no aplica |
| Nombre/servicio/tiempo | 3 | filtros de `crm_contacts` |
| Teléfono exacto | 3 | `contact_identifiers` exacto |
| Distrito estructurado | 4 | memoria por distrito y luego `crm_contacts` |

La búsqueda por distrito usa una consulta acotada por owner scope (máximo 96 IDs). La cuarta lectura recupera memoria complementaria sin N+1. Se prioriza corrección sobre forzar artificialmente tres lecturas.

## Pruebas locales

Ejecutado:

```text
node --test tests\yarbi-owner-reference-candidates.test.js tests\yarbi-owner-conversation.test.js tests\yarbi-contact-resolution.test.js tests\f3f-unified-contact-context.test.js
```

Resultado: **36 PASS, 0 FAIL**.

| Criterio | Resultado | Evidencia |
|---|---|---|
| A. Dos dueños, nombres parecidos | PASS | scopes sintéticos disjuntos |
| B. Scope ausente | PASS | cero lecturas, fail closed |
| C. Distrito antes del límite | PASS | Comas antiguo aparece aunque 20 recientes de Ate no coincidan |
| D. Servicio antes del límite | PASS | `latest_service=eq.punto_adicional` en la lectura de contactos |
| E. Esta mañana | PASS | 06:00–12:00 `America/Lima` |
| F. Anoche | PASS | 18:00–24:00 del día local anterior |
| G. Hace como un mes | PASS | tolerancia aproximada conservada |
| H. Segunda pista | PASS | 0 consultas al reutilizar candidatos activos |
| I. Teléfono exacto | PASS | empieza en `contact_identifiers` |
| J. Chats completos | PASS | ninguna ruta `whatsapp_messages` |
| K. Egress | PASS | solo rutas REST inyectadas de Supabase |
| L. Regresiones | PASS | 36/36 total |

## Limitaciones

- `owner_contact_scope` no existe todavía: por ello la integración remota real sigue bloqueada y no se declaró validada en el proyecto aislado.
- La población inicial del scope debe venir de una fuente que el dueño pueda verificar; no se debe inferir desde chats o usar arrays permanentes.
- El caso de mensajes sin `msg.id` estable conserva su estado previo `NOT PROVEN`.
- Esta etapa no integra Gemini, memoria semántica, Agenda, WhatsApp, Maps, Notion ni Calendar.

## Seguridad y alcance

No se modificaron Supabase, producción, Vercel, APK, CRM, Agenda, WhatsApp, Gemini, Maps, Notion ni Calendar. La consulta remota fue únicamente de metadatos sobre el proyecto aislado.

## Próximo paso mínimo recomendado

Revisar y autorizar de forma independiente la propuesta de `yarbi_owner_contact_scope`; después aplicar solo esa migración al proyecto aislado, poblarla exclusivamente con fixtures sintéticos de dos dueños y validar el adaptador contra el scope canónico real.
