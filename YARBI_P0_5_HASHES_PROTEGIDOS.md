# YARBI P0.5 — Comparación de hashes protegidos

Fecha: 2026-11-05. Se compararon los manifiestos existentes antes de la implementación local P0.5. No existe repositorio Git en este workspace, por lo que no se creó rama; la protección se realizó por hashes y evitando modificar los árboles congelados.

| Línea base | Archivos comprobados | Resultado antes de P0.5 | Resultado después de los cambios P0.5 |
|---|---:|---|---|
| P0.2I | 11 | 11/11 coinciden | **11/11 coinciden** |
| P0.3.1 | 10 | 10/10 coinciden | **10/10 coinciden** |

## Archivos explícitamente preservados

- `frontend/`
- `dist/web/`
- `dist/android-www/`
- scripts de build y manifiesto P0.2I
- pruebas de build P0.2I
- APK de referencia y árboles históricos
- configuración remota, Supabase y Vercel

El cierre final de esta comparación se registra en `YARBI_P0_5_FINALIZACION_CONTROLADA.md` y se cifra por SHA-256 en `YARBI_P0_5_SHA256SUMS.txt`.
