# Etapa 1.1 — Rendimiento

Mediciones locales Node (no equivalen a Android físico ni a Preview):

- Renderer y pruebas de integración: 14/14 PASS en aproximadamente 0,1 s.
- Regresión focalizada completa: 45/45 PASS en aproximadamente 0,9 s; incluye pruebas de build unificado que realizan trabajo de archivos local.
- Build Web: PASS, release `p02i-5c009043e4a31850`.
- Build Android-Web: PASS, mismo release.

La validación ahora corta al exceder el presupuesto global y evita procesar bloques posteriores. El auto-scroll evita asignar `scrollTop` cuando el usuario no está cerca del final. No se declara medición de memoria, frame time, red, Gemini, Preview ni dispositivo Android.
