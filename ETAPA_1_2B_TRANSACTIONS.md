# Contrato transaccional

Para un mensaje nuevo se abre una transacción `readwrite` sobre `timeline` y `outbox`:

1. Lee `timeline[id]`.
2. Rechaza contenido no inmutable si ya existe.
3. Inserta Timeline si es nuevo.
4. Lee y crea Outbox idempotente si corresponde.
5. Resuelve únicamente en `transaction.oncomplete`.

Las notificaciones se emiten solo después de ese commit. Si existe conflicto no se escribe ni Timeline ni Outbox. Web Locks reduce la carrera de pestañas cuando está disponible; IndexedDB es la barrera de persistencia aun sin Web Locks.
