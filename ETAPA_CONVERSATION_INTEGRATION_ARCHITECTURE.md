# Integración del chat — Arquitectura

```text
Gemini Live
  -> borrador temporal role:turnId (.is-live; no persistencia)
  -> finalización role:liveSessionId:turnId
  -> persistTimelineMessage(..., id estable)
  -> comprobar data-message-id presentado
  -> retirar borrador
  -> marcar el callback como finalizado
```

## Invariantes

1. `liveSessionId` y `turnId` diferencian finales iguales de sesiones o turnos diferentes.
2. Un callback repetido de la misma sesión, rol y turno es idempotente.
3. La deduplicación de texto/tiempo se conserva para mensajes heredados sin ID explícito.
4. En conversación normal, el final atraviesa `renderTimelineItem` y `YarbiConversationRenderer`.
5. Un fallo de render no confirma el turno: el borrador se conserva para recuperación posterior.
6. El simulador de entrenamiento sigue separado del historial CRM normal.

La raíz servida se regeneró desde `frontend/` mediante el build unificado; no existe una segunda fuente editable.
