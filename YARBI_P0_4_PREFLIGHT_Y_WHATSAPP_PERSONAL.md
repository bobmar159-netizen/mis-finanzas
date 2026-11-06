# YARBI P0.4 — Preflight Vercel, estabilización y arquitectura WhatsApp Personal

Fecha: 2026-11-05  
Estado final: **PARCIAL — build y Preview bloqueados de forma segura**

## Resultado ejecutivo

Se confirmó localmente el vínculo con el proyecto Vercel autorizado `omar-dfc4/misfinanzas-backend` (`prj_LzmQFg4ybpNyzeIBjcYZjP1ZGdJq`) y se revisó su configuración sin desplegar, cambiar variables ni consultar datos de producción.

No se ejecutó `vercel build`, `vercel deploy`, `--prod`, migraciones ni llamadas a proveedores. El bloqueo es deliberado y correcto: la configuración Preview actual no satisface la política aislada para el backend completo y el proyecto está en plan Hobby con 18 Functions de origen, por encima del límite de 12 Functions aplicable a proyectos que puedan beneficiarse del empaquetado de framework. El proyecto usa el preset remoto `Other`, así que no hay evidencia de que esas 18 Functions se reduzcan automáticamente a doce o menos.

La arquitectura de WhatsApp Personal quedó diseñada, pero no implementada ni conectada a un número real.

## Alcance y garantías

- Producción, su alias y el APK permanecieron sin cambios.
- No se accedió a Supabase remoto, datos de clientes, CRM, Agenda, WhatsApp, Notion, Calendar, Gemini ni Meta Ads.
- No se modificaron fuentes funcionales, `vercel.json`, variables Vercel ni los artefactos protegidos P0.2I.
- No se eliminaron respaldos ni se modificó el árbol Android.

## Integridad protegida

Se verificaron los once artefactos fijados por P0.2I contra `YARBI_P0_2I_SHA256SUMS.txt`: **11/11 coinciden**.

También se verificaron los artefactos modificados en P0.3.1 contra los hashes documentados en `YARBI_P0_3_1_CONFIGURACION_SEGURA.md`: **10/10 coinciden**. Por tanto, P0.4 no introdujo cambios sobre P0.2I ni P0.3.1; este informe es el único archivo creado por esta fase.

## P0.4A — Preflight Vercel

### Proyecto y configuración observados

| Requisito | Evidencia | Estado |
|---|---|---|
| Proyecto Vercel | CLI de solo lectura: `omar-dfc4/misfinanzas-backend`, ID exacto esperado | PASS |
| Entorno de runtime | Node `24.x`; preset remoto `Other` | PASS |
| Sin despliegue productivo | No se utilizó `--prod`, no se promovió alias | PASS |
| Functions de origen | 18 entrypoints `api/**/*.js` activos | PASS |
| Salida histórica | `.vercel/output` contiene 12 directorios `*.func`, pero es histórica y no contiene las 18 rutas actuales | NOT PROVEN para el backend actual |
| Build reproducible Vercel | No hay `build` ni `vercel-build` en `package.json`; Vercel infiere un proyecto `Other` | BLOCKED |
| Aislamiento Preview completo | Faltan parámetros explícitos requeridos por la guardia funcional | BLOCKED |
| Espacio de trabajo | Unidad C: aproximadamente 133 MB libres; insuficiente margen para un build seguro y sus dependencias | BLOCKED |

### Functions y límite del plan

Las 18 Functions de origen son:

```text
api/notion-proxy.js                         api/assistant/owner-inbox.js
api/supabase-secure.js                      api/assistant/preferences.js
api/webhook.js                              api/assistant/proactive-loop.js
api/actions/approve.js                      api/assistant/reference-candidates.js
api/ai/process.js                           api/assistant/scheduled-followups.js
api/assistant/chat.js                       api/assistant/send-whatsapp.js
api/assistant/collections.js                api/audit/trace.js
api/assistant/command.js                    api/location/resolve.js
api/assistant/live-token.js                 api/assistant/owner-action.js
```

La salida `.vercel/output` existente contiene solo doce Functions y omite rutas actuales, entre ellas owner inbox/action, trace, proactive loop y reference candidates. Por su antigüedad, no puede considerarse un build de P0.2I/P0.3.1 ni una validación de publicación actual.

