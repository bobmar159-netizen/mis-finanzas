# Etapa 1 — Pruebas focalizadas

| Grupo | Resultado |
|---|---|
| Renderer: texto plano, FAST y runs | PASS |
| H1/H2/H3, listas, tabla, paneles, chips y fuentes | PASS |
| XSS, HTML, scripts, propiedades y marcas inválidas | PASS |
| Límites de runs, bloques, tablas y texto total | PASS |
| Integración de script con chat F03 | PASS |
| Sintaxis de scripts inline | PASS (`8`) |
| Builds temporales reproducibles Web/Android-Web | PASS |
| Regresiones focalizadas F01/F02/F02.1/F03 + frontend | PASS (`39/39`) |

Los builds finales locales generaron `dist/web/` y `dist/android-www/` con el
mismo SHA del renderer que la fuente. La validación física Android no se
ejecutó: **NO VERIFICADA**.
