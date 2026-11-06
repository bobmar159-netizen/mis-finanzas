# Yarbi P0.2 — Arquitectura de frontend unificado

Fecha de análisis: 2026-11-05  
Alcance: lectura local. No se modificaron fuentes, Capacitor, Vercel, APK, datos ni servicios remotos.

## Resultado ejecutivo

La arquitectura recomendada es **una fuente editable única y dos artefactos generados**. Ninguna de las tres copias actuales puede declararse por sí sola como fuente canónica universal sin perder una capacidad comprobada:

- El APK 3.4.25 y su árbol Android conservan funciones de Agenda y seguimiento CRM que no aparecen en el frontend backend.
- El frontend backend añade la Bandeja del dueño (`yarbi-owner-inbox-ui.js`), ausente del APK.
- La raíz web del backend y su `www/` son el mismo frontend lógico salvo la ruta relativa del módulo de Bandeja; no son dos productos que se deban mantener.

Por ello, la decisión definitiva para una versión posterior es crear un árbol fuente `frontend/` dentro de `YARBI_BACKEND_MERGED_20260930`, integrado manualmente a partir de ambas líneas verificadas. Desde allí se generarán una salida web para Vercel y una salida `www/` para Capacitor. **P0.2 no crea, copia ni activa ese árbol.**

## Referencias congeladas usadas

| Referencia | Identidad / SHA-256 | Papel comprobado |
| --- | --- | --- |
| APK `Yarbi_APPDEBUG_3.4.25_WhatsApp_Directo_Estados_20261026.apk` | `26e9b39b74e239f5b0b0e8c64e892ccb0cfebec3df447d8f59664d64007fd278` | APK instalada de referencia; versión Android `3.4.25-whatsapp-directo-estados`. |
| HTML empaquetado en APK | `60ee1cfe7f93ab3d5451b32426dc9afe8f26ab4bdb2da3c5166054d453101c64` | Coincide byte a byte con Android `www/index.html`. |
| Android `www/index.html` | mismo SHA del HTML empaquetado; 2,882,547 bytes | Fuente comprobada del APK. |
| Backend `index.html` | `19d2ead74b76a2624d1fe9268e0b59ba5eb62af51bbe124d4ecf3d57921fc0c2`; 2,771,995 bytes | Candidato web local servido desde la raíz actual. |
| Backend `www/index.html` | `dbc4a1a1ee5c8b32d8f197052f46f8632caeeacd12e9ec96028c44aaddb586a1`; 2,771,708 bytes | Candidato web/móvil posterior; integra la Bandeja mediante ruta local. |

El manifiesto P0.1 sigue siendo la fuente de integridad: `YARBI_1_0_RELEASE_MANIFEST.json`.

## 1. Comparación funcional

Leyenda: **A** presente en APK y backend; **B** nueva del backend; **C** exclusiva del APK; **D** implementación distinta sin cambio funcional demostrado; **E** configuración por entorno; **F** regresión potencial; **G** no concluyente con evidencia local estática.

