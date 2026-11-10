# Seguridad — Etapa 1.2A

- Las identidades inválidas fallan cerradas; no se convierten a texto arbitrario ni a otra identidad válida.
- Una colisión de ID con datos distintos preserva el evento original y no ejecuta una sobrescritura silenciosa.
- La confirmación de persistencia compara contenido inmutable tras relectura, no solo existencia del ID.
- Los fallos de `localStorage` se propagan como estado controlado y evitan marcar el turno Live como completado.
- No se añadieron secretos, logs de contenido, llamadas de red, accesos a Supabase, Gemini, Production o credenciales.

Riesgo residual: el estado local de dos pestañas independientes no posee bloqueo compartido. La fase 1.2B debe definir y probar esa concurrencia.
