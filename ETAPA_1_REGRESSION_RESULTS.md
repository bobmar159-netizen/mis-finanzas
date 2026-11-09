# Etapa 1 — Regresiones y línea base

La suite completa `npm test` no es una puerta válida para el commit autorizado
`6b2431a`: incluye pruebas históricas que exigen rutas `api/assistant/*` y
otras piezas ausentes en esa base F03, por ejemplo `preferences`, `collections`
y `command`. Esos fallos aparecen antes de ejecutar el renderer y no se
corrigieron, porque hacerlo introduciría trabajo posterior y prohibido de
F04.2/F04.3.

Como control relevante se ejecutaron 39 pruebas focalizadas de F01, F02,
F02.1, F03, fuente unificada y Etapa 1: **39/39 PASS**. La suite completa queda
clasificada como **BASELINE_INCOMPATIBLE_CON_COMMIT_F03**, no como evidencia de
una regresión provocada por el renderer.
