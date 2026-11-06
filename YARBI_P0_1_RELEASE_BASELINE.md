# Yarbi P0.1 — congelación y manifiesto de release

**Estado:** `P0_1_COMPLETADO_CON_DECISION_UNIVERSAL_BLOQUEADA`  
**Alcance:** identificación local de artefactos. No se modificó código, APK, Vercel, Supabase, migraciones, datos ni variables remotas.

## Resultado

Se creó un manifiesto reproducible con los hashes de APK, árbol fuente Android, frontends, service workers, dependencias de release, 18 Functions, 24 migraciones y la colección de 32 módulos de inteligencia. Los detalles están en `YARBI_1_0_RELEASE_MANIFEST.json`.

## Origen del APK 3.4.25

La evidencia permite afirmar que el APK se empaquetó desde:

`YARBI_LATEST_CRM_PHASE2_BUILD_2026-09-15/www`

La razón es técnica, no nominal:

- `android/app/src/main/assets/capacitor.config.json` declara `webDir: "www"`.
- El HTML de `www/index.html` tiene exactamente el mismo SHA-256 que `assets/public/index.html` extraído del APK.
- `www/service-worker.js`, `yarbi-assistant.js`, `yarbi-memory-center.js` y `manifest.json` coinciden con los recursos empaquetados del APK.
- `android/app/build.gradle` declara versionCode 116 y versionName `3.4.25-whatsapp-directo-estados`.

## Clasificación de fuentes frontend

| Destino | Fuente identificada | Estado |
|---|---|---|
| APK instalado actual | `YARBI_LATEST_CRM_PHASE2_BUILD_2026-09-15/www` | JUSTIFICADA. |
| Vercel futuro | `YARBI_BACKEND_MERGED_20260930/index.html` | CANDIDATA. El proyecto enlazado no declara `buildCommand` ni `outputDirectory`, pero no se descargó Production para demostrar equivalencia. |
| Android futuro desde backend | `YARBI_BACKEND_MERGED_20260930/www` | CANDIDATA. Respeta el nombre de `webDir`, pero difiere del APK y del frontend raíz. |
| Fuente universal futura | Ninguna seleccionada | BLOQUEADA. Los tres frontends no son idénticos y no existe un contrato local que pruebe una ruta única para Vercel y Capacitor. |

No se eligió una fuente universal por antigüedad, tamaño o nombre. Elegir una ahora sería una modificación arquitectónica fuera de P0.1.

## Diferencias demostradas

| Archivo | APK/Android 3.4.25 | Backend `www` | Backend raíz |
|---|---|---|---|
| `index.html` | `60ee1c…01c64` | `dbc4a1…586a1` | `19d2ea…21fc2` |
| `service-worker.js` | `8d1fe8…a50b9` | `08c2d2…c9667` | no aplica como fuente Android directa |
| `yarbi-assistant.js` | `caf1a9…a1e3e` | igual | no aplica |
| `yarbi-memory-center.js` | `354782…c443a` | igual | no aplica |

La bandeja `www/yarbi-owner-inbox-ui.js` existe en el backend pero no está dentro del APK 3.4.25; por tanto no forma parte de la aplicación instalada.

## Seguridad de entornos: inventario sin cambios

Se encontraron 44 referencias literales al host de Production dentro de `www/index.html`. Se agrupan en:

- espejo/historial de WhatsApp, alertas, hábitos y procesamiento;
- chat, token Live, comandos y envío de WhatsApp;
- autenticación, preferencias, recuperación y aprendizaje;
- colecciones, ubicación, importación/restauración y aprobación de agenda.

También existen Functions con fallback de Supabase o backend cuando falta configuración. P0.1 sólo los registró: no cambió ninguna URL. La separación segura posterior debe usar rutas same-origin o un origen público validado por build, y variables de servidor fail-closed para Preview/Production.

## Problemas que requieren decisión arquitectónica

1. **Fuente frontend universal.** Elegir entre un origen dedicado que se copie a Vercel y Capacitor, o dos artefactos explícitos generados desde una misma fuente. La evidencia actual no autoriza escoger uno de los tres archivos divergentes.
2. **Modelo de despliegue Vercel.** El árbol tiene 18 Functions, mientras su propia prueba local exige máximo 12. Antes de promover el backend raíz se debe decidir cómo consolidar rutas sin alterar contratos.
3. **Orígenes del frontend.** Las 44 URLs literales deben transformarse en una estrategia de origen por entorno. Esta tarea corresponde a P0.2/P0.3, no a esta congelación.
4. **Producción verificable.** La equivalencia del código local con Production sigue `NOT PROVEN`; requerirá una revisión de deployment autorizada, de solo lectura, antes de una promoción.

## Archivos generados

- `YARBI_1_0_RELEASE_MANIFEST.json`
- `YARBI_P0_1_RELEASE_BASELINE.md`

## Cierre

P0.1 cumple con identificar y fijar los artefactos disponibles. La decisión universal de frontend queda deliberadamente bloqueada y documentada. No se continuará a P0.2 sin autorización.
