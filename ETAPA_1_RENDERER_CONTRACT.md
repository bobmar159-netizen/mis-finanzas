# Etapa 1 — Contrato aplicado por el renderer

Esquema: `yarbi.conversation-content.v1`.

## Bloques activos

- `paragraph` con `runs` y marcas exactas `bold`/`italic`.
- `heading` H1/H2/H3.
- `ordered_list`, `unordered_list`, `checklist`.
- `table`, `information_panel`, `warning_panel`, `status_chip` y
  `source_citation`.

Los tipos `image`, `document_preview`, `document_excerpt`, `diagram` y `chart`
se aceptan sólo como referencias preparadas; su contenido no se obtiene ni se
interpreta en esta etapa.

## Límites aplicados

| Límite | Valor |
|---|---:|
| Caracteres por run | 2.048 |
| Runs por párrafo | 64 |
| Bloques por mensaje | 100 |
| Filas por tabla | 50 |
| Columnas por tabla | 12 |
| Celdas por tabla | 600 |
| Caracteres visibles por mensaje | 30.000 |

Un bloque inválido se reemplaza individualmente por un aviso seguro; no rompe
el resto del mensaje. Un texto plano heredado se fragmenta en runs acotados.
No se acepta HTML, `javascript:`, atributos de evento, estilos arbitrarios,
propiedades adicionales ni marcas desconocidas.
