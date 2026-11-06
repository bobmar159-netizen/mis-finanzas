# Owner scope canónico — validación aislada

## Resultado

`OWNER_SCOPE_Y_CANDIDATOS_VALIDADO_EN_AISLADO`

## Preflight remoto, solo metadatos

- Proyecto visible en el editor: `yarbi-audit-preview`.
- `project_ref` confirmado en URL: `uevilhbstnmmdlgyshlv`.
- `public.crm_contacts` existe.
- `crm_contacts.id`: `bigint`, `NOT NULL`.
- `public.yarbi_owner_contact_scope`: ausente en el preflight y creada después
  mediante la transacción aislada autorizada.
- RLS de `crm_contacts`: activo.
- `service_role` tiene lectura efectiva de `crm_contacts`; `anon` y `authenticated` no la tienen.
- No se leyeron filas de mensajes, clientes ni conversaciones.

## Relación canónica aplicada en aislado

`auth.users.id → public.yarbi_owner_contact_scope.owner_account_id → public.crm_contacts.id`

- PK compuesta: `(owner_account_id, contact_id)`.
- FK al dueño y al contacto con `ON DELETE CASCADE`.
- Índice inverso para recuperación por contacto.
- RLS activo.
- `anon` y `authenticated`: sin `SELECT`.
- `service_role`: `SELECT` efectivo, exclusivamente para el backend.
- No se creó política de acceso directo para frontend autenticado; el alcance se
  resuelve desde backend con una identidad previamente validada.

## Implementación local

- `lib/yarbi-owner-scope.js` concentra la resolución verificable.
  - Requiere `{ kind: 'validated_auth_identity', subject: <uuid> }`.
  - Rechaza identidades sin validar antes de consultar.
  - Lee únicamente `yarbi_owner_contact_scope`.
  - Nunca recibe una lista de contactos desde el cliente.
- `lib/yarbi-owner-reference-candidates.js` añade
  `getAuthenticatedOwnerReferenceCandidates(...)`, que obtiene el alcance
  exclusivamente de la relación canónica antes de leer candidatos.
- `migrations/20261101_owner_contact_scope_isolated.sql` propone la relación
  `auth.users.id -> yarbi_owner_contact_scope -> crm_contacts.id`, PK compuesta,
  índice inverso, RLS, sin política de lectura directa para `authenticated` y
  con `SELECT` mínimo para `service_role`.

## Pruebas locales aprobadas

`node --test tests\\yarbi-owner-scope.test.js tests\\yarbi-owner-reference-candidates.test.js tests\\yarbi-owner-conversation.test.js tests\\yarbi-contact-resolution.test.js tests\\f3f-unified-contact-context.test.js`

Resultado: 41 aprobadas, 0 fallidas.

Cubierto localmente:

- separación de dos dueños con contactos de nombre equivalente;
- fallo cerrado sin una identidad autenticada verificable;
- scope vacío sin búsquedas alternativas;
- recuperación acotada sin leer chats ni análisis;
- compatibilidad de referencias, identidad y contexto unificado existentes.

## Validación remota con fixtures F3S

Se crearon exclusivamente dos dueños de prueba y cuatro contactos con prefijo
`YARBI-OWNER-SCOPE-*`, teléfonos ficticios `90000000*` y memoria de distrito
sintética. No se insertaron mensajes, conversaciones, agenda, alertas ni
acciones comerciales.

| Criterio | Resultado | Evidencia |
| --- | --- | --- |
| Dos dueños, mismo nombre | PASS | Cada scope contiene 2 contactos; ambos incluyen un nombre sintético equivalente sin cruce. |
| Separación estricta | PASS | `shared_fixture_contacts = 0`. |
| Scope explícito | PASS | 4 relaciones y 4 contactos distintos; ninguna pertenencia se derivó de texto o teléfono. |
| Distrito | PASS | Comas se recupera dentro de cada scope antes del candidato final. |
| Servicio | PASS | `reparacion` se limita al contacto sintético correspondiente de cada dueño. |
| Teléfono exacto | PASS | `900000001` existe solo para el dueño A y está excluido del B. |
| Scope ausente | PASS local | El resolver devuelve `owner_scope_empty` y no consulta contactos ni chats. |
| Identidad no validada | PASS local | Rechazo previo a cualquier consulta. |
| Reutilización progresiva | PASS local | Los candidatos activos reutilizan el scope ya verificado con cero lecturas. |
| Franja horaria y referencia aproximada | PASS local | Ventanas explícitas con zona horaria y tolerancia documentada. |
| Sin lectura de chats | PASS local | Los tests cubren únicamente scope, contactos, identificadores y memoria operacional. |
| Egress comercial | PASS local | El adaptador no llama Gemini, WhatsApp, Maps, Notion, Calendar ni Agenda. |
| Backend `service_role` | PASS remoto | Consulta bajo `SET LOCAL ROLE service_role`, cerrada con `ROLLBACK`: 4 scopes, 2 dueños y 4 contactos. |

## Contratos remotos observados

```text
synthetic_contacts=4
owner_a_contacts=2
owner_b_contacts=2
scoped_fixture_contacts=4
distinct_scoped_fixture_contacts=4
shared_fixture_contacts=0
scope_rls=true
anon_select=false
authenticated_select=false
service_role_select=true
```

Todas las assertions funcionales de nombre, distrito, servicio y teléfono
retornaron `true`.

## Límites preservados

No se integraron Gemini, WhatsApp, Agenda, Calendar, Maps, Notion, Vercel,
producción ni APK. La pertenencia no se infiere desde nombre, teléfono,
ubicación, mensajes ni memoria.

## Pendiente recomendado

Conectar `getAuthenticatedOwnerReferenceCandidates(...)` a la ruta del dueño
que ya valide sesión en backend. Esa integración debe conservar el contrato de
`validated_auth_identity`; no debe aceptar `owner_id` ni `contact_ids` desde el
cliente.
