# Yarbi 1.0 — auditoría integral y plan de finalización

**Fecha:** 2026-11-05 (America/Lima)  
**Alcance de esta ejecución:** inspección local y pruebas offline seguras.  
**No realizado:** despliegues, cambios de código comercial, cambios de APK, SQL remoto, acceso a Production, llamadas a Gemini, WhatsApp, Meta, Notion, Calendar, Maps o acciones comerciales.

## Veredicto ejecutivo

Yarbi no necesita otra capa de funciones antes de estabilizar su cadena de versiones. El backend contiene capacidades reales y bastante más avanzadas que el APK instalado, pero existen **tres fuentes de frontend** que no coinciden: el APK 3.4.25, el árbol Android que lo empaquetó y el `www/`/`index.html` del backend actual. Además, la suite integral tiene 36 fallos y el backend raíz contiene 18 Functions mientras su propia prueba de despliegue exige un máximo de 12.

**Recomendación:** no promover el backend raíz, no regenerar APK y no conectar Gemini V4 al flujo comercial hasta cerrar P0 y P1. Primero se debe construir una línea de publicación única, reproducible y comprobable. Esta recomendación no cuestiona las validaciones aisladas ya logradas; las conserva como evidencia de componentes, no como prueba de que todo el producto integrado está listo.

## 1. Evidencia y límites de esta auditoría

| Elemento | Estado | Evidencia local |
|---|---|---|
| Sintaxis del frontend raíz | PASS | `npm run test:syntax`: 3 scripts inline válidos. |
| Núcleo de Yarbi en aislado | PASS local | 96/96 pruebas focalizadas: identidad, contexto, evidencia comercial, proactividad, bandeja, owner scope, trazas e aislamiento. |
| Suite integral del backend | FAIL | `npm test` terminó con código 1; se identificaron 36 casos `not ok`. No se persiste un TAP completo, por eso no se declara un total de casos global. |
| APK instalado | IDENTIFICADO | APK 3.4.25, SHA-256 `26e9b39b74e239f5b0b0e8c64e892ccb0cfebec3df447d8f59664d64007fd278`. |
| Equivalencia backend local ↔ Production actual | NOT PROVEN | No se consultó ni descargó Production durante esta auditoría. |
| Esquema y datos de Production | NOT PROVEN | Fuera del alcance; no hubo conexión remota. |
| Validación visual en teléfono actual | NOT PROVEN | No se ejecutó APK ni emulador en esta auditoría. |

Las pruebas focalizadas fueron ejecutadas solamente con dependencias simuladas y fixtures: `contact-identity`, F3A/F3B/F3C, F3I/F3J/F3K, scope/candidatos, UI-01, trazabilidad y políticas de Preview. Un PASS local no implica que una integración comercial esté habilitada en Production.

## 2. Inventario funcional actual

| Área | Componentes principales | Estado demostrable |
|---|---|---|
| Aplicación Android | Capacitor, reconocimiento de voz, HTML/JS empaquetado en `assets/public` | APK 3.4.25 identificada; no representa el frontend actual del backend. |
| Finanzas y módulos locales | Monolito `www/index.html`: movimientos, agenda, CRM, notas, deudas, stock, gráficos, voz y sincronización | Existe en el frontend; funcionamiento integrado en dispositivo no verificado aquí. |
| Webhook WhatsApp | `api/webhook.js`, `lib/whatsapp-messages.js`, autenticación YCloud, ubicación y trazas | Persistencia canónica/aislamiento cubiertos por pruebas anteriores y locales; ruta comercial real no reejecutada. |
| Procesador canónico | `api/ai/process.js`, recuperación, identidad, contexto comercial y memoria operacional | F3A–F3E están cubiertas en aislado/fixtures; no se debe inferir recuperación masiva de históricos. |
| CRM mínimo | `lib/yarbi-contact-resolution.js`, `yarbi-contact-identity.js`, `yarbi-commercial-context.js` | 96/96 focalizadas incluye identidad por teléfono, no duplicación y contexto determinista. |
| Comprensión de referencias | `api/assistant/reference-candidates.js`, scope, candidatos, resolver, Gemini opcional | Owner scope y lectura aislada validados; comprensión V4 real sigue incompleta. |
| Bandeja del dueño / decisiones | `owner-inbox`, `owner-action`, F3I–F3K, UI-01 | Validado para fixtures aislados y `execute:false`; no habilita mensajería ni acciones comerciales reales. |
| Proactividad | priorización, orquestador y scheduler con política Preview | Pruebas locales/aisladas; no equivale a cron comercial activo. |
| Chat y voz | `chat.js`, `command.js`, `live-token.js`, scripts en el frontend | Existe, pero hay regresiones de pruebas de saludo, Live y comandos; no está listo para considerarse estable. |
| Integraciones externas | Supabase, Gemini, YCloud/Meta, Google Maps, Notion, Calendar, ElevenLabs | Referencias activas halladas; no llamadas en esta auditoría. |
| Observabilidad | `lib/yarbi-trace.js`, ledger, `operation_closed` | Trazabilidad local y aislada previamente validada; queda separar mejor su coste del camino interactivo. |

