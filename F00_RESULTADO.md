# F00 — Fuente de verdad y build reproducible

## Resultado

`IMPLEMENTADO_LOCAL`

Se creó el workspace independiente `D:\YARBI_WORKSPACE_20261105` desde la
fuente completa. No se modificaron los workspaces históricos, el APK 3.4.25,
Supabase ni Production.

## Integridad de entradas

- Desarrollo: `YARBI_INTELLIGENCE_CRM_20261105.zip`
  - SHA-256: `c028fd370805c2568096605a4950198a2d4c6389e21435f383ef3d0ec4178fd9`
- Candidato Preview: `YARBI_PREVIEW_CANDIDATE_20261105.zip`
  - SHA-256: `5dfec956e7e5cb602c08c70a5227f0869e490c521a4771a07073d84e6ffaf3ac`

## Cambios funcionales trasladados

1. CRM: `yarbi-crm-search-runtime` ya no solicita `operational_status` de
   `crm_contacts`, columna ausente en el catálogo aislado conocido.
2. Se añadió la prueba de compatibilidad del catálogo aislado.
3. `build:frontend:web` genera `dist/web` y publica sus estáticos en la raíz
   servida. La raíz ya no conserva un `index.html` divergente. Los artefactos
   de Android continúan en `dist/android-www` y usan un origen HTTPS explícito.

`frontend/` sigue siendo la única fuente editable; `dist/` es generado y está
ignorado por Git. La publicación de raíz se prueba como salida generada.

## Verificación local

- Compatibilidad CRM aislada: PASS (1/1).
- Pruebas de frontend unificado: PASS (4/4).
- Build web: PASS.
- Build Android con origen sintético HTTPS: PASS.
- Raíz servida = `dist/web` para HTML, configuración, service worker y scripts
  principales: PASS.

## Siguiente dependencia

F01 puede reutilizar únicamente el Preview aislado y requiere una
`SUPABASE_SECRET_KEY` exclusiva del proyecto de pruebas para validación HTTP.
No se ha desplegado ni se ha usado ninguna credencial comercial.
