# F08 — WhatsApp Business y CRM

Estado: **VALIDADA_LOCALMENTE_SIN_ENVIOS_REALES**  
Base: `a33e589` / etiqueta `F07`  
Alcance: workspace local únicamente.

## Implementación

- El webhook comercial existente conserva la validación HMAC de YCloud, el ingreso canónico, la deduplicación por mensaje y por evento firmado, la asociación canónica al CRM y la programación posterior del procesador existente.
- `lib/yarbi-whatsapp-business.js` normaliza de forma acotada eventos de YCloud y Meta Cloud: mensajes entrantes, ecos salientes, historial disponible/parcial y recibos de proveedor (`provider_accepted`, `delivered`, `read`, `failed`). No interpreta texto comercial ni inventa contactos.
- `api/webhook.js` reconoce recibos de entrega. Su persistencia está bloqueada por `YARBI_WHATSAPP_BUSINESS_OPERATIONS_ENABLED=true` y por la tabla propuesta; con la bandera ausente no escribe ningún estado nuevo.
- `api/assistant/send-whatsapp.js` deja de considerar `confirmed: true` como autorización suficiente. Requiere una autorización HMAC de corta vida, emitida por servidor y vinculada a sesión autenticada, propietario, proveedor explícito, destinatario, contenido, tipo y `operation_id`.
- La autorización se reclama una sola vez. Ante resultado ambiguo del proveedor se conserva `provider_outcome_unknown` y no se reintenta automáticamente. La respuesta del proveedor solo establece `provider_accepted`; entrega y lectura dependen de recibos posteriores autenticados.
- El proveedor debe ser explícito (`ycloud` o `meta_cloud`): no existe cambio silencioso entre YCloud y Meta.
- `migrations/PROPOSED_20261106_f08_whatsapp_business_operations.sql` es una propuesta local, no aplicada. Define el ledger de operaciones, RLS, privilegio mínimo de `service_role` y una reclamación transaccional con `SECURITY INVOKER`.
- El módulo de audio existente sigue siendo el único validador de adjuntos de voz. La transcripción continúa pendiente de un adaptador/proveedor autorizado; ningún archivo, audio ni proveedor de pago fue activado.

## Pruebas locales

Se ejecutaron **64/64 PASS**. Incluyen F05, F06, F07, webhook firmado F3D, envío WhatsApp y F08.

- Recepción y firma inválida: PASS.
- Duplicados por mensaje y evento: PASS.
- Evidencia interactiva estructurada y texto libre no clasificado: PASS.
- Identidad/procedencia canónica existente: PASS.
- Autorización ligada a propietario, proveedor, contenido, destinatario y caducidad: PASS.
- Alteración, reenvío y operación ya reclamada: PASS.
- Estado `provider_accepted → delivered → read`: PASS con store sintético.
- Error ambiguo del proveedor: PASS; queda sin reintento automático.
- Audio y adjuntos: validación existente preservada; PASS mediante regresiones F07/F3D.
- Aislamiento/ausencia de efectos comerciales: PASS mediante mocks; los tests no contactaron hosts externos.

También se generaron los builds locales:

- Web: PASS (`p02i-10cc42dbec890489`).
- Android web assets: PASS (`p02i-10cc42dbec890489`).

## Simulado o pendiente de activación

- YCloud/Meta, sus webhooks y los recibos reales permanecen desconectados.
- La migración del ledger de operaciones no se aplicó a ningún proyecto Supabase.
- La Bandeja y el expediente mantienen el historial comercial canónico ya existente; la validación visual con tráfico real de proveedor está pendiente.
- La preparación de respuestas, resúmenes y seguimientos reutiliza el procesador/cerebro existente únicamente cuando una entrada canónica llegue; F08 no habilita Gemini ni respuestas automáticas.
- La transcripción entrante de audio no se activa hasta contar con un proveedor explícitamente autorizado.

## Requisitos para activar un proveedor en una fase posterior

1. Revisar y aplicar por separado la migración propuesta en un entorno aislado.
2. Configurar `YARBI_WHATSAPP_SEND_AUTHORIZATIONS_ENABLED=true` y un secreto HMAC exclusivo de servidor de al menos 32 caracteres.
3. Configurar exactamente un proveedor para cada operación autorizada: `YCLOUD_API_KEY` para YCloud, o `META_ACCESS_TOKEN` y `META_PHONE_NUMBER_ID` para Meta Cloud.
4. Configurar la verificación de webhook correspondiente, incluido `YCLOUD_WEBHOOK_SECRET` para YCloud.
5. Probar con fixtures sintéticos y recibos del proveedor antes de permitir mensajes comerciales.

## Seguridad y límites

No se realizaron envíos, despliegues, migraciones, llamadas a Supabase remoto, Gemini, Meta, YCloud, WhatsApp, Notion ni Production. No se modificó el APK. Los secretos no se imprimieron ni se guardaron.

## Próximo paso

Preparar F09 — WhatsApp personal, manteniéndolo estrictamente separado de conversaciones CRM/comerciales y reutilizando el cerebro F05 y memoria F06 solo después de definir su contrato de identidad, retención y autorización.
