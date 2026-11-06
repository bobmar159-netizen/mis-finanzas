# F06 — Memoria, instrucciones y entrenamiento

## Resultado

**F06_MEMORIA_INSTRUCCIONES_ENTRENAMIENTO_VALIDADA_LOCALMENTE**

Se completó el recorrido local para instrucciones permanentes del propietario:

1. El navegador solicita una propuesta autenticada.
2. El servidor deriva el propietario únicamente del Bearer validado; rechaza cualquier `owner_id` enviado por el navegador.
3. La propuesta queda ligada al propietario, su contenido y una expiración de 20 minutos mediante HMAC.
4. La pantalla muestra el cambio exacto y exige confirmación explícita del propietario.
5. Solo después de confirmar se persiste; una repetición semántica no genera una segunda instrucción.

La continuidad conversacional sigue siendo temporal; no se convierte automáticamente en memoria permanente. Los recordatorios, datos de clientes y acciones comerciales se clasifican por separado y no se guardan como instrucciones del propietario.

## Código incorporado

- `lib/yarbi-owner-memory.js`: clasificación segura, clave semántica, propuestas HMAC y recuperación de instrucciones activas relevantes.
- `api_handlers/assistant/memory.js`: handler autenticado y aislado por propietario, con acciones `list`, `retrieve`, `propose` y `confirm`.
- `frontend/yarbi-owner-memory-ui.js`: flujo de dos pasos con confirmación visible antes de persistir.
- `api/assistant-router.js` y `vercel.json`: ruta `/api/assistant/memory` a través del router existente; no añade una Function de Vercel.
- `frontend/index.html`: conteo, procedencia, fecha, edición, pausa y desactivación conservando historial.
- `migrations/PROPOSED_20261106_f06_owner_memory_instructions.sql`: propuesta local para una tabla por propietario, RLS activo y acceso exclusivo de `service_role`.

La migración es una propuesta local y **no fue aplicada**. No se trasladaron automáticamente instrucciones legacy porque su identidad de origen no es demostrable.

## Comportamientos cubiertos

| Criterio | Resultado |
| --- | --- |
| Propuesta antes de persistir | PASS |
| Confirmación explícita y token ligado al owner | PASS |
| Idempotencia semántica | PASS |
| Owner scope y rechazo de owner enviado por browser | PASS |
| Instrucciones activas relevantes y caché invalidable | PASS |
| Temporal / CRM / acción comercial no convertidos en instrucción | PASS |
| Edición, pausa y reactivación con historial | PASS |
| Frontend Web generado | PASS |
| Frontend Android generado con origen sintético | PASS |
| Aplicación remota de la migración | PENDIENTE — no autorizada |
| Voz y WhatsApp reales | PENDIENTE — interfaz preparada, sin integración real |

## Verificación local

La regresión focalizada terminó en **59/59 PASS**. Incluye F06, conversación F05, CRM, inteligencia, runtime de entrenamiento, matriz de rewrites y routers. Los builds reproducibles completaron:

- Web: `dist/web/` y raíz publicable.
- Android: `dist/android-www/`, con `YARBI_ANDROID_API_ORIGIN=https://yarbi-android-build.invalid`.

No se realizó red, despliegue, migración, llamada Gemini, generación de APK ni acceso a Supabase remoto, Production, WhatsApp, Agenda, Notion o Meta Ads.

## Límites y siguiente paso

F06 está validada localmente. Para validarla en Preview se requiere autorización separada para revisar y aplicar la migración propuesta exclusivamente en el proyecto aislado, configurar la ruta Preview y ejecutar fixtures sintéticos de propietario. Hasta entonces, el modo remoto no debe asumirse disponible.

La siguiente fase funcional es F07: conectar propuestas de voz y WhatsApp al mismo contrato de propuesta/confirmación, primero con mocks locales y sin envíos reales.