| Área | APK / Android | Backend raíz / `www` | Clase | Evidencia y consecuencia |
| --- | --- | --- | --- | --- |
| CRM base, tarjetas y clasificación | Presente | Presente | A | El bloque principal y sus APIs siguen presentes en ambos HTML. |
| Seguimiento CRM y propuestas de mensaje | Disponible: opciones, enviar ahora, recordatorio, conversación contextual y borrado con decisión sobre caja | No aparece el bloque equivalente en backend | C / F | Android posee IDs `crm-followup-*` y `crm-delete-*`; sustituirlo por backend perdería esta capacidad. |
| Agenda de visitas/trabajos | Presente | Presente | A | Ambos conservan Agenda, formulario y rutas de integración. |
| Eventos personales de Agenda | Funciones `agendaGeneralTitle`, `gfcManualAgendaDraft`, análisis de fecha/hora y reparación de visitas históricas | No están | C / F | Copiar backend sobre Android perdería eventos generales y reparación histórica. |
| Movimientos / Caja / servicios | Presente | Presente | A | No hay evidencia de una ruta funcional eliminada en la comparación estática. Requiere regresión futura antes de publicar una integración. |
| Bandeja proactiva del dueño | No está empaquetada en APK | Módulo adicional `yarbi-owner-inbox-ui.js`; usa `/api/assistant/owner-inbox` y `/api/assistant/owner-action` | B | El backend añade UI autenticada de autorizar, posponer y descartar. Integrarla exige mantener los contratos de sus dos Functions. |
| Chat Yarbi y comandos | Presente | Presente | A | Ambos llaman a chat, comando y token Live. `yarbi-assistant.js` coincide byte a byte. |
| Voz / Gemini Live / TTS | Presente, con detección Capacitor | Presente | A | HTML conserva los adaptadores para `SpeechRecognition`, `YarbiTts`, `YarbiLiveService` y ciclo de vida Android. |
| Gemini no Live / procesamiento | Presente | Presente | A | Ambos contienen rutas de chat, `live-token` y `/api/ai/process`. La evolución Gemini V4 reside principalmente en backend, no demuestra una UI diferente todavía. |
| Memoria, entrenamiento e instrucciones | Presente | Presente | A | `yarbi-memory-center.js` es idéntico: SHA `354782d290df7570f49dca0377022fc4fe7c74ab266ad8b277953046a40c443a`. |
| WhatsApp, búsqueda de clientes y sincronización | Presente | Presente | A | Ambas fuentes contienen las rutas de mensajes, espejo local, hábitos, alertas y resolución de ubicación. |
| Notion / Calendar / configuración de cuenta | Presente | Presente | A | Las rutas de preferencias, colecciones, Notion y cuenta existen en ambas. La conectividad real no se verificó en P0.2. |
| Service Worker | Versión de caché `fnz-pro-cache-v3` | Versión de caché `fnz-pro-cache-v2` | E / F | Los assets enumerados son equivalentes, pero bajar a `v2` puede conservar caché antigua; no debe adoptarse sin estrategia de versión. |
| Backend raíz vs backend `www` | Diferencia no aplicable | Sólo cambia `./www/yarbi-owner-inbox-ui.js` por `./yarbi-owner-inbox-ui.js` | D | Son el mismo HTML lógico con una diferencia de ruta por ubicación. Deben pasar a ser una única salida generada, no archivos editados a mano. |

### Hallazgos medibles de dependencia

- Android APK: 634 IDs y 1,681 funciones declaradas en el HTML.
- Backend: 609 IDs y 1,672 funciones declaradas.
- Las nueve funciones exclusivas visibles de Android son las de Agenda general, borrador/fecha y reparación de estado visitado.
- `yarbi-assistant.js` es idéntico en ambas líneas (`caf1a9028085a0d3f0b2048145b2af2ba4e8ab8352c10af5b691b6344dea1e3e`).
- `yarbi-memory-center.js` es idéntico en ambas líneas.
- `yarbi-owner-inbox-ui.js` sólo existe en backend: SHA `d091b74667206243400d75cefcb054d6ffcf67afdb391ad9433df360338f8dea`.
- La fuente Android `index.html` y `www/index.html` son idénticas entre sí y también coinciden con los assets del APK.

## 2. Dependencias que impiden copiar una versión sobre otra