## 3. Mapa de dependencias y fronteras

```text
APK Android (Capacitor; assets/public)
  └─ frontend monolítico index.html / www/index.html
       ├─ almacenamiento local y espejo local
       ├─ APIs Vercel: chat, command, live-token, webhook, process,
       │  referencias, bandeja/acciones del dueño, preferencias y agenda
       ├─ Gemini / Gemini Live / ElevenLabs (según función)
       └─ Supabase REST/Auth

Webhook YCloud/Meta
  └─ api/webhook.js
       ├─ whatsapp_messages canónico + ai_message_analysis
       ├─ api/ai/process.js en segundo plano
       ├─ identidad/contacto/contexto/memoria operacional
       ├─ trazabilidad
       └─ media/YCloud, Gemini audio y Google Maps si corresponde

Consulta del dueño aislada
  └─ reference-candidates.js
       ├─ Bearer/Auth + scope canónico
       ├─ Gemini opcional o FAST_LOCAL
       ├─ candidatos y resolvedor
       └─ ledger sanitizado
```

La frontera más importante es la siguiente: las rutas F3/UI-01 fueron diseñadas para Preview aislado y datos sintéticos; las rutas `webhook`, `command`, `chat`, `send-whatsapp`, `scheduled-followups`, `supabase-secure` y el frontend monolítico son parte del circuito comercial/histórico. No deben mezclarse al preparar una promoción.

## 4. Estado de versiones y artefactos

| Artefacto | Identidad comprobada | Comparación |
|---|---|---|
| APK actual | `Yarbi_APPDEBUG_3.4.25_WhatsApp_Directo_Estados_20261026.apk`; versionCode 116, versionName `3.4.25-whatsapp-directo-estados` | Referencia de instalación actual. |
| HTML empaquetado APK | 2,882,547 bytes; SHA-256 `60ee1cfe7f93ab3d5451b32426dc9afe8f26ab4bdb2da3c5166054d453101c64` | Coincide con el `index.html` del árbol Android `YARBI_LATEST_CRM_PHASE2_BUILD_2026-09-15`. |
| Árbol Android que corresponde al APK | `YARBI_LATEST_CRM_PHASE2_BUILD_2026-09-15` | Sus `yarbi-assistant.js`, `yarbi-memory-center.js`, `manifest.json` y `service-worker.js` coinciden con el APK. |
| Backend actual `www/` | `www/index.html` SHA-256 `dbc4a1a1ee5c8b32d8f197052f46f8632caeeacd12e9ec96028c44aaddb586a1` | No coincide con el HTML empaquetado. Sus scripts assistant/memory/manifest sí coinciden, pero `service-worker.js` no. |
| Backend raíz | `index.html` SHA-256 `19d2ead74b76a2624d1fe9268e0b59ba5eb62af51bbe124d4ecf3d57921fc0c2` | Tampoco coincide ni con el APK ni con `www/index.html`. |
| Bandeja UI-01 | `www/yarbi-owner-inbox-ui.js` existe en backend | No existe en el APK empaquetado; por tanto no se debe decir que está en la aplicación Android instalada. |
| Production Vercel | Código desplegado verificable | NOT PROVEN en esta auditoría local. No debe asumirse equivalente a ningún árbol local. |

