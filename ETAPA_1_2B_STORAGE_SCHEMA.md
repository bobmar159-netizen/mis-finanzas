# Esquema de almacenamiento 1.2B

Base: `gfc_yarbi_conversation_v2`, versión `1`.

| Store | Clave | Campos |
|---|---|---|
| `timeline` | `id` | `id`, `role`, `text`, `at`, `channel` |
| `outbox` | `id` | `messageId`, `item`, `state`, `attempts`, `operationId`, `createdAt`, `updatedAt`, `lastErrorCode` opcional |
| `metadata` | `key` | estado y evidencia de migración |

La identidad se conserva como string ya codificado por la identidad Live v2; no se vuelve a tipificar ni truncar aquí. El modelo previo de Outbox no tenía campos de reintento propios, pero la migración conserva los existentes si aparecen como envoltura (`item`, `state`, `attempts`, etc.).

No se agregaron índices: las operaciones reales usan claves exactas y lectura completa acotada; no existe consulta por atributo que justifique un índice adicional.