La documentación oficial de Vercel indica que el límite de Functions creadas por deployment en Hobby depende del framework y que el empaquetado dinámico de frameworks soportados queda limitado a doce Functions en Hobby. El proyecto remoto usa `Other`, sin una estrategia de empaquetado demostrada. Ver [límites de Vercel](https://vercel.com/docs/limits), [runtimes](https://vercel.com/docs/functions/runtimes) y [límites de Functions](https://vercel.com/docs/functions/limitations).

**Decisión:** no es seguro afirmar que el backend actual de 18 entrypoints se pueda desplegar en el plan Hobby. No se debe solucionar cambiando una prueba a doce ni fusionando handlers sin una fase de diseño y pruebas de rutas.

### Variables Preview: inventario sin valores

Se comprobó por nombre que Preview ya dispone de los identificadores aislados de Supabase y de secretos de trazabilidad/owner UI. No se imprimieron valores.

Para poder construir y publicar de forma aislada el backend funcional completo, faltan o no se pudieron demostrar estas variables de Preview:

| Variable | Motivo |
|---|---|
| `YARBI_PREVIEW_FUNCTIONAL_SYNTHETIC_ONLY=true` | Activa la guardia funcional sintética y bloquea integraciones comerciales. |
| `YARBI_PREVIEW_DEPLOYMENT_HOST` | Permite validar que `AI_PROCESSOR_URL` no apunta fuera del Preview autorizado. |
| `AI_PROCESSOR_URL` | Requerida por webhook/procesador y debe usar exclusivamente el host Preview aislado. |
| `ASSISTANT_API_TOKEN` o convención compatible existente | Autenticación interna entre rutas; secreto exclusivo de Preview. |
| `YARBI_PREVIEW_SYNTHETIC_TOKEN` | Protege operaciones sintéticas de Preview. |
| `APP_ORIGIN` | Reduce el CORS permisivo de rutas que hoy admiten `*` cuando falta configuración. |
| `CRON_SECRET` | Solo si se habilitan rutas cron/scheduled; no debe habilitarse en el primer Preview. |

No se requieren credenciales de Meta/YCloud/Notion/Calendar/Gemini para un Preview de build. Si alguna ruta externa fuera a habilitarse en el futuro, sus credenciales deben ser nuevas, exclusivas de Preview y estar explícitamente autorizadas.

### Riesgo de raíz de publicación

La configuración actual no define una salida de build ni `outputDirectory`. Para un proyecto `Other`, Vercel puede inferir `public` o la raíz. La salida histórica registra contenido auxiliar además de recursos de la aplicación. Antes de cualquier deployment se debe construir una carpeta de staging explícita que contenga solo `dist/web` y el runtime necesario de Functions; nunca publicar la raíz completa del repositorio.

Una variable local de entorno de Production fue detectada y excluida del análisis y de cualquier build. No fue leída de nuevo ni utilizada. Antes de cualquier build Preview, debe mantenerse fuera de los archivos transferidos a Vercel.

### P0.4B — decisión build / Preview

No se ejecutaron `vercel build` ni `vercel deploy`, conforme a la condición de parada solicitada. Para habilitar una fase posterior se necesita, en este orden:

1. Resolver explícitamente la estrategia de Functions: conservar <=12 artefactos desplegables mediante arquitectura compatible y pruebas de rutas, o cambiar a un plan que admita el número necesario. No realizar ninguno de esos cambios en P0.4.
2. Crear las variables Preview aisladas indicadas arriba, sin reutilizar Production.
3. Definir una salida de staging que impida publicar backups, pruebas o árboles históricos.
4. Recuperar suficiente espacio local para ejecutar un build limpio sin reutilizar `.vercel/output` histórico.
5. Ejecutar un build local aislado, inspeccionar Functions/rutas generadas y recién entonces autorizar un único Preview.

## P0.4C — Clasificación de los 30 fallos heredados

La suite completa sigue reportando 30 fallos. La línea base P0.3 ya documentaba los mismos treinta; no existe evidencia de que P0.4 los haya introducido. Esta clasificación no modifica pruebas ni producto.

| Prueba | Clasificación | Evidencia / acción posterior |
|---|---|---|
| `barge-in guard` | EXPECTATIVA_OBSOLETA | Prueba un hash fijo del `index.html` de raíz, no el frontend canónico. Sustituir en una fase futura por una prueba conductual. |
| `command keeps existing phone conflict guard` | NOT PROVEN | Coincidencia literal con una forma previa de `command.js`; requiere prueba de contrato actual, no cambio automático. |
| `daily close excludes future/completed` | EXPECTATIVA_OBSOLETA | Lee frontend raíz congelado/no canónico. |
| `daily close waits canonical Supabase confirmation` | EXPECTATIVA_OBSOLETA | Igual: prueba estática de frontend raíz. |
| `processing failures stop retrying after 3` | CONFLICTO_DE_CONTRATO | Expectativa legacy `skipped` frente a recuperación Fase 2 (`identity_pending` y claim atómico). Reconciliar antes de corregir. |
| `controlled E2E pending visit` | EXPECTATIVA_OBSOLETA | Depende de markup de raíz y no ejercita `frontend/`. |
| `controlled E2E manual voice greeting` | EXPECTATIVA_OBSOLETA | Depende de markup de raíz. |
| `fast read structured tier` | EXPECTATIVA_OBSOLETA | Snapshot/UI de raíz. |
| `fast read raw fallback` | EXPECTATIVA_OBSOLETA | Snapshot/UI de raíz. |
| `Gemini Live microphone capture` | EXPECTATIVA_OBSOLETA | Hash fijo del frontend de raíz. |
| `greeting startup phrase` | EXPECTATIVA_OBSOLETA | Snapshot/UI de raíz. |
| `mandatory Case A registrar visita` | EXPECTATIVA_OBSOLETA | Simulación basada en fuente raíz, no en la fuente P0.2I. |
| `mandatory Case B construcción` | EXPECTATIVA_OBSOLETA | Simulación basada en fuente raíz. |
| `mandatory Case H cierre diario` | EXPECTATIVA_OBSOLETA | Simulación basada en fuente raíz. |
| `mandatory Case K Notion preflight` | EXPECTATIVA_OBSOLETA | Simulación basada en fuente raíz. |
| `mentor deterministic briefing` | EXPECTATIVA_OBSOLETA | Snapshot/UI de raíz. |
| `proactive alerts balances` | EXPECTATIVA_OBSOLETA | Fuente de UI raíz no canónica. |
| `proactive alerts location` | EXPECTATIVA_OBSOLETA | Fuente de UI raíz no canónica. |
| `availability conflict alert` | EXPECTATIVA_OBSOLETA | Fuente de UI raíz no canónica. |
| `only one unseen alert` | EXPECTATIVA_OBSOLETA | Fuente de UI raíz no canónica. |
| `processing status manual` | EXPECTATIVA_OBSOLETA | Fuente de UI raíz no canónica. |
| `processing status background` | EXPECTATIVA_OBSOLETA | Fuente de UI raíz no canónica. |
| `two brains Gemini Live startup` | EXPECTATIVA_OBSOLETA | Snapshot/UI de raíz. |
| `Vercel Hobby deployment within 12 functions` | BLOQUEO_REAL | El backend actual tiene 18 Functions; la evidencia Vercel no prueba empaquetado a doce. |
| `WhatsApp confirmations phone` | EXPECTATIVA_OBSOLETA | Prueba `www/`, no `frontend/` canónico. Reemplazar por integración de la salida generada. |
| `Account recovery` | EXPECTATIVA_OBSOLETA | Prueba `www/`, no la salida canónica. |
| `P1 reprogramming` | NOT PROVEN | Mezcla expectativa `www/` y backend; requiere prueba de contrato de `actions/approve` actual. |
| `Forms agenda` | EXPECTATIVA_OBSOLETA | Prueba `www/`, no la salida canónica. |
| `Manual Yarbi button` | EXPECTATIVA_OBSOLETA | Prueba `www/`, no la salida canónica. |
| `Canonical analysis reply style` | NOT PROVEN | Intersecta `www/` y procesador; requiere prueba sintética del contrato canónico antes de catalogarlo como regresión o prueba obsoleta. |

La acción correcta es crear posteriormente una matriz de pruebas que apunte a `frontend/` y `dist/web/`, separando pruebas de UI, backend y contratos remotos. No se cambió ninguna expectativa para “hacer pasar” la suite.

## Arquitectura propuesta — WhatsApp Personal de Yarbi

### Decisión de diseño

Un tercer número de WhatsApp para conversar personalmente con Yarbi debe entrar en un **dominio de conversación de dueño**, separado del flujo comercial. No debe reutilizar sin separación el pipeline `whatsapp_messages → CRM → ai_message_analysis`, porque ese pipeline asocia teléfonos a clientes, contexto comercial y procesamiento de ventas.

```text
Número dedicado de Yarbi
        │
Proveedor autenticado (Meta Cloud o YCloud)
        │ firma + idempotencia de delivery
        ▼
Clasificador de alcance: owner_personal | comercial | rechazar
        │
        ├─ comercial → flujo canónico existente, sin cambios
        └─ owner_personal → conversación personal aislada
                              │
                              ├─ estado/recuerdos operativos del dueño
                              ├─ herramientas con autorización explícita
                              ├─ planificador de respuesta
                              └─ adaptador de envío auditado
```

### Componentes actuales reutilizables

| Componente | Uso posible | Estado |
|---|---|---|
| `api/webhook.js` | Normalización de eventos, validación YCloud, deduplicación de entregas y trazas | Reutilizable parcialmente |
| `lib/yarbi-owner-conversation.js` | Estado de conversación del dueño y orquestación de turnos | Reutilizable |
| `lib/yarbi-owner-proactive-orchestrator.js` | Recomendaciones operativas, no mensajería autónoma | Reutilizable con política explícita |
| `api/assistant/send-whatsapp.js` | Adaptador de salida por YCloud/Meta para texto y adjuntos | Reutilizable solo después de una autorización futura |
| `api/assistant/owner-inbox.js` y `owner-action.js` | Bandeja/decisión del dueño en Preview | No son canal WhatsApp; reutilizables como patrón de autorización |
| `api/ai/process.js` | Procesamiento comercial basado en cliente | No reutilizar directamente para conversación personal |

### Entrada, historia y dos identidades autorizadas

La futura configuración debe conservar una lista protegida de identidades permitidas del dueño (por ejemplo, WhatsApp personal y WhatsApp Business), normalizadas y comparadas con identificadores protegidos. Un evento autenticado se clasifica primero por su origen y por esa lista; solo después se decide el alcance.

La historia personal no debe residir en la tabla comercial actual sin una separación formal. La opción recomendada es una migración futura con almacenamiento lógico separado, por ejemplo conversaciones/mensajes de dueño con:

- identificador de conversación de dueño;
- emisor autorizado, sin números en texto de logs;
- dirección, evento de proveedor e idempotency key;
- contenido o referencia cifrada/retencion limitada;
- estado de procesamiento y `operation_id`;
- RLS exclusiva del dueño/servicio;
- prohibición de join implícito con CRM comercial.

Esto permite conservar contexto continuo de ambos números autorizados sin mezclar clientes ni conversaciones comerciales.

### Meta Cloud API y YCloud

| Área | YCloud actual | Meta Cloud actual | Conclusión |
|---|---|---|---|
| Verificación de entrada | HMAC de cuerpo crudo ya implementado | GET de verificación presente; el POST actual no valida la firma Meta como flujo externo independiente | Añadir verificador `X-Hub-Signature-256` antes de habilitar Meta directo |
| Eventos entrantes | Normaliza inbound, historial SMB y echoes cuando YCloud los entrega | Parser acepta forma Meta, pero no hay garantía de firma POST Meta | YCloud es el camino actual más preparado; Meta directo requiere hardening |
| Medios de entrada | Descarga autenticada YCloud; fallback Meta por media id | Fallback implementado | Mantener allowlist, tipo/size limits y expiración |
| Envío | Adaptador existente | Adaptador existente | Siempre tras política, consentimiento y auditoría |
| Historia completa | Solo eventos/historial que el proveedor entregue y que el webhook reciba | No demostrado | **NOT PROVEN**; no prometer importación de toda la historia previa |

Antes de habilitar un número real debe verificarse con documentación y consola de proveedor: modalidad de número, suscripción de webhooks, reglas de ventana de atención/plantillas, retención y límites. P0.4 no hizo esas consultas remotas.

### Voz

- **Audio entrante:** el webhook contiene una ruta de descarga y resumen de audio basada en Gemini para medios de proveedores autorizados; no equivale necesariamente a transcripción literal y no se probó en P0.4.
- **Audio saliente:** falta soporte. `send-whatsapp` maneja texto e URL de imagen/video/documento; no existe aún TTS, carga de audio, media-id del proveedor ni política de reproducción/consentimiento.
- **Diseño futuro:** `speech intent → TTS aislado → almacenamiento temporal de audio → upload provider → mensaje audio`, con límite de tamaño/duración, borrado programado, consentimiento y trazabilidad. Nunca generar o enviar audio sin autorización de la acción.

### Seguridad necesaria antes de implementación

1. Validar firma YCloud o Meta antes de deserializar/efectos; para Meta usar HMAC `X-Hub-Signature-256` sobre cuerpo crudo.
2. Deduplicar por identificador de delivery del proveedor y mensaje antes de persistir o invocar herramientas.
3. Clasificar `owner_personal` antes de búsquedas CRM, creación de contactos o programación de `api/ai/process.js`.
4. Separar RLS, claves de cifrado/retención y consultas entre conversaciones personales y datos comerciales.
5. Eliminar en una fase propia el log de payload íntegro presente en el webhook; puede incluir contenido personal.
6. Exigir confirmación humana para herramientas que envían, crean agenda, modifican dinero/CRM o comparten datos.
7. Mantener prohibidos los fallbacks de Production en Preview y pruebas personales.

### Brechas frente a la experiencia solicitada

| Capacidad | Estado actual | Brecha |
|---|---|---|
| Conversar por texto con un número Yarbi | No implementado | Falta scope personal, auth Meta directo y almacenamiento aislado |
| Historia personal continua | No demostrada | Falta store personal y estrategia de retención/sincronización |
| Consultar negocio desde WhatsApp personal | Parcial | Existe inteligencia/owner modules, pero no un puente personal autorizado y aislado |
| Usar CRM, Agenda, Movimientos, Notion, memoria e instrucciones | Parcial | Herramientas existen en distintos módulos; falta policy de capacidades y confirmaciones por herramienta |
| Notificaciones proactivas | Parcial | Orquestación existe; no hay canal personal real con opt-in, límite y preferencia |
| Audio entrante | Parcial | Camino de media existe, falta validación e integración personal |
| Audio de respuesta | Ausente | Falta TTS/media upload/política |
| Historia completa WhatsApp | NOT PROVEN | Depende de capacidad/configuración real de proveedor, no del código local |

### Secuencia recomendada posterior (no ejecutada)

1. Decidir proveedor y modalidad del número dedicado, sin registrar ni conectar el número aún.
2. Diseñar una migración revisable para conversación personal aislada, ACL/RLS y retención.
3. Implementar y probar localmente el clasificador de alcance y firmas Meta/YCloud con fixtures.
4. Crear Preview aislado sin proveedores externos, solo con eventos sintéticos.
5. Autorizar una prueba de webhook real de un único mensaje sintético.
6. Incorporar herramientas de lectura primero; acciones de escritura/envío deben permanecer con confirmación explícita.
7. Diseñar TTS/media como una fase independiente.

## Hashes de evidencia relevante

| Archivo | SHA-256 |
|---|---|
| `api/webhook.js` | `619ca54c78859e44f16e6ae1a73d34a025f9e60f831cf577b8813471aee0c3b6` |
| `api/assistant/send-whatsapp.js` | `04d6393b9c85a9f0d69e22260699d48408fe0fc1c53b131b4ae5ce5bbdd9c701` |
| `lib/yarbi-owner-conversation.js` | `be18ac05d07c54a4cddc7c7df375bc386f74d2f3d3a6e3080842558f353d7917` |
| `lib/yarbi-owner-proactive-orchestrator.js` | `fabad2f1cd3203e15f44682c564ebe6194a513f3c93e1e37cc9d64a10808bae2` |
| `frontend/yarbi-owner-inbox-ui.js` | `d091b74667206243400d75cefcb054d6ffcf67afdb391ad9433df360338f8dea` |
| `www/yarbi-owner-inbox-ui.js` | `d091b74667206243400d75cefcb054d6ffcf67afdb391ad9433df360338f8dea` |

## Decisiones requeridas para continuar

1. Resolver la política de Vercel Hobby/Functions antes de autorizar un Preview del backend actual.
2. Aprobar las variables aisladas y una carpeta de staging explícita para Preview.
3. Elegir el proveedor/forma de operar el número dedicado de Yarbi (Meta directo o YCloud), sin conectar el número hasta diseñar el scope personal.
4. Autorizar por separado la migración de almacenamiento personal y el hardening del webhook de Meta/logs de payload.

P0.4 termina aquí. No se inició P0.5.