**Conclusión de versión:** el repositorio no es un repositorio Git (`git status` devuelve “not a git repository”), por lo que no hay commit, etiqueta ni árbol inmutable que determine qué es liberable. Los directorios `backups` y archivos `*.before-*` son evidencia histórica, no código activo; no deben pasar a un build ni a búsquedas de arquitectura.

## 5. Diagnóstico de rendimiento

### Hechos medidos

| Métrica | Resultado | Interpretación correcta |
|---|---|---|
| Pruebas focalizadas | 96 PASS en 243 ms | Ejecución local con mocks; no es latencia móvil ni de nube. |
| FAST_LOCAL mock | p95 2.195 ms | Sólo mide la ruta simulada. |
| Referencias autenticadas Preview (informe previo) | p95 handler 3,346 ms | Dato aislado útil; no incluye una sesión de navegador persistente. |
| Mismo informe, runner completo | p95 33,808 ms | Incluye procesos `vercel curl`, Deployment Protection y red local; no debe presentarse como UX real. |
| Gemini V4, validación previa | p95 Gemini 2,208 ms | El proveedor responde; calidad semántica no está cerrada. |

### Cuellos de botella demostrables por código

1. **Carga y mantenimiento del frontend monolítico.** `www/index.html` mide 2,771,708 bytes y contiene UI, finanzas, CRM, voz, sincronización e integraciones. Esta concentración incrementa la probabilidad de que una corrección visual afecte otros módulos; también hace que el service worker sea parte crítica de cada liberación.
2. **Lectura de dossier con fan-out.** `lib/whatsapp-messages.js:61-77` resuelve primero el identificador y después lanza ocho consultas REST paralelas (contacto, memoria, alertas, agenda, observaciones, estilo, análisis y mensajes). El paralelismo reduce espera serial, pero aumenta coste/red, tamaño de respuesta y presión sobre Supabase. Hay caché de 90 s y máximo 80 entradas (`:25-48`), pero no existe medición de p95 con datos y red reales dentro de esta auditoría.
3. **Trazas síncronas en lectura del dueño.** `api/assistant/reference-candidates.js:168` y `:212` esperan la escritura de traza inicial y terminal. Esto preserva auditabilidad, pero participa directamente en la latencia percibida. Las llamadas a scope y comprensión se paralelizan en `:175-181`, lo cual es una decisión correcta que conviene conservar.
4. **Timers y sincronizaciones múltiples en frontend.** La inspección estática encontró varios `setInterval` y rutas de actualización/sincronización en `www/index.html`, incluidos sincronización de Yarbi, Notion, audio/voz y guardados. No se midió su frecuencia efectiva en un dispositivo; por ello el impacto exacto queda NOT PROVEN, pero es una hipótesis prioritaria para el retraso reportado por el usuario.

## 6. Redundancia y solapamientos

| Área | Duplicación / ambigüedad | Impacto | Acción posterior |
|---|---|---|---|
| Frontend | APK, Android fuente, `index.html` raíz y `www/index.html` divergen | Muy alto: una corrección puede probarse en un archivo y publicar otro. | P0: manifiesto y una sola entrada liberable. |
| Endpoints de datos | `webhook.js` consulta `messages` legacy y `whatsapp_messages` canónico; la tabla legacy ya fue señalada como no verificable en fases previas | Alto: duplicados, fallos por tabla ausente, lectura inconsistente. | P1: catálogo de rutas canónicas/legacy y política explícita de tolerancia. |
| Resolución de cliente | chat/command histórico, dossier, nuevo resolver por teléfono y candidato del dueño | Alto: diferentes rutas pueden producir respuestas incompatibles. | P2: fachada única de identidad y consulta, sin eliminar nada antes de cobertura. |
| IA | Gemini directo en frontend, `chat`, `command`, procesador, audio y V4 aislado | Alto: múltiples prompts/modelos/contratos y latencias difíciles de atribuir. | P3: catálogo de proveedores y contrato de salida por ruta. |
| Integraciones | 44 referencias literales a `https://misfinanzas-backend.vercel.app` en `www/index.html`; varias Functions conservan fallbacks a Production | Muy alto en Preview/recuperación: un entorno mal configurado puede dirigirse a Production. | P0: eliminar fallback y centralizar configuración validada. |
| Backup/histórico | `backups`, `*.before-*`, múltiples carpetas de release en el mismo espacio | Medio/alto: búsquedas, empaquetado y revisiones se contaminan. | P6: archivar fuera de árbol liberable después de crear manifiestos. |