| Dependencia | Consumidor | Riesgo de una copia directa |
| --- | --- | --- |
| IDs y handlers globales `crm-followup-*`, `crm-delete-*`, `ga-*`, `gfc-yarbi-context-menu` | CRM y Agenda Android | El backend no los contiene; se romperían seguimientos, recordatorios, borrado con decisión de caja y Agenda general. |
| `window.gfcYarbiOwnerRefresh`, `gfcYarbiOwnerDecision`, `gfcOpenYarbiPending` | Módulo de Bandeja backend | El APK no carga el script ni sus dos APIs; añadir sólo el HTML no habilita la Bandeja. |
| `yarbi-memory-center.js`, `yarbi-assistant.js` | Chat, entrenamiento, instrucciones, voz y borradores | Son iguales hoy; deben conservarse como módulos compartidos y no duplicarse por plataforma. |
| `window.Capacitor` y plugins `SpeechRecognition`, `YarbiTts`, `YarbiLiveService`, `GfcNotificationPlugin`, `YarbiMediaLibrary` | Android | Web debe hacer feature detection; Android requiere conservar plugins y ciclo de vida nativo. |
| Rutas `/api/*` | UI compartida | Ambas UI usan 18 Functions. La Bandeja añade `owner-inbox` y `owner-action`; no pueden suprimirse ni renombrarse sin cambiar contratos. |
| URL literal de producción y `fnz_yarbi_api_base` | Sync, chat, WhatsApp, preferencias, memoria | Hay 44 referencias literales inventariadas en P0.1. Copiar no separa Preview/Production y mantiene el riesgo de apuntar al backend equivocado. |
| Service Worker y nombre de caché | Web y Android WebView | Copiar la versión `v2` sobre la APK `v3` puede dejar recursos obsoletos; el build debe inyectar un identificador único de release. |

### APIs compartidas observadas

La UI común depende, entre otras, de `/api/assistant/chat`, `/api/assistant/command`, `/api/assistant/live-token`, `/api/assistant/preferences`, `/api/assistant/collections`, `/api/assistant/send-whatsapp`, `/api/ai/process`, `/api/location/resolve`, `/api/whatsapp/messages`, `/api/notion-proxy`, `/api/actions/approve` y `/api/supabase-secure`. La Bandeja suma `/api/assistant/owner-inbox` y `/api/assistant/owner-action`.

## 3. Arquitectura objetivo recomendada

```
frontend/                         # única fuente editable propuesta
  index.html
  service-worker.js
  yarbi-assistant.js
  yarbi-memory-center.js
  yarbi-owner-inbox-ui.js
  runtime-config.js.template
  assets/
       |
       +-- build:frontend:web ----> dist/web/       # artefacto estático Vercel
       |
       +-- build:frontend:android -> Android/www/   # artefacto Capacitor, no editable
                                      |
                                      +-- capacitor sync -> APK
api/, lib/, proxy.js, vercel.json                  # backend único, fuera de frontend/
```

### Decisiones

1. **Fuente canónica futura:** `YARBI_BACKEND_MERGED_20260930/frontend/` como un árbol nuevo, aún no creado. Es preferible a elegir una copia actual porque permite integrar explícitamente las capacidades únicas de ambas líneas y conservar el backend junto a sus 18 Functions.
2. **Punto de partida:** backend `www/` por incluir la Bandeja modular y estar junto al backend; antes de declararlo completo debe recibir integración manual, revisada y probada, de las capacidades exclusivas Android descritas arriba.
3. **Salida Vercel:** `dist/web/`, definida como `outputDirectory` o configurada mediante build del proyecto Vercel. Las Functions continúan en `api/` y sus rutas en `vercel.json`.
4. **Salida Android:** el contenido generado reemplaza el artefacto `www/` antes de `capacitor sync`; ese directorio deja de ser una fuente manual. Capacitor conserva `webDir: "www"`.
5. **Configuración por entorno:** un `runtime-config.js` generado debe contener sólo origen público de API, modo de entorno y release ID. Web usará origen relativo para su propio host; Android usará una URL autorizada por configuración de build. No se incorporan secretos al artefacto.
6. **Service Worker:** generado desde la misma plantilla, con cache name derivado del release ID. Nunca reutilizar a ciegas `v2` o `v3`.

## 4. Migración propuesta (para una fase posterior)

### Conservación obligatoria

