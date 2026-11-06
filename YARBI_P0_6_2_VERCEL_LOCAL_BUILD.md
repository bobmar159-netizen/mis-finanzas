# YARBI P0.6.2 — Vercel local build

**Estado inicial:** `BLOCKED_VERCEL_CLI_NOT_INSTALLED`

**Estado actualizado:** `BLOCKED_UNEXPECTED_OIDC_ENV_FILE_DURING_LINK`

**Staging:** `D:\YARBI_P06_STAGING_20261105`  
**Fecha:** 2026-11-05

## Preflight

| Comprobación | Resultado |
|---|---|
| Manifiesto P0.6.1 | PASS — 9/9 hashes coinciden |
| `C:` libre | 0.12 GB |
| `D:` libre | 401.63 GB |
| `TEMP` / `TMP` | `D:\YARBI_P06_RECOVERY_20261105\temp` |
| `npm_config_cache` | `D:\YARBI_P06_RECOVERY_20261105\npm-cache` |
| `.vercel/project.json` existente antes de la fase | No |
| Ejecutable `vercel` instalado | No encontrado |
| Ejecutable `vercel.cmd` instalado | No encontrado |

## Decisión

La autorización exige detener la fase si la CLI de Vercel no está disponible y prohíbe usar `npx` para descargar binarios desconocidos. Se cumplió esa condición de parada.

No se ejecutaron `vercel link`, `vercel pull`, `vercel env pull`, `vercel build`, `npx`, ningún deployment ni ninguna operación remota.

## Resultado de vinculación

No se creó `.vercel/project.json`, porque no existe una CLI local autorizada con la que vincular el staging. Por tanto no hay Project ID ni Team ID obtenidos desde Vercel en esta fase, ni riesgo de descargar variables de entorno.

## Resultado del build

`NOT_RUN`. No existe `.vercel/output/functions/`; por ello no hay recuento real de Functions, bundles ni runtimes generado por Vercel.

El conteo estático de P0.6/P0.6.1 no sustituye este resultado y no se presenta como validación de los límites del plan Hobby.

## Confirmaciones de seguridad

- Proyecto original sin modificaciones.
- Staging preservado; no había archivo de vínculo previo que respaldar.
- Sin configuración, variables o secretos descargados.
- Sin cambios remotos en Vercel, Supabase ni Production.
- Sin migraciones, APK, Gemini, WhatsApp ni acciones comerciales.

## Recomendación

Para reanudar P0.6.2 se requiere una instalación local y verificable de Vercel CLI, con su binario y caché dirigidos de forma comprobable a `D:`. Esa instalación requerirá una autorización separada, pues esta fase prohíbe descargar binarios mediante `npx` y no autoriza instalaciones.

## Actualización — instalación y vínculo local (2026-11-05)

El propietario autorizó instalar una CLI local verificable. Se instaló `vercel` **65.11.0** bajo:

```text
D:\YARBI_P06_RECOVERY_20261105\vercel-cli
```

La instalación fue local, sin `npx`, sin instalación global y con `TEMP`, `TMP` y `npm_config_cache` en `D:`. La CLI respondió correctamente a `--version`.

La primera ejecución interactiva de `vercel link --project misfinanzas-backend --scope omar-dfc4` confirmó visualmente el proyecto `omar-dfc4/misfinanzas-backend`, pero el canal de ejecución no pudo entregar la confirmación de teclado. Se reintentó la misma orden respondiendo exclusivamente `Y` a la pregunta `Link directory to project?`, sin usar `--yes`.

### Vínculo resultante

| Comprobación | Resultado |
|---|---|
| Archivo local creado | `.vercel/project.json` dentro del staging |
| Project ID observado | `prj_LzmQFg4ybpNyzeIBjcYZjP1ZGdJq` |
| Coincidencia con Project ID autorizado | PASS |
| Team ID local observado | `team_u1IV9p2jE7b0Qogxf1PJLrJJ` |
| Vínculo previo a respaldar | No existía |

### Incidente de alcance y contención

Después de confirmar el vínculo, Vercel CLI comunicó que descargaba un `VERCEL_OIDC_TOKEN` nuevo y creó inesperadamente `.env.local` en el staging. Esta acción no fue solicitada, y contradice la restricción de no descargar variables.

No se abrió, imprimió, copió ni registró el contenido de ese archivo. Se verificó únicamente que era un archivo regular de 1,292 bytes y se retiró inmediatamente del staging. La comprobación posterior confirmó que no queda ningún archivo `.env*` en la raíz del staging y que `.env.local` ya no existe.

Por este efecto adicional, **no se ejecutó `vercel build`**. El build, el recuento de Functions generadas y la inspección de bundles permanecen `NOT_RUN`. No se realizaron otros comandos Vercel ni operaciones remotas.

La recomendación anterior queda reemplazada: la CLI ya está instalada en `D:`, pero antes de autorizar el build se requiere decidir expresamente si puede ejecutarse después del incidente OIDC y bajo qué procedimiento se impedirá o contendrá cualquier recreación de variables locales.