## 7. Riesgos demostrados

| Prioridad | Hallazgo | Evidencia | Consecuencia |
|---|---|---|---|
| P0 | No existe una única fuente de frontend liberable | Tres hashes diferentes para APK, `www/index.html` y raíz. | APK, Preview y pruebas pueden no representar lo mismo. |
| P0 | La suite completa no está verde | `npm test` exit 1; 36 fallos identificados. Ejemplos: `tests/fast-read-path.test.js:23`, `tests/e2e-controlled.test.js:37`, `tests/two-brains-architecture.test.js:18`. | No hay compuerta fiable de regresión. |
| P0 | El backend raíz cuenta 18 Functions mientras `tests/vercel-deployment.test.js:18` exige máximo 12 | Conteo estático: 18 archivos activos bajo `api/`. | El árbol no satisface su propio contrato de despliegue Hobby; no se sabe qué subset puede desplegarse sin una estrategia. |
| P0 | Fallbacks explícitos hacia Production | `api/supabase-secure.js:1`, `api/actions/approve.js:7`, `api/assistant/command.js:3`, `preferences.js:3`, `send-whatsapp.js:8`, `scheduled-followups.js:1`; además 44 URLs literales en `www/index.html`. | Una variable ausente puede romper aislamiento o dirigir tráfico al proyecto no previsto. La protección no es uniforme en todas las rutas. |
| P1 | Contrato legacy/canónico de mensajes no está cerrado | `api/webhook.js` aún consulta/escribe `messages` y `whatsapp_messages` (por ejemplo `:307-342`) | Riesgo de fallos de almacenamiento, lecturas duplicadas o dependencia de un esquema que no fue demostrado. |
| P1 | Procesamiento de análisis y límite de reintentos no tiene prueba integral verde | Falla `tests/data-integrity-hardening.test.js:9`; la Fase 2 validó componentes aislados. | No puede afirmarse que los omitidos históricos o cada caso de retry estén solucionados en el producto completo. |
| P2 | Dossier de cliente puede ser costoso | fan-out de 1 + 8 consultas en `lib/whatsapp-messages.js:61-77` | Esperas visibles y datos obsoletos bajo red lenta. |
| P2 | Service worker del backend no coincide con el de APK | APK/Android: `8d1fe…`; backend `www`: `08c2d…` | Riesgo de caché o UI aparente “vieja” tras un build, incluida la percepción de iconos que aparecen/desaparecen. |
| P3 | Comprensión Gemini V4 no está lista para integración comercial | `YARBI_GEMINI_V4_VALIDACION_SEMANTICA_FINAL.md`: 18/32 semánticos; corrección 0/6, temporal 0/3, continuidad 1/4. | No debe reemplazar ni alimentar decisiones comerciales reales aún. |
| P3 | Disponibilidad de Gemini varía | Informe temporal: un 503 bloqueó F3TV-01; otros dos no se ejecutaron. | El usuario verá lentitud/fallos si la ruta no degrada de forma explícita y visible. |
| P4 | UI-01/owner actions son correctas sólo en aislado | `PREVIEW_UI01_AISLADO/PREVIEW_UI01_DEPLOYMENT_VALIDACION.md`, tests UI-01 locales | La bandeja es una buena base, no una autorización para conectar WhatsApp/comercial real. |
| P5 | Chat/voz tiene regresiones de contrato | Fallos de saludo, VAD, Gemini Live, comandos y formularios en la suite completa. | Coincide con los síntomas reportados: conversación poco natural, retraso y acciones/formularios redundantes. |
| P6 | Ausencia de control de versiones del backend | No existe `.git` en el árbol backend. | No hay base para atribuir cambios, comparar pruebas o revertir con seguridad. |

## 8. Plan priorizado de finalización 1.0

### P0 — Bloquear liberaciones ambiguas

