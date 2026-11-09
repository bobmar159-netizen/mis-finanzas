# Yarbi — Contrato Técnico de Conversación (Etapa 0)

**Estado:** especificación, no migración ni API activa.

## Principios

1. El mensaje canónico es independiente de Web, Android, voz y renderer.
2. El contenido no ejecuta acciones. Las acciones son referencias tipadas.
3. Toda entidad se asocia a `owner_account_id`; el navegador no lo decide.
4. Esquemas y bloques se versionan y se validan antes de persistir o renderizar.
5. El historial no se promociona automáticamente a memoria empresarial.

## Entidades lógicas

```json
{
  "conversation": {
    "id": "uuid", "owner_account_id": "uuid", "title": "string|null",
    "status": "active|archived|deleted", "created_at": "ISO-8601",
    "last_activity_at": "ISO-8601", "sync_revision": 1,
    "metadata": { "origin": "web|android", "schema_version": 1 }
  },
  "message": {
    "id": "uuid", "conversation_id": "uuid", "owner_account_id": "uuid",
    "role": "user|assistant|system", "status": "pending|streaming|complete|failed|cancelled",
    "sequence": 1, "created_at": "ISO-8601", "updated_at": "ISO-8601",
    "content": { "schema": "yarbi.conversation-content.v1", "blocks": [] },
    "sources": [], "action_refs": [], "voice": null
  }
}
```

`sequence` es monotónica dentro de una conversación; `id` es idempotente. Una
eliminación es lógica hasta que retención y sincronización definan su purga.

## Content blocks

Todos los bloques usan `{ "id", "type", "version" }`. La lista permitida es:

| Tipo | Campos principales |
|---|---|
| `paragraph` | `runs` de texto enriquecido validado |
| `heading` | texto y nivel, sin HTML |
| `ordered_list`, `unordered_list`, `checklist` | items tipados, nunca HTML |
| `table` | columnas, filas, alineación, resumen accesible |
| `information_panel`, `warning_panel`, `status_chip` | severidad y texto |
| `image`, `document_preview`, `document_excerpt` | referencia verificada, alt, fuente |
| `diagram`, `chart` | datos estructurados, leyenda, descripción |
| `source_citation` | `source_id` y localizador |

Bloques desconocidos no se ejecutan: se muestran como aviso seguro y se
conserva el texto alternativo. No se permite HTML, JavaScript, URL ejecutable ni
atributos de evento generados por modelos.

### Inline runs

`paragraph` no usa un bloque `bold_text`: la riqueza vive dentro de sus runs y
se versiona con el contenido `yarbi.conversation-content.v1`.

```json
{
  "type": "paragraph",
  "id": "block-1",
  "version": 1,
  "runs": [
    { "text": "Factura por " },
    { "text": "S/ 1,200", "marks": ["bold"] },
    { "text": " pendiente" }
  ]
}
```

Un run contiene texto UTF-8 acotado y `marks` opcional. Las únicas marcas
iniciales son `bold` e `italic`; se permiten juntas una vez cada una y el orden
no tiene significado. El validador rechaza marcas repetidas, desconocidas,
runs vacíos, propiedades adicionales y cualquier intento de HTML, Markdown
ejecutable, estilos o JavaScript. Si una versión futura de run no se entiende,
el renderer muestra el texto plano sanitizado y un indicador de compatibilidad;
no interpreta su metadata.

## Sources

```json
{
  "id": "source-ref", "kind": "crm|agenda|finance|document|norm|excel|image|video|audio",
  "file_id": "opaque-file-id", "file_sha256": "hex|null",
  "document_version": "sha256|null", "page": 4, "numeral": "5.2",
  "table": "Tabla 2", "figure": null, "sheet": "Costos",
  "cell_range": "B2:F12", "region": { "x": 0, "y": 0, "width": 0, "height": 0 },
  "start_ms": 124000, "end_ms": 138000, "frame_index": 372,
  "excerpt": "texto acotado",
  "provenance": "verified|owner_confirmed|model_interpretation",
  "verification_status": "verified|unverified|superseded"
}
```

Una cita normativa diferencia la fuente literal de la interpretación. Las
referencias comerciales sólo exponen datos autorizados por owner scope.

PDF usa página, numeral, tabla y figura. Excel usa hoja y rango A1. Una imagen
puede usar región identificable normalizada. Video y audio usan milisegundos
enteros desde el inicio del original; video puede añadir `frame_index`. Los
campos que no apliquen son nulos y nunca se inventan. Así una consulta sobre un
instante audiovisual recupera el fragmento ya indexado, sin reprocesar el
archivo completo.

## Actions

```json
{
  "id": "action-ref", "kind": "crm.update|agenda.create|finance.record",
  "status": "proposed|prepared|confirmed|rejected|executed|failed|expired",
  "execute": false, "authorization_ref": "opaque", "expires_at": "ISO-8601"
}
```

El renderer puede mostrar el estado, pero nunca invocar la acción. Backend
valida identidad, payload ligado a confirmación, idempotencia y scope antes de
usar los flujos comerciales existentes.

## Voz

`voice.input` describe captura/transcripción revisada; `voice.output` referencia
segmentos derivados del mismo contenido canónico. Estados: `idle`, `capturing`,
`reviewing`, `queued`, `speaking`, `paused`, `stopped`, `unavailable`, `failed`.
Audio crudo no se persiste por defecto. Los segmentos se relacionan por IDs de
bloque, sin alterar el texto mostrado.

## Streaming

Cada generación usa `generation_id` y eventos secuenciados:

1. `message.started`
2. `block.upserted` (idempotente por `block.id` y `revision`)
3. `source.attached`
4. `action.proposed`
5. `message.completed` o `message.failed|cancelled`

Reconexión reanuda desde el último `event_sequence`; un evento ya aplicado se
ignora. Si falla una respuesta parcial, se conserva con estado `failed` y una
marca visible, nunca se inventa su terminación. Cancelar impide nuevos eventos
pero no borra contenido recibido.

## Persistencia y offline

Cliente: cola local por propietario, mensajes idempotentes y caché de lectura
offline cifrable en una fase posterior. Nube: conversación, mensaje, bloque,
referencia y revisión por separado. Conflicto: mayor `sync_revision` sólo tras
validar que pertenece al mismo owner y mensaje; acciones y memoria no se
resuelven por “última escritura gana”.

La tabla histórica existente `yarbi_conversation_messages` sólo cubre texto
plano asociado a `owner_key`; no satisface aún este contrato.

### Decisión de almacenamiento y cifrado pendiente

Web usa IndexedDB como candidata para caché offline, pero requiere política de
retención, borrado y migración. En Android, IndexedDB dentro de WebView puede
servir como caché inicial, pero no equivale a una base cifrada. Android Keystore
protege material de claves; SQLCipher cifra una base SQLite: son capas
distintas. El `package.json` actual declara Capacitor 5 y reconocimiento de voz,
pero no declara SQLite ni SQLCipher ni se encontró configuración Capacitor que
demuestre un almacén nativo cifrado. Antes de elegir dependencia se debe
inspeccionar el árbol Android, compatibilidad de plugins, tamaño, migración,
respaldo, bloqueo de pantalla y borrado seguro. No se impone SQLCipher en esta
especificación.
