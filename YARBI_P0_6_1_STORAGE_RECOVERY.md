# YARBI P0.6.1 — Recuperación segura de almacenamiento

**Fecha:** 2026-11-05  
**Ámbito:** recuperación reversible y ejecución local desde `D:`.  
**Estado:** `RECUPERACION_SIN_MOVIMIENTOS_VALIDACION_LOCAL_REANUDADA`

## Espacio medido

| Unidad | Antes | Después |
|---|---:|---:|
| `C:` | 0.13 GB libres | 0.13 GB libres |
| `D:` | 401.65 GB libres | 401.65 GB libres (redondeado) |

No se buscó alcanzar artificialmente una cuota de espacio. La recuperación solo podía mover archivos demostrablemente temporales y prescindibles.

## Inspección de `%TEMP%`

| Criterio | Resultado |
|---|---:|
| Directorio revisado | `%TEMP%` del usuario: `C:\Users\BOB\AppData\Local\Temp` |
| Antigüedad mínima | Más de 14 días |
| Archivos antiguos detectados | 27 |
| Tamaño total | 884.00 MB |
| Extensiones temporales estándar (`.tmp`, `.temp`, `.log`, `.etl`, `.dmp`, `.old`, `.bak`, `.cache`) | 0 archivos / 0 bytes |
| Atributo de archivo temporal | No presente |
| Procedencia técnica verificable (Codex, Node, npm o Vercel) | No demostrada |

Los archivos quedaron clasificados como origen anidado desconocido. No se leyeron contenidos ni se registraron nombres individuales, rutas personales ni datos de usuario.

## Recuperación aplicada

| Acción | Resultado |
|---|---:|
| Directorio de cuarentena creado | `D:\YARBI_P06_RECOVERY_20261105` |
| Archivos copiados a cuarentena | 0 |
| Archivos originales retirados de `%TEMP%` | 0 |
| Bytes recuperados | 0 |
| Archivos sobrescritos | 0 |
| Archivos borrados | 0 |

La ausencia de movimientos es intencional: no se encontró evidencia suficiente para considerar prescindibles los archivos viejos. La estructura de recuperación permanece disponible para una autorización futura con objetivos exactos.

## Configuración de la sesión local

Se crearon, sin alterar variables globales del sistema:

```text
TEMP=D:\YARBI_P06_RECOVERY_20261105\temp
TMP=D:\YARBI_P06_RECOVERY_20261105\temp
npm_config_cache=D:\YARBI_P06_RECOVERY_20261105\npm-cache
```

`node --version` funcionó con esta configuración (`v24.14.0`). La caché npm observada originalmente estaba en `C:\Users\BOB\AppData\Local\npm-cache`; la ubicación observada de Vercel CLI fue `C:\Users\BOB\AppData\Local\com.vercel.cli`, sin tamaño medible. No se encontró evidencia local de una variable oficialmente soportada que redirija el descargador interno de binarios de Vercel; por ello no se ejecutó `npx vercel` ni se descargó nada en `C:`.

## Pruebas ejecutadas

| Batería | Resultado |
|---|---:|
| `p061-rewrite-matrix`, `p061-router-functional`, `p061-collections-export` | PASS — 8/8 |
| Batería focalizada heredada P0.6 | PASS — 32/32 |
| Total reanudado | PASS — 40/40 |

Las pruebas usaron mocks o rutas sintéticas locales. No hubo Vercel remoto, Supabase remoto, Gemini, WhatsApp, migraciones, despliegues ni acciones comerciales.

## Integridad protegida

| Línea base | Resultado |
|---|---:|
| P0.2I | PASS — 11/11 SHA-256 |
| P0.3.1 | PASS — 10/10 SHA-256 |
| P0.5 | PASS — 16/16 SHA-256 |

Los 37 hashes se recalcularon directamente en el proyecto original, en modo lectura. No hubo discrepancias.

## Build Vercel y estado de P0.6.1

El build Vercel local sigue `BLOCKED`: el staging no tiene `.vercel/project.json` y obtener configuración por el flujo estándar requeriría `vercel link` o `vercel pull`, prohibidos en esta fase. No se utilizó un proyecto falso, `--yes`, `--prod`, ni una consulta remota.

**Estado P0.6.1:** `VALIDACION_LOCAL_P0_6_1_COMPLETADA_BUILD_VERCEL_AUN_BLOCKED`.

No se integró el candidato ni se modificó el proyecto original.
