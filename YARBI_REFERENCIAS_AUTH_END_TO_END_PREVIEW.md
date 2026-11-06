# Yarbi — Referencias autenticadas E2E en Preview aislado

## Resultado final

`REFERENCIAS_AUTENTICADAS_END_TO_END_VALIDADO_EN_AISLADO`

Alcance validado exclusivamente contra `yarbi-audit-preview` (`uevilhbstnmmdlgyshlv`). No se consultaron ni modificaron Production, Vercel Production, APK, CRM real, Agenda, WhatsApp, Gemini, Maps, Notion, Calendar ni cron.

## Preview validado

- URL: `https://misfinanzas-backend-2y04kg0c0-omar-dfc4.vercel.app`
- Deployment: `dpl_H58xLqTZJnt2Go4DxNQN2ha3jsgV`
- Inspector: `https://vercel.com/omar-dfc4/misfinanzas-backend/H58xLqTZJnt2Go4DxNQN2ha3jsgV`
- Entorno: Preview; `productionUrl: null`.
- Function desplegada: solo `api/assistant/reference-candidates`.
- Destino permitido: solo `https://uevilhbstnmmdlgyshlv.supabase.co`.

## Corrección de semántica de solo lectura

El handler ya devolvía correctamente `execute: false`. El defecto estaba en el runner local: al sanitizar una respuesta, la expresión `body.execute === false` se guardaba como `true` cuando la respuesta era correctamente de solo lectura. Eso podía documentar lo contrario de lo que el endpoint había respondido.

Se corrigió el runner para conservar el valor real (`false`), agregar `is_read_only: true` y exigir explícitamente `execute === false` en los casos positivos. Las pruebas unitarias del endpoint pasaron: 5/5.

No se modificó la semántica comercial del handler ni se habilitó una acción externa.

## Validación HTTP autenticada

| Criterio | Resultado | Evidencia |
|---|---|---|
| Sesión real owner A y owner B | PASS | Ambos autenticaron en el Supabase aislado. |
| Scope por owner | PASS | El mismo nombre devolvió candidatos distintos y disjuntos. |
| Teléfono cruzado | PASS | El teléfono del scope A no fue visible desde B. |
| Filtros de distrito, servicio y tiempo | PASS | Solo devolvieron candidatos permitidos del scope correspondiente. |
| JWT inválido | PASS | Rechazado con `401 owner_reference_unauthorized`. |
| Usuario válido sin scope | PASS | `owner_scope_empty`, cero candidatos. |
| Inyección de `owner_id` o scope cliente | PASS | Rechazada con `400 owner_scope_client_input_forbidden`. |
| Contrato de lectura | PASS | Todas las respuestas positivas guardaron `execute:false` e `is_read_only:true`. |
| Egress comercial | PASS | No hubo Gemini, WhatsApp/YCloud, Maps, Notion, Calendar ni producción. |

La evidencia de HTTP usa `status_source: response_contract_fallback` en Windows cuando `vercel curl` no devolvió el marcador opcional de código. El cuerpo JSON se validó contra el contrato estricto; una respuesta desconocida sigue siendo fallo.

## Ledger y trazabilidad remota

La lectura posterior fue exclusivamente de trazas sanitizadas del proyecto aislado.

- Operaciones esperadas y reconstruidas: **29**.
- Cada operación conserva inicio, evento terminal y exactamente un `operation_closed`.
- Las referencias se conservan solo cuando corresponden; no se exportaron teléfonos, nombres, texto de chats, JWT, claves ni UUID reales.
- La evidencia de trazas confirma que no quedan operaciones de esta ejecución sin cierre.

## Línea base de rendimiento

| Métrica | p50 | p95 | Máximo |
|---|---:|---:|---:|
| Procesamiento del servidor | 2,771 ms | 3,346 ms | 3,621 ms |
| Autenticación | 400 ms | 571 ms | 620 ms |
| Owner scope | 428 ms | 502 ms | 636 ms |
| Consulta de candidatos | 628 ms | 873 ms | 960 ms |
| Enriquecimiento | 218 ms | 483 ms | 488 ms |
| Resolución | 0 ms | 0 ms | 1 ms |
| Trazabilidad | 1,056 ms | 1,232 ms | 1,248 ms |
| Otros overheads del handler | 0 ms | 1 ms | 4 ms |
| Overhead CLI local (Windows + `vercel curl`) | 10,945 ms | 31,858 ms | 36,452 ms |

La latencia total p95 observada desde el runner fue 33,808 ms, pero incluye procesos nuevos de `vercel curl`, protección del deployment y red local. No se presenta como tiempo de respuesta del usuario final. El tiempo del handler p95 fue 3,346 ms. El recorrido HTTP persistente de navegador queda `NOT PROVEN` porque Deployment Protection no permitió usarlo como sustituto del mecanismo autenticado de prueba.

No se aplicó una optimización ciega: la mayor contribución del handler es el registro de trazabilidad, que debe conservar su contrato append-only antes de alterar su comportamiento.

## Archivos y evidencias relevantes

- `api/assistant/reference-candidates.js`
- `lib/yarbi-owner-reference-candidates.js`
- `tests/owner-reference-candidates-endpoint.test.js`
- `PREVIEW_REFERENCIAS_AISLADO/api/assistant/reference-candidates.js`
- `PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-owner-reference-candidates.js`
- `scripts/run-owner-references-preview-e2e.cjs`
- `scripts/read-owner-references-preview-traces.cjs`
- `scripts/owner-references-preview-e2e-evidence.json`
- `scripts/owner-references-preview-trace-evidence.json`

Los hashes SHA-256 definitivos figuran en `YARBI_REFERENCIAS_AUTH_END_TO_END_PREVIEW_SHA256SUMS.txt`.

## Pendiente acotado

`NOT PROVEN`: medir el endpoint desde un cliente HTTP persistente que pase Deployment Protection sin utilizar bypasses ni habilitar rutas adicionales. No bloquea la validación aislada de seguridad, scope, contrato de solo lectura ni reconstrucción del ledger.

## Confirmación de aislamiento

- No hubo cambios en Production ni en su alias.
- No se desplegó con `--prod`.
- No se usaron datos reales ni secretos en evidencias.
- No se activó ninguna integración comercial ni se emitió una orden ejecutable.
