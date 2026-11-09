# Etapa 1.1 — Seguridad

## PASS

- El renderer no usa `innerHTML` para contenido de Yarbi, Gemini ni propietario.
- Bloques, propiedades, tipos, tamaños, marcas y presupuesto global se validan antes del DOM.
- HTML, eventos inline y `javascript:` son rechazados dentro de contenido tipado.
- Markdown no habilita HTML: construcciones inválidas o incompletas quedan como texto.
- Citas son texto y `source_id`; no generan enlaces clicables ni aceptan URL arbitraria. Por tanto no existe protocolo externo que seguir desde el renderer.
- `x < y`, acentos, emojis y caracteres suplementarios se mantienen como texto. El límite de 30.000 usa puntos de código mediante `Array.from`, sin separar pares UTF-16.
- No se agregaron llamadas de red, acciones comerciales, rutas, RPC, RLS ni proveedores.

## Pendiente documentado

- No hay archivo local Inter con licencia verificada. Se eliminó el CDN del frontend fuente; el sistema usa fuentes locales del dispositivo. Empaquetar Inter requiere una fuente autorizada y una revisión de licencia.
- Las pruebas de DOM son simuladas localmente; falta verificación visual/física en Android.
