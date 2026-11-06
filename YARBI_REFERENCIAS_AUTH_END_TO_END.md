# Yarbi — Referencias autenticadas con owner scope canónico

## Estado

`VALIDADA_LOCALMENTE_PREVIEW_E2E_PENDIENTE`

No se declara `REFERENCIAS_AUTENTICADAS_END_TO_END_VALIDADO_EN_AISLADO` todavía: no se desplegó ni se invocó por HTTP un Preview nuevo. Producción, Vercel remoto, APK, Gemini, WhatsApp, Agenda, Maps, Notion y Calendar no fueron consultados ni modificados en este trabajo.

## Implementación

Se añadió la ruta de solo lectura `POST /api/assistant/reference-candidates` en `api/assistant/reference-candidates.js`.

El recorrido es:

1. La guardia `preview-owner-reference-policy` exige `VERCEL_ENV=preview`, `YARBI_PREVIEW_OWNER_REFERENCES_ONLY=true`, proyecto `uevilhbstnmmdlgyshlv`, URL HTTPS exacta del Supabase aislado, `SUPABASE_SECRET_KEY` y `YARBI_TRACE_HMAC_KEY` configurados. Rechaza modos de preview incompatibles y variables de integraciones externas.
2. `authenticatedOwnerIdentity()` valida el Bearer JWT contra `/auth/v1/user` del Supabase aislado y exige un UUID válido.
3. La ruta no acepta `owner_id`, `contact_ids`, `owner_scope`, `verified_owner_scope`, claves de servicio ni candidatos activos desde el cliente. Esos campos se rechazan antes de leer contactos.
4. `getAuthenticatedOwnerReferenceCandidates()` obtiene el alcance solo desde `yarbi_owner_contact_scope`; posteriormente lee el conjunto acotado de contactos, identificadores y memoria operativa ya permitido por el adaptador existente.
5. `resolveCandidateReference()` aplica la resolución existente sobre esos candidatos. No clasifica texto libre, no llama Gemini y responde siempre `execute:false`.
6. Se crean eventos de trazabilidad con `operation_id` HMAC, evento de inicio, resultado terminal y `operation_closed`. Las referencias de contacto en la traza se hashean; no se registra texto de chat, teléfono, secreto ni scope.

El adaptador autenticado ahora expone `scope_ms` y `authenticated_adapter_ms` sin modificar su contrato previo.

## Archivos modificados

- `api/assistant/reference-candidates.js` — handler aislado y salida compacta.
- `lib/preview-owner-reference-policy.js` — guardia exclusiva del modo de referencias autenticadas.
- `lib/preview-route-policy.js` — incorpora la nueva guardia antes de UI-01.
- `lib/yarbi-owner-ui-auth.js` — extrae validación reutilizable de identidad autenticada; UI-01 conserva su comprobación de owner configurado.
- `lib/yarbi-owner-reference-candidates.js` — métricas de alcance autenticado.
- `tests/owner-reference-candidates-endpoint.test.js` — pruebas de handler real con `fetch` interceptado.

## Pruebas locales realizadas

Se ejecutó:

```powershell
node --check lib\yarbi-owner-ui-auth.js
node --check lib\preview-owner-reference-policy.js
node --check lib\preview-route-policy.js
node --check api\assistant\reference-candidates.js
node --test tests\owner-reference-candidates-endpoint.test.js tests\yarbi-owner-scope.test.js tests\yarbi-owner-reference-candidates.test.js tests\yarbi-owner-conversation.test.js tests\yarbi-contact-resolution.test.js tests\f3f-unified-contact-context.test.js tests\ui01-owner-endpoints.test.js
```

Resultado: **48 aprobadas, 0 fallidas**.

| Criterio | Resultado | Evidencia local |
|---|---|---|
| Sesión autenticada | PASS | `/auth/v1/user` simulado con UUID válido. |
| Sesión inválida | PASS | 401, sin lectura de contactos. |
| Scope vacío | PASS | Sin candidatos ni lectura transversal. |
| Dos dueños con mismo nombre | PASS | A solo recibe `101`; B solo `202`. |
| Teléfono exacto | PASS | Solo devuelve contacto dentro del scope de A. |
| `owner_id` / scope desde cliente | PASS | 400 antes de consultar datos. |
| Método/ruta/entorno incorrectos | PASS | Guardia devuelve 405/403/401; fuera de Preview bloquea. |
| Estado cliente no confiable | PASS | `verified_owner_scope` y candidatos activos se rechazan; no se reutilizan. |
| Comprensión y resolución existente | PASS | El handler usa `resolveCandidateReference`; no añade clasificador libre. |
| Ejecución comercial | PASS | Respuesta fija `execute:false`; no existe ruta de envío/agenda. |
| Trazabilidad | PASS local | Inicio, terminal y cierre en el ledger simulado; `operation_closed` único. |
| Egress | PASS local | Interceptor admite solo `uevilhbstnmmdlgyshlv.supabase.co`; 0 destinos Gemini/WhatsApp/YCloud/Maps/Notion/Calendar. |
| Latencia | PASS local | 20 lecturas simuladas: p95 menor de 250 ms; no equivale aún a latencia remota. |
| HTTP real contra Preview | NOT PROVEN | No se creó deployment ni se configuró el modo remoto de esta ruta. |
| Aislamiento real de Supabase | NOT PROVEN para este handler | El scope canónico ya fue comprobado antes en el proyecto aislado; esta ruta nueva no se invocó remota. |

## Límites deliberados

- No hay Gemini, memoria semántica, clasificación de texto libre, WhatsApp saliente, Agenda, recordatorios ni ejecución automática.
- El cliente no transporta estado reutilizable de candidatos: por seguridad, una futura conversación persistente tendrá que guardar su estado en servidor y volver a validarlo por owner scope.
- El caso histórico sin `msg.id` estable conserva su estado `NOT PROVEN` y no se modifica.

## Paso mínimo para el E2E aislado

Antes de cualquier deployment debe crearse un paquete Preview aislado que contenga únicamente la Function de referencias y sus bibliotecas necesarias. En Vercel Preview deben coexistir exclusivamente:

```ini
VERCEL_ENV=preview
YARBI_PREVIEW_OWNER_REFERENCES_ONLY=true
YARBI_PREVIEW_SUPABASE_PROJECT_REF=uevilhbstnmmdlgyshlv
SUPABASE_URL=https://uevilhbstnmmdlgyshlv.supabase.co
SUPABASE_SECRET_KEY=<solo secreto aislado>
YARBI_TRACE_HMAC_KEY=<secreto exclusivo de preview>
```

Los modos `YARBI_PREVIEW_OWNER_UI_ONLY`, `YARBI_PREVIEW_AUDIT_ONLY`, `YARBI_PREVIEW_FUNCTIONAL_SYNTHETIC_ONLY`, `YARBI_PREVIEW_PROACTIVE_LOOP_ONLY` y `YARBI_PREVIEW_OWNER_ACTION_ONLY` deben quedar desactivados para ese deployment. Después se podrá iniciar sesión con un usuario sintético de cada owner y verificar por HTTP los mismos casos sin usar contactos reales.

## Reversión local

Revertir únicamente los seis archivos listados arriba. No se aplicaron migraciones ni se modificaron servicios externos.
