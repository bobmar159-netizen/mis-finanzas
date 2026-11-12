# Contrato de aprendizaje histórico de Yarbi

## Propósito

El historial disponible de WhatsApp se incorpora una vez, se segmenta por contacto y se procesa de forma reanudable. Los mensajes nuevos actualizan únicamente el contexto del contacto afectado. Este contrato no promete recuperar mensajes que el proveedor no entregue.

## Flujo

1. Se recibe o importa historial disponible y se conserva su procedencia histórica.
2. Solo se lee cuando pertenece al alcance canónico autenticado del propietario y se vincula a un contacto canónico cuando la identidad está verificada.
3. El historial de cada contacto se divide en segmentos de hasta 60 mensajes, con una clave idempotente basada en sus referencias.
4. La cola durable guarda solamente referencias de mensajes y propuestas revisables: nunca texto de chat en la fila de la cola.
5. Gemini, cuando sea autorizado, podrá proponer contexto y patrones de respuesta citando referencias del segmento.
6. Toda propuesta espera revisión explícita del propietario. No confirma pagos, visitas, servicios, cierres, deudas ni citas.
7. Agenda y Movimientos son las fuentes para corroborar hechos comerciales; una coincidencia histórica se presenta para revisión, no altera estados.
8. Un segmento se reclama de forma exclusiva. Si el modelo o la lectura fallan, queda marcado con un código técnico sanitizado y no se reintenta silenciosamente.

## Respuesta rápida y privacidad

- El cliente consulta contexto ya revisado desde el caché local por propietario y la fuente canónica autorizada; no reenvía todo el historial a Gemini para cada pregunta.
- Los mensajes entrantes nuevos generan trabajo incremental para su contacto. No reinician una carga masiva.
- Los patrones de estilo se derivan solo de mensajes salientes del negocio y no se aplican sin revisión.
- La cola no puede ejecutar acciones comerciales ni crear contactos por inferencia.

## Estado actual

El endpoint de memoria del Preview aislado puede exponer un plan sanitizado (`historical-plan`), sin texto de chats ni escrituras. Preparar referencias en la cola (`historical-enqueue`) requiere confirmación explícita. El planificador, el contrato de salida del modelo y la cola transaccional están preparados localmente. La migración `PROPOSED_20261111_historical_intelligence_batches.sql` es una propuesta: no está aplicada a Supabase y no se ha realizado ninguna llamada a Gemini.
