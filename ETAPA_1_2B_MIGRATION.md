# Migración y recuperación

Origen legacy: `gfc_yarbi_chat_timeline_v1` y `gfc_yarbi_chat_outbox_v1`.

La migración toma una instantánea, valida IDs/contenido, impide colisiones distintas y registra `pending_verification`. Tras el primer commit cuenta los dos stores mediante una segunda transacción y recién marca `completed` si los conteos verifican los importados.

Las claves legacy no se modifican ni eliminan. Si hay conflicto o registro no válido, no se marca la migración completa y se conserva el origen. Reiniciar tras un estado pendiente vuelve a importar con `put` idempotente y verifica de nuevo.

Recuperación: si IndexedDB falla, las claves legacy permanecen intactas; no se escriben datos nuevos a localStorage. El estado queda recuperable cuando IndexedDB vuelva a estar disponible.