**Objetivo:** hacer inequívoco qué código se prueba, despliega y empaqueta.

1. Crear un manifiesto de liberación firmado localmente: APK hash, `www` hash, backend package-lock hash, listado de Functions, migraciones requeridas y deployment candidato. No seleccionar archivos automáticamente.
2. Decidir y documentar una única fuente de frontend (`www/` o una fuente de build explícita). Eliminar de la cadena de build la raíz duplicada, o exigir que sea byte-a-byte idéntica antes de publicar.
3. Establecer una compuerta obligatoria: sintaxis PASS, suite base PASS, inventario de Functions compatible con el plan, y sin fallback de Production en Preview.
4. Corregir/actualizar primero las 36 pruebas fallidas, clasificando cada una como regresión real o expectativa obsoleta. Ninguna se debe “silenciar” sin evidencia.

**Criterio de salida P0:** build reproducible que indique exactamente qué `index.html`, service worker y APIs integran APK/Preview; suite acordada verde; ninguna configuración Preview puede caer a Production por default.

### P1 — Cerrar el camino canónico de mensajes y agenda

1. Trazar cada escritura y lectura de `messages` legacy frente a `whatsapp_messages`.
2. Declarar qué tabla es canónica por ruta, qué fallback se permite y cómo se comporta cuando el legacy falta.
3. Revalidar en aislado reentrega, tres intentos, `identity_pending`, cierre de trazas y no duplicación de agenda/servicio.
4. Sólo después, diseñar una recuperación gradual de históricos con `correlation_id`; nunca activar una recuperación masiva desde “Actualizar Yarbi”.

**Criterio de salida P1:** prueba física canónica de webhook → análisis → identidad/contexto → estado, con reentrega segura y fallos visibles.

### P2 — Reducir latencia percibida sin recortar contexto

1. Instrumentar p50/p95 por etapa en dispositivo y Vercel: bootstrap, cache local, mirror, dossier, Gemini, traza y render. Separar tiempo de runner/red de tiempo de usuario.
2. Unificar la lectura de cliente detrás de una fachada que devuelva primero resumen local/cache y complete detalle en segundo plano.
3. Revisar el fan-out del dossier: columnas mínimas, límites por entidad y consulta agregada/RPC sólo si los datos medidos lo justifican.
4. Inventariar y consolidar timers/sync para que haya un coordinador de refresco, no varios ciclos compitiendo.

**Criterio de salida P2:** presupuesto explícito de latencia y métricas reales de teléfono; ningún refresh destruye la tarjeta, propuesta o transcripción visible.

### P3 — Chat y voz confiables

1. Recuperar pruebas de saludo, Live, VAD, `barge-in`, formularios y comandos antes de cambiar la apariencia.
2. Mantener la transcripción incremental local/Live separada de la respuesta final y etiquetar estados visibles: escuchando, procesando, hablando, error y reintento.
3. Consolidar las órdenes de agenda: una orden debe actualizar estado existente o abrir el formulario mínimo correcto, nunca duplicar visita/servicio.
4. Mantener confirmación explícita para envío real, pero distinguir claramente “borrador”, “programado” y “enviado confirmado”.

**Criterio de salida P3:** batería móvil/manual de 10 guiones críticos sin formularios duplicados ni mensajes falsamente confirmados.

### P4 — Integrar Gemini V4 con prudencia

1. Mantener V4 aislado hasta alcanzar 90% en casos no ambiguos y 100% de seguridad/polaridad, en una batería fija no usada para diseñar prompts.
2. Priorizar correcciones, temporalidad y continuidad, que son las familias aún débiles; no añadir reglas de palabras clave indiscriminadas.
3. Integrar como proveedor de comprensión con degradación segura: si falla, pedir aclaración o usar información estructurada, nunca inventar cliente, servicio, fecha o acción.
4. Persistir sólo el diagnóstico sanitizado y métricas, no prompts ni conversaciones completas en trazas.

**Criterio de salida P4:** evaluación independiente PASS y rollout por feature flag/owner sintético antes de cualquier cliente real.

### P5 — Unificar CRM, agenda, seguimiento y bandeja

