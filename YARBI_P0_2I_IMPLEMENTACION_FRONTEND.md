# Yarbi P0.2I — Implementación de frontend unificado

Fecha: 2026-11-05  
Estado: **IMPLEMENTADO Y VALIDADO LOCALMENTE — SIN DESPLIEGUE**

## Resultado

Se creó una fuente única editable en `frontend/` y se generaron dos artefactos desde ella:

| Artefacto | Ubicación | Configuración de API | Estado |
| --- | --- | --- | --- |
| Fuente canónica | `frontend/` | Plantilla sin destino implícito | Validada localmente |
| Web | `dist/web/` | Mismo origen del deployment | Generado y validado |
| Android WebView | `dist/android-www/` | `https://android-build.invalid` sintético y explícito | Generado y validado; no es un artefacto release |

El origen Android sintético se usó para demostrar que la salida exige una URL HTTPS explícita y no puede caer por defecto en Production. No se generó APK.

## Integración realizada

La fuente parte de `YARBI_BACKEND_MERGED_20260930/www`, incorpora de forma controlada el delta de `YARBI_LATEST_CRM_PHASE2_BUILD_2026-09-15/www` y conserva explícitamente la Bandeja del dueño.

### Funcionalidades verificadas en la fuente

- Agenda general, interpretación de fecha/hora, borradores y reparación de visitas históricas (`gfcManualAgendaDraft`, `gfcRepairLegacyVisitedAgenda`).
- Seguimiento CRM, propuestas de mensaje, alternativas, recordatorios y borrado con decisión de caja (`crm-followup-*`, `crm-delete-record-sheet`).
- Bandeja del dueño y sus contratos `/api/assistant/owner-inbox` y `/api/assistant/owner-action`.
- CRM, Agenda, Movimientos, Chat, Gemini Live/voz, memoria, instrucciones, WhatsApp, Notion y las rutas API previamente usadas.
- Módulos compartidos conservados: `yarbi-assistant.js`, `yarbi-memory-center.js`, avatar y manifiesto.

## Configuración por entorno

`frontend/runtime-config.js` es una plantilla de build:

- Web genera `apiOrigin = __YARBI_SAME_ORIGIN__`, que se resuelve exclusivamente al origen actual del navegador.
- Android exige `YARBI_ANDROID_API_ORIGIN` HTTPS, sin credenciales ni ruta; si falta o es inválido el build se rechaza.
- No existe fallback hacia Production.
- Las 44 referencias literales a `https://misfinanzas-backend.vercel.app` fueron eliminadas de `frontend/` y ambos artefactos generados.
- No se incluyen secretos en los artefactos.

## Service Worker

Se reemplazó la divergencia histórica `v2`/`v3` por una plantilla versionada con el identificador determinista de release:

`yarbi-static-p02i-7ae1a3f56c3c83d1`

Sólo incluye una lista explícita de recursos estáticos. Las rutas `/api/` y cualquier respuesta privada o dinámica quedan fuera de caché.

## Sistema de build

Scripts añadidos a `package.json`:

```text
npm run build:frontend:web
npm run build:frontend:android
npm run test:frontend:unified
```

- `scripts/bootstrap-unified-frontend.cjs`: bootstrap único, no modifica los dos árboles congelados.
- `scripts/build-unified-frontend.cjs`: genera artefactos deterministas y sólo reemplaza un `dist/` que ya tenga manifiesto P0.2I válido.
- `scripts/write-p02i-manifest.cjs`: genera el manifiesto de hashes.

## Pruebas ejecutadas

| Verificación | Resultado |
| --- | --- |
| Presencia de Agenda/CRM exclusivos Android | PASS |
| Presencia y carga final de Bandeja del dueño | PASS |
| Contratos de chat, Live, WhatsApp, Notion y rutas API | PASS, estático/sintético |
| Web mismo origen | PASS |
| Android sin origen explícito | PASS: build rechazado de forma segura |
| Android con origen HTTPS explícito | PASS |
| Reproducibilidad: dos builds web y dos Android | PASS: manifiestos idénticos por destino |
| Sintaxis de 8 scripts inline: fuente/web/Android | PASS |
| Sintaxis de memoria y Bandeja | PASS |
| URLs literales Production en `frontend/` y `dist/` | PASS: 0 |
| Proveedores, Gemini, Supabase remoto, Vercel, APK | No utilizados |

La prueba dedicada terminó con **3/3 PASS**. También se ejecutó la suite histórica `test:unit`: conserva 12 fallos en el HTML raíz heredado, fuera del árbol `frontend/` y ya fuera del alcance de P0.2I. No se alteraron para hacer pasar esta fase.

## Archivos creados o modificados

- `frontend/` — fuente unificada editable.
- `dist/web/` y `dist/android-www/` — salidas generadas.
- `scripts/bootstrap-unified-frontend.cjs`.
- `scripts/build-unified-frontend.cjs`.
- `scripts/write-p02i-manifest.cjs`.
- `tests/frontend-unified-build.test.js`.
- `package.json` — scripts de build y prueba solamente.
- `YARBI_P0_2I_SHA256SUMS.txt`.

Los árboles de referencia Android y backend `www/` terminaron verificados con sus hashes congelados; el APK 3.4.25, `vercel.json`, las Functions, migraciones y contratos API no fueron modificados.

## Hashes y trazabilidad

- Fuente canónica digest: `7ae1a3f56c3c83d14ed4b03a0cbdd2e67e3918f88ca735a8b5b98eaad168095b`.
- Release ID: `p02i-7ae1a3f56c3c83d1`.
- Manifiesto SHA-256: ver `YARBI_P0_2I_SHA256SUMS.txt`.
- Manifiestos internos: `dist/web/BUILD_MANIFEST.json` y `dist/android-www/BUILD_MANIFEST.json`.

## Límites y siguiente decisión

P0.2I no modifica Vercel ni Capacitor: por lo tanto las salidas generadas no están publicadas ni sincronizadas a Android. Una fase posterior debe decidir, con Preview aislado, si Vercel adoptará `dist/web/` como `outputDirectory` y si Capacitor sincronizará `dist/android-www/` hacia su `webDir`. Esa fase deberá validar visualmente y por regresión las interacciones reales antes de desplegar o generar un APK.

No se inició P0.3.
