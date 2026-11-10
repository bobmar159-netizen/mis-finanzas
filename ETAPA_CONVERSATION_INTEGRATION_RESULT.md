# Integración controlada del chat Yarbi

## Resultado

Se creó la rama candidata `etapa1-conversation-integration` desde F03 (`6b2431ac3dd25491d95d10a72f17f1b0adcf016f`) y se integró `c6b8847ab5854e4468105bd0d20a6cf7f52cbad2` mediante fast-forward. `main` no fue modificado.

Durante las comprobaciones obligatorias se encontró y corrigió localmente un caso de integridad: dos finales Live legítimos con igual texto, rol y timestamp podían compartir la deduplicación heredada de 2,5 s. Los finales Live ahora reciben un ID estable derivado de `liveSessionId + role + turnId`; la deduplicación usa ese ID cuando está disponible.

El candidato conserva la finalización canónica de 1.1.2: persistir una vez, confirmar que el renderer produjo el elemento final y sólo entonces retirar el borrador. Si falla persistencia o renderer, el borrador no se confirma ni se pierde silenciosamente.

## Alcance

- Integrados: Etapa 1, 1.1 y 1.1.2.
- Añadidas comprobaciones locales de identidad y recuperación Live solicitadas en esta integración.
- Excluidos y ausentes de la ascendencia: F04.2 (`6bf2dcd`) y F04.3 (`092ee79`).
- Sin despliegue, Gemini real, Supabase remoto, migraciones, credenciales ni cambios en Production.

## Estado

La rama candidata está lista para revisión. No se actualizó `main`.