1. Definir un vocabulario universal de estados que CRM, Agenda, tarjetas, alertas y Yarbi consuman del mismo registro canónico.
2. Conservar “visitado”, “construido”, “cobro parcial/completo”, “sin respuesta”, “retomar”, “no contactar” y “ya contabilizado” como transiciones trazables; no como textos independientes por pantalla.
3. La bandeja del dueño debe ser la vista de decisión; CRM sigue siendo el expediente. Las recomendaciones no pueden ejecutar envíos ni cobros sin la política/confirmación correspondiente.

**Criterio de salida P5:** una modificación de estado aparece igual en CRM, Agenda, alertas y conversación, con historial y reversión definida.

### P6 — Gobernanza de versión, datos y operación

1. Inicializar/recuperar un repositorio Git o una fuente de control de cambios equivalente, sin reescribir los respaldos existentes.
2. Mover copias históricas fuera del árbol que Vercel/APK pueda empaquetar y añadir exclusiones explícitas.
3. Mantener un changelog de migraciones locales/aplicadas y un manifiesto de entorno (sin secretos) para Preview y Production.
4. Crear una matriz de smoke tests: APK, Preview aislado, backend candidato y Production observacional, siempre con alcance inequívoco.

## 9. Orden recomendado de ejecución

1. **P0.1:** congelar el backend actual como candidato de auditoría y generar manifiesto de versiones.  
2. **P0.2:** decidir fuente web única y reparar la suite base.  
3. **P0.3:** retirar fallbacks de Production y resolver el límite de Functions mediante consolidación explícita de rutas, no mediante borrado accidental.  
4. **P1:** validar camino canónico completo en aislado.  
5. **P2/P3:** medir teléfono real y cerrar chat/voz/agenda.  
6. **P4:** recuperar comprensión semántica V4.  
7. **P5:** conectar UX de CRM/bandeja sobre los estados canónicos.  
8. **P6:** generar APK sólo cuando frontend, backend, migraciones y pruebas estén congelados por el manifiesto.

## 10. Estado de Yarbi 1.0 por componente

| Componente | Decisión |
|---|---|
| Finanzas/CRM/agenda del APK actual | Operativo como artefacto instalado, pero congelado respecto del backend actual. |
| Trazabilidad y aislamiento | Base sólida, validada localmente/aislado; conservar. |
| Identidad CRM y contexto determinista | Base sólida en aislado; no reauditar salvo regresión. |
| Bandeja proactiva sintética | Validada en aislado; no promocionar como automatización comercial. |
| Gemini V4 | Prometedor técnicamente; no listo semánticamente para producción. |
| Chat, voz y comandos comerciales | Necesitan estabilización por fallos actuales de la suite y medición móvil real. |
| Publicación Android/Vercel | BLOQUEADA hasta resolver P0. |

## 11. Artefactos revisados

- `package.json`, `package-lock.json`, `vercel.json`, `proxy.js`, `proxy.mjs`.
- `api/webhook.js`, `api/ai/process.js`, `api/assistant/reference-candidates.js`, `api/assistant/command.js`, `api/assistant/chat.js`, `api/assistant/send-whatsapp.js`, `api/assistant/scheduled-followups.js`, `api/supabase-secure.js`.
- `lib/yarbi-trace.js`, `yarbi-runtime-config.js`, `whatsapp-messages.js`, `yarbi-contact-resolution.js`, `yarbi-commercial-context.js`, `yarbi-owner-reference-candidates.js`, políticas Preview.
- `www/index.html`, raíz `index.html`, `www/service-worker.js`, `www/yarbi-assistant.js`, `www/yarbi-memory-center.js` y `www/yarbi-owner-inbox-ui.js`.
- Árbol Android `YARBI_LATEST_CRM_PHASE2_BUILD_2026-09-15` y APK 3.4.25.
- Informes aislados de owner scope, referencias autenticadas, UI-01 y Gemini V4.

## Cierre

**Estado recomendado:** `YARBI_1_0_CONSOLIDACION_REQUERIDA_ANTES_DE_NUEVAS_FUNCIONES`.

La siguiente acción más pequeña y segura es **P0.1: crear el manifiesto de línea de publicación y elegir explícitamente el frontend fuente**, sin desplegar, sin tocar datos y sin cambiar comportamiento comercial.
