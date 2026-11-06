# YARBI P0.6.3 — Build local sin descargar variables

**Estado final:** `BLOCKED_PROJECT_SETTINGS_REQUIRED`

**Fecha:** 2026-11-05  
**Staging:** `D:\YARBI_P06_STAGING_20261105`

## Precheck

| Comprobación | Resultado |
|---|---|
| `.vercel/project.json` | PASS — existe solo en staging |
| Project ID | PASS — `prj_LzmQFg4ybpNyzeIBjcYZjP1ZGdJq` coincide exactamente |
| `.env.local` | PASS — ausente |
| Archivos `.env*` en raíz de staging | PASS — ninguno |
| P0.2I | PASS — 11/11 hashes protegidos |
| P0.3.1 | PASS — 10/10 hashes protegidos |
| P0.5 | PASS — 16/16 hashes protegidos |
| Espacio `C:` | 0.12 GB libres |
| Espacio `D:` | 401.00 GB libres |

## Incidente OIDC investigado

La creación previa de `.env.local` no provino de `vercel build`. El historial de consola demuestra que ocurrió durante `vercel link --project misfinanzas-backend --scope omar-dfc4`, inmediatamente después de que la CLI confirmó el vínculo e informó que descargaba un `VERCEL_OIDC_TOKEN`.

No se leyó, imprimió ni reutilizó ese token. El archivo fue retirado en P0.6.2 y el precheck P0.6.3 confirmó su ausencia.

## Entorno de build

Se utilizaron solo valores sintéticos en memoria:

```text
TEMP=D:\YARBI_P06_RECOVERY_20261105\temp
TMP=D:\YARBI_P06_RECOVERY_20261105\temp
npm_config_cache=D:\YARBI_P06_RECOVERY_20261105\npm-cache
VERCEL_ENV=preview
```

Las restantes variables de Preview necesarias para esta invocación se definieron con identificadores sintéticos locales. No se proporcionaron claves reales de Supabase, Gemini, WhatsApp, Notion ni Production.

## Ejecución de build

Se consultó primero `vercel build --help`. La ayuda confirma que `--yes` permite obtener automáticamente ajustes y variables cuando no existen localmente. No se usó esa opción.

Se ejecutó exactamente:

```text
vercel build
```

sin `--yes`, `--prod`, `vercel pull`, `vercel env pull`, deployment ni alias. La CLI se detuvo con el resultado estructurado:

```text
reason: project_settings_required
message: No project settings found locally.
```

La CLI propuso `vercel pull --yes` o `vercel build --yes`; ambas alternativas están fuera del alcance autorizado y no se ejecutaron.

## Comprobación posterior

| Comprobación | Resultado |
|---|---|
| `.env*` inesperado creado durante build | No |
| `.vercel/output` | No existe |
| `.vercel/output/functions` | No existe |
| Descarga de variables o secretos | No observada |
| Functions reales generadas | `NOT_RUN` |
| Bundles, runtimes y rewrites generados | `NOT_RUN` |
| Deployment / Production / Supabase remoto | Sin cambios |

## Conclusión y recomendación

La CLI confirma que un build Vercel local legítimo requiere project settings locales. Bajo la prohibición de obtenerlos mediante `vercel pull` o `--yes`, no existe una ruta documentada para producir `.vercel/output` del proyecto real. Crear configuraciones inventadas no sería una validación de Vercel y no se hizo.

**Recomendación:** decidir explícitamente entre autorizar un `vercel pull` limitado a ajustes no secretos, con revisión y retirada inmediata de cualquier `.env*`, o mantener el build Vercel como bloqueo conocido y conservar la validación local P0.6.1 como evidencia máxima disponible. No se recomienda integrar el candidato como si el recuento real de Functions hubiese sido probado.