- El APK 3.4.25 y todo el árbol Android de referencia, sin sobrescribirlo.
- Backend `api/`, `lib/`, `proxy.js`, `vercel.json`, migraciones y manifiestos.
- Módulos idénticos verificados: `yarbi-assistant.js` y `yarbi-memory-center.js`.
- Funcionalidades exclusivas del APK: Agenda general, reparación de visitas, seguimiento CRM, propuestas/recordatorios y eliminación con tratamiento explícito de caja.
- Módulo backend: `yarbi-owner-inbox-ui.js` y sus contratos API.

### Generados automáticamente

- `dist/web/**` para Vercel.
- `Android/www/**` para Capacitor (incluye `index.html`, service worker, módulos y assets).
- Un manifiesto de build con SHA-256 de ambos artefactos y release ID.

### Integración manual necesaria antes del primer build unificado

1. Portar los nueve handlers y todos los IDs/CSS/llamadas que componen Agenda general, reparación de visita y seguimiento CRM al árbol fuente nuevo.
2. Integrar la Bandeja como módulo opcional, cargado después de que `switchPage`, `toast` y las APIs de autenticación estén disponibles.
3. Reemplazar las 44 URLs literales por lectura de configuración de runtime, preservando exactamente los contratos y rutas.
4. Resolver el Service Worker como plantilla por release y probar actualización desde APK 3.4.25.
5. Ejecutar regresión por plataforma: CRM, Agenda, Movimientos, Chat, voz nativa, memoria/instrucciones, sincronización, Notion, WhatsApp, configuración y Bandeja.

### Plan de transición seguro

1. Crear el árbol fuente y un build determinista en una fase autorizada, sin tocar la app publicada.
2. Integrar manualmente las diferencias con pruebas locales y un manifiesto de paridad de IDs/handlers.
3. Generar `dist/web` y Android `www` desde el mismo commit.
4. Validar un Preview aislado Vercel y un APK debug separado contra pruebas sintéticas.
5. Comparar hashes, contratos API y la matriz funcional antes de promover cualquiera de los artefactos.
6. Publicar web y APK sólo tras autorización independiente.

### Reversión

- Web: volver el deployment al artefacto estático y configuración de release anteriores, sin tocar APIs ni datos.
- Android: reinstalar la APK 3.4.25 congelada; conservar su árbol `www` intacto.
- Service Worker: publicar un release ID nuevo que invalide el caché del artefacto fallido; no reutilizar cache names históricos.

## Riesgos y decisiones arquitectónicas pendientes

1. **Integración funcional obligatoria:** seleccionar el backend `www` tal como está sería una regresión para Agenda/CRM del APK; seleccionar Android tal como está excluiría la Bandeja. La integración manual es imprescindible.
2. **URL de API:** el frontend aún tiene referencias literales a Production. La futura configuración por entorno debe diseñarse y probarse antes de convertir `frontend/` en la fuente de publicación.
3. **Service Worker:** existe divergencia v2/v3. Se requiere una política de versionado por release y prueba de actualización en WebView.
4. **Vercel:** la configuración local actual no define `buildCommand` ni `outputDirectory`; P0.3 deberá preparar ambos en Preview, no inferirlos por la existencia de `www/`.
5. **Pruebas de paridad:** no hay evidencia de que una mezcla de los dos HTML sea funcional hasta ejecutar pruebas por módulo; por eso esta propuesta no modifica archivos ni declara listo un deployment.

## Conclusión

**Arquitectura definitiva recomendada:** un árbol `frontend/` editable dentro del repositorio backend, con builds deterministas a `dist/web` y al `www/` usado por Capacitor. La creación e integración deben realizarse en una fase de implementación posterior; P0.2 sólo fija la decisión y los requisitos para evitar perder capacidades ya verificadas.

Estado: **P0.2 COMPLETADO — PROPUESTA LISTA PARA IMPLEMENTACIÓN AUTORIZADA.**
