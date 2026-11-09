# Etapa 1 — Resultados de seguridad del renderer

## Controles implementados

1. El renderer usa `createElement` y `textContent`; no inserta contenido del
   modelo mediante `innerHTML`.
2. Cada bloque permite sólo propiedades explícitas.
3. Las marcas inline se limitan a `bold` e `italic`, sin repetición.
4. HTML, scripts, URLs `javascript:` y atributos `on*` se degradan a un panel
   seguro por bloque.
5. Bloques desconocidos o versiones no soportadas no se ejecutan ni bloquean la
   respuesta completa.
6. El renderer no recibe ni ejecuta `action_refs`; las acciones continúan bajo
   los endpoints y confirmaciones existentes.

## Pruebas locales

Las pruebas de `tests/etapa1-conversation-renderer.test.js` cubren HTML/script,
marcas desconocidas, propiedades adicionales, runs vacíos, versiones futuras,
tablas y límites. Resultado: **8/8 PASS** dentro de la prueba focalizada.

No hubo proveedores, red, Gemini, Supabase remoto ni acciones comerciales.
