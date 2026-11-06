# Yarbi — diagnóstico de continuidad de autenticación V4

## Resultado

`NOT_PROVEN — causa remota no demostrable con la evidencia sanitizada disponible`.

La validación V4 realizó tres solicitudes auténticas completas y seguras. La
cuarta recibió `401 owner_reference_unauthorized` antes de Gemini. La batería
se detuvo, no reintentó, no reutilizó los fixtures y no consumió las 13
solicitudes pendientes.

No se modifica la autenticación comercial, RLS, el contrato Gemini V4, el
hardener, el adaptador ni ninguna ruta comercial.

## Hechos demostrados

1. El runner inicia sesión una vez contra el proyecto aislado y reutiliza el
   mismo access token como `Authorization: Bearer <token>` en cada request.
2. Antes de despachar, el runner valida ese token en
   `https://uevilhbstnmmdlgyshlv.supabase.co/auth/v1/user`.
3. Las solicitudes F3PC-01, F3PC-02 y F3PC-03 fueron aceptadas por la misma
   ruta Preview. Por lo tanto, la configuración inicial, el owner sintético y
   la construcción inicial del header fueron válidos.
4. F3PC-04 alcanzó el handler y fue rechazada en
   `authenticatedOwnerIdentity`: la validación de `/auth/v1/user` no fue
   satisfactoria. Gemini no fue invocado.
5. La ruta V4 no conserva estado de sesión entre requests: valida cada Bearer
   de nuevo contra Auth. No existe una caché de usuario, una mutación de owner
   ni una renovación implícita dentro del handler.

## Pruebas locales

| Caso | Resultado |
| --- | --- |
| Una solicitud válida | PASS |
| Tres solicitudes válidas consecutivas | PASS |
| Dieciséis solicitudes válidas consecutivas | PASS |
| Token inválido | PASS: 401 |
| Token expirado | PASS: 401 |
| Sesión renovada con token nuevo | PASS |
| Sesión ausente | PASS: 401 sin llamar a Auth |
| Owner autenticado distinto | PASS: 403 |
| Ruta diagnóstica V4 aislada | PASS 5/5 |
| Regresión V4 post-correcciones | PASS 87/87 |

Todas las pruebas se ejecutaron con mocks locales. `network_calls`,
`gemini_calls` y acciones comerciales fueron cero.

## Evaluación de hipótesis

| Hipótesis | Estado | Evidencia |
| --- | --- | --- |
| Token inválido al inicio | DESCARTADA | Las tres primeras solicitudes fueron autenticadas. |
| Owner sintético configurado incorrectamente | DESCARTADA al inicio | El handler autorizó tres solicitudes con el mismo owner. |
| Pérdida de estado dentro del handler | DESCARTADA localmente | 16 requests consecutivos válidos conservan identidad. |
| Defecto del header inicial del runner | DESCARTADA parcialmente | El mismo modo de envío autorizó F3PC-01 a F3PC-03. |
| Token vencido o invalidado durante el lote | NOT PROVEN | El `401` es compatible, pero no se guardó el detalle de Auth por diseño. |
| Vercel CLI alteró el cuarto header | NOT PROVEN | No se almacenan cabeceras para evitar registrar JWT. |
| Estado remoto de la sesión cambió | NOT PROVEN | Requiere evidencia Auth remota sanitizada que esta fase no autorizó consultar. |
| Renovación ausente en el runner | LIMITACIÓN CONOCIDA, no causa demostrada | El runner no persiste `refresh_token`; en aproximadamente tres requests exitosos no hay evidencia de expiración. |

## Corrección local

No se aplicó una corrección funcional: modificar autenticación o añadir una
excepción sin poder reproducir la causa reduciría la seguridad y contradiría
el alcance autorizado.

Se agregó únicamente el test local de continuidad de autenticación. Demuestra
que el componente responsable conserva identidad para 16 solicitudes válidas y
que continúa rechazando sesiones inválidas, expiradas, ausentes y owners no
autorizados.

## Aislamiento

- Cero llamadas a Gemini durante este diagnóstico.
- Cero solicitudes al Preview.
- Cero reintentos del runner.
- Cero fixtures F3PC nuevos o reutilizados.
- Producción, Vercel, CRM, Agenda, WhatsApp, Meta Ads y APK no fueron
  modificados.

## Evidencia y hashes SHA-256

| Artefacto | SHA-256 |
| --- | --- |
| `scripts/test-owner-auth-continuity-local.cjs` | `4C2266A0B46EE4A04676B6F86B11A45F4318593269A506DEADD788599A711924` |
| `PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-owner-ui-auth.js` | `F7E4FC8B97A1FD93D27B88CD14684FE5BCA2010AB6CAF3D5EAF4B45DF221C470` |
| `scripts/run-gemini-v4-post-corrections-validation-real.cjs` | `9EA281156CB33F34872208235728CC658B30DCA4276242F4E72BB42F3124673B` |
| `scripts/gemini-v4-post-corrections-real-evidence.json` | `A592387516F0A88F5D74BF52F651BA074DFE8FC02F9922EA52DE24AC660D9E1E` |
| `PREVIEW_REFERENCIAS_AISLADO/api/diagnostics/gemini-v4-post-corrections-validation.js` | `931C2FBB7724ED64BBF2BD95468B8EFA85F5CFEA816584962EF084EFD6BBDA2E` |

## Recomendación

No autorizar una segunda batería todavía. El siguiente paso mínimo y seguro es
una prueba de continuidad de Auth separada, exclusivamente en Preview aislado,
sin Gemini ni F3PC: validar una sesión sintética durante 16 requests
secuenciales y registrar solo códigos sanitizados de Auth. Si esa prueba pasa,
la causa se concentrará en el mecanismo de despacho `vercel curl` o en una
invalidación transitoria; si falla, permitirá una corrección puntual del
renovador de sesión.
