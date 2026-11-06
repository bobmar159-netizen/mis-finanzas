# Yarbi — validación real Gemini V4 post-correcciones

## Resultado general

`GEMINI_V4_POST_CORRECTIONS_VALIDATION_BLOCKED`

La batería quedó detenida conforme a la regla autorizada de seguridad: se
realizaron **3 de 16** llamadas reales a Gemini y la cuarta solicitud recibió
`401 owner_reference_unauthorized` antes de invocar Gemini. No hubo reintento
automático, ni se ejecutaron las trece solicitudes restantes.

Este resultado no demuestra un fallo semántico ni de polaridad. Tampoco permite
recomendar la integración V4: faltan 13 fixtures, incluidos casos temporales,
continuidad, ambigüedad e identificación.

## Entorno y aislamiento

- Deployment Preview: `dpl_3VrCqtvzatUcKpEP6Morh2ghxd4T`.
- URL Preview: `https://misfinanzas-backend-1rs6wnap6-omar-dfc4.vercel.app`.
- Proyecto aislado: `uevilhbstnmmdlgyshlv`.
- La inspección de Vercel confirmó `target: preview`; no se usó `--prod` ni se
  promovió ningún alias.
- La comprobación sin sesión respondió `401` antes de Gemini.
- El runner ejecutó los **87/87** tests locales requeridos antes de autenticar.
- No se persistieron credenciales, prompts ni respuestas crudas del proveedor.

## Resultado de las llamadas reales

| Fixture | HTTP público | HTTP Gemini | Pipeline | Seguridad |
| --- | ---: | ---: | --- | --- |
| F3PC-01 | 200 | 200 | PASS | PASS |
| F3PC-02 | 200 | 200 | PASS | PASS |
| F3PC-03 | 200 | 200 | PASS | PASS |
| F3PC-04 | 401 | No invocado | detenido | autenticación rechazada |

Para F3PC-01 a F3PC-03, Gemini devolvió JSON válido que completó el recorrido
V4 → normalización estricta → hardener V4 → adaptador V4/V1 → normalización V1
→ hardening V3. Cada una conservó `execute:false`, una sola solicitud, cero
reintentos, cero acciones comerciales y cero invocaciones al resolvedor.

Las tres correcciones iniciales pasaron: no hubo mención negada convertida en
restricción positiva, no hubo selección automática ni contradicción sin
resolver. El conjunto no es suficiente para afirmar el criterio de 90 % de los
casos inequívocos: la evidencia es 3/13, porque el resto no se ejecutó.

## Autenticación que detuvo la batería

La cuarta ruta llegó al Preview, pero `authenticatedOwnerIdentity` rechazó su
Bearer token con `owner_reference_unauthorized`. La ruta no creó operación de
Gemini ni acción comercial para F3PC-04.

La causa de que la sesión aceptada para los tres primeros requests quedara no
autorizada en el cuarto no puede demostrarse a partir de evidencia sanitizada.
Posibilidades no verificadas: invalidación de sesión, token de corta duración o
cambio de estado del usuario sintético. No se muestran ni registran JWT,
correos, contraseñas o respuestas de Auth.

La evidencia del runner etiqueta el corte como `critical_security_failure`
porque comparte el mecanismo de detención. Esa etiqueta significa *batch
detenido por seguridad*; no representa una violación semántica. Los tres
resultados completos no registran una violación crítica.

## Telemetría disponible (3 observaciones)

| Métrica | Mínimo | Mediana | Máximo / P95* |
| --- | ---: | ---: | ---: |
| Gemini | 5,236 ms | 5,419 ms | 5,969 ms |
| Handler | 6,966 ms | 7,664 ms | 7,802 ms |
| Runner | 12,703 ms | 12,904 ms | 13,859 ms |

\*P95 con tres muestras es solo una referencia, no una estimación estable.

Comparación con el antecedente: la mediana Gemini anterior era 1,418 ms y el
P95 2,208 ms; este subconjunto es más lento, pero no es comparable de manera
concluyente debido al tamaño de muestra y a la capa de autenticación/traza del
Preview.

## Egress y efectos externos

Para los tres fixtures completados, los únicos destinos declarados fueron
Supabase aislado para Auth/ledger y Gemini para generación. No hubo CRM,
Agenda, WhatsApp, Calendar, Maps, Notion, Meta Ads, voz ni APK. Producción no
fue usada ni modificada.

## Evidencia y hashes SHA-256

| Artefacto | SHA-256 |
| --- | --- |
| `scripts/gemini-v4-post-corrections-real-evidence.json` | `A592387516F0A88F5D74BF52F651BA074DFE8FC02F9922EA52DE24AC660D9E1E` |
| `scripts/gemini-v4-post-corrections-real-attempt.json` | `8262A6D78627F44F72F38A3EB8D929E14DCEAE67132C4A36CFC2442490D5CB95` |
| `scripts/run-gemini-v4-post-corrections-validation-real.cjs` | `9EA281156CB33F34872208235728CC658B30DCA4276242F4E72BB42F3124673B` |
| `PREVIEW_REFERENCIAS_AISLADO/api/diagnostics/gemini-v4-post-corrections-validation.js` | `931C2FBB7724ED64BBF2BD95468B8EFA85F5CFEA816584962EF084EFD6BBDA2E` |
| `PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-v4-post-corrections-fixtures.js` | `227536F92A3B4E16F0F0D28D8CA8C4CDA5C8B6B1B3E1FE6EE3CC0801FC8FDC56` |
| `PREVIEW_REFERENCIAS_AISLADO/lib/yarbi-understanding-polarity-proposal.js` | `BDE3923915EAF6A359D9382A87CA898BFC8E6E7F360C57A583A50CF41FF0BCAF` |
| `PREVIEW_REFERENCIAS_AISLADO/vercel.json` | `7E28848D48EC084372299218207E063423121DCB4ED1160B95B2390E0C3DA637` |

## Siguiente paso recomendado

Antes de autorizar cualquier llamada adicional, investigar de forma acotada la
persistencia de la sesión Auth del owner sintético en el Preview aislado. Debe
demostrarse que una sesión válida conserva autorización para 16 requests
secuenciales, sin cambiar el contrato V4 ni ejecutar una segunda batería.

No se debe borrar el archivo de intento ni reutilizar los fixtures ya
ejecutados sin una autorización expresa de recuperación.
