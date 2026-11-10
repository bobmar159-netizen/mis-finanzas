# Etapa 1.2A — Integridad de identidad y persistencia

## Resultado

Implementación local completada en la rama aislada `etapa1-2a-identity-persistence`, creada desde `main` en `8e15319903c8d17bfe91e045c2c1b6e2fe14648b`. No se modificó `main`, ni se usaron servicios remotos, despliegues, migraciones o credenciales.

La identidad de Gemini Live ahora conserva explícitamente el tipo de cada componente y la persistencia local confirma por lectura que el contenido inmutable fue escrito antes de declarar éxito.

## Cambios funcionales

- La codificación v2 diferencia `1` (número) de `"1"` (texto), y rechaza tipos y números inválidos antes de formar una identidad.
- Los roles Live quedan limitados a `user` y `assistant`.
- Las claves y IDs Live no se construyen cuando la tupla de identidad es inválida.
- Un ID existente solo es idempotente si coinciden `id`, `role`, `text` y `channel`.
- Un ID existente con contenido distinto produce `identity_conflict`; no sobrescribe el mensaje previo.
- Un fallo de escritura local produce `storage_write_failed`; una lectura posterior incongruente produce `storage_readback_failed`.
- La cola de sincronización recibe el registro que se leyó y verificó, no una copia no confirmada.

## Estado

- Identidad tipada: PASS local.
- Persistencia inmutable y read-back: PASS local.
- Recuperación de borrador Live: PASS mediante prueba existente de finalización/reintento.
- Concurrencia entre pestañas: fuera de alcance de 1.2A; pendiente para 1.2B.
- Android físico: fuera de alcance de 1.2A; pendiente para 1.2C.

## Archivos modificados

- `frontend/yarbi-memory-center.js` — fuente canónica.
- `yarbi-memory-center.js` — salida Web generada por el build reproducible.
- `runtime-config.js` y `service-worker.js` — identificador de release generado por el build Web.
- `tests/etapa1-live-finalization.test.js` — pruebas focalizadas con almacenamiento sintético que ejecuta las funciones reales extraídas de la fuente.

Los detalles de contrato, pruebas, seguridad, rendimiento y hashes están en los informes complementarios de esta etapa.
