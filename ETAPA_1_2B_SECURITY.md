# Seguridad 1.2B

- No hay secretos, credenciales ni mensajes en BroadcastChannel/storage signals.
- No hay fallback de escritura local concurrente cuando IndexedDB no está disponible.
- Los mismos IDs con contenido diferente fallan sin sobrescribir.
- El Outbox se elimina solo después de respuesta remota satisfactoria y fuera de la transacción local.
- No se modificaron VAD, AudioWorklet, Barge-in, autenticación, endpoints, F03, F04.2 ni F04.3.
- No hubo conexiones remotas ni despliegues.
