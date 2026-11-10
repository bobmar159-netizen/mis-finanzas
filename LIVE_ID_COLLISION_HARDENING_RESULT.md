# Hardening de identidad Gemini Live

## Resultado

**PASS con limitaciones documentadas.** Se demostró una colisión real en la implementación anterior: `liveTranscriptItemId` reemplazaba caracteres no seguros por `_` y recortaba sesión a 96 caracteres y turno a 40. Por ejemplo, `sesion/123` y `sesion_123` producían el mismo componente saneado. También podían coincidir valores que compartían los prefijos truncados.

## Base y aislamiento

- Base: `6223b8ca02162457987c717cb0444b7b9501bcde`.
- Rama: `etapa1-live-id-collision-hardening`.
- Worktree: `C:\\Users\\BOB\\.codex\\worktrees\\etapa1-live-id-collision-hardening\\YARBI_WORKSPACE_20261105`.
- `main` no fue modificado.
- F04.2 y F04.3 no son ancestros de esta rama.
- No hubo despliegue, migración, acceso a Supabase, Gemini real ni servicios remotos.

## Corrección aplicada

`frontend/yarbi-memory-center.js` genera ahora la identidad Live v2 a partir de la tupla completa `(role, liveSessionId, turnId)`:

- Cada componente conserva tipo: ausente, `null` y cadena vacía son distintos.
- El contenido se representa como unidades UTF-16 hexadecimales con su longitud explícita.
- No hay sanitización con pérdida ni truncamiento.
- El resultado usa solo caracteres seguros para `data-message-id` y selectores DOM.
- Las claves de borrador y finalización usan la misma tupla inequívoca.
- Cuando el llamador no pasa una sesión, se toma la sesión Live activa solo para la ruta de Live; las llamadas heredadas sin sesión permanecen compatibles.
- Los IDs v1 ya guardados permanecen legibles; los nuevos eventos Live usan el prefijo `yl_v2_`.

La persistencia comprueba que la fila recién escrita puede releerse antes de declarar completada una finalización. Si `localStorage` no admite la escritura, se conserva el borrador y el callback puede recuperarse sin sustituir el ID por uno genérico.

`frontend/index.html` solo transporta el contexto de sesión en descartes de turnos finalizados. El bloque protegido de captura VAD, AudioWorklet, micrófono, buffers y Barge-in no fue modificado.

## Archivos modificados

- `frontend/yarbi-memory-center.js` — identidad inequívoca, deduplicación local y verificación de persistencia.
- `frontend/index.html` — descarte de borradores con scope de sesión.
- `tests/etapa1-live-finalization.test.js` — cobertura de colisiones, reconexión, callbacks y recuperación.
- `index.html`, `yarbi-memory-center.js`, `runtime-config.js`, `service-worker.js` — artefactos Web generados por el build unificado.

## Preservación documental

Los cinco informes originales de Antigravity permanecen sin modificar. Sus cuatro informes internos y el manifiesto real fueron verificados antes de crear este worktree. El informe externo de discrepancia conserva el SHA-256 autorizado `5ebd2401237f62e99b43cb77e5476fcd876f3ce1ddc95c6065500c0f5548b997`.

## Limitaciones pendientes

- `finalizedLiveTranscriptKeys` es un `Map` local por pestaña/instancia; no demuestra atomicidad entre pestañas, procesos o dispositivos.
- El ID estable evita duplicación durante recuperación cuando la misma tupla se vuelve a procesar localmente. La idempotencia de una escritura compartida entre procesos depende del contrato del backend de preferencias, que no fue cambiado ni validado remotamente en este alcance.
- Si el proveedor no aporta simultáneamente sesión y turno estables, dos eventos con la misma tupla incompleta no se pueden distinguir de forma fiable. Ausente, `null` y vacío no se confunden, pero tampoco se inventa una identidad de proveedor que no existe.
- La prueba física de Barge-in/Live en Android permanece pendiente.
