# Arquitectura modificada — Etapa 1.2A

## Límite de la intervención

La intervención está confinada al almacenamiento local de la línea temporal y a los identificadores de los borradores/finalizaciones Gemini Live en `frontend/yarbi-memory-center.js`. No cambia VAD, AudioWorklet, Barge-in, autenticación, endpoints, F03, CRM ni transportes remotos.

## Flujo de identidad

`role + liveSessionId + turnId` se codifica en una tupla v2 tipada. La tupla alimenta, sin truncamiento, las claves de borrador, finalización e ID del ítem persistente. Una entrada inválida no genera una clave alternativa.

## Flujo de persistencia

1. Validar el ID explícito y normalizar el mensaje.
2. Buscar el ID en la línea temporal local.
3. Si existe y sus campos inmutables coinciden, devolverlo idempotentemente.
4. Si existe y difiere, devolver conflicto sin escritura.
5. Escribir la nueva lista y verificar el resultado mediante una lectura posterior.
6. Solo con coincidencia inmutable en la lectura, encolar y presentar el mensaje final.

Esto evita que un callback Live considere completa una finalización cuando el navegador no pudo persistir el mensaje.
