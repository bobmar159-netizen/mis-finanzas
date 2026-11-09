# Etapa 1.1 — Resultado

## Estado

**COMPLETADA LOCALMENTE — pendiente de auditoría independiente y prueba física Android.**

Base: `319281c300649ca2919fdc09eabe78f450d89820` desde `6b2431a`. La rama `etapa1-renderer-fixes` no contiene F04.2 (`6bf2dcd`) ni F04.3 (`092ee79`). No hubo despliegue, acceso remoto, llamadas a Gemini ni cambios en Production.

## Defectos corregidos

- DEF-01: `gfcAppendCopilotChatMessage` vuelve a ser el único punto global. Se eliminó el override contextual y el módulo de memoria pasó a registrar un hook de timeline que preserva persistencia, deduplicación y fechas sin reemplazar el renderer.
- DEF-02: entradas vacías, de espacios o de saltos de línea devuelven `content_empty`; no generan una burbuja ni una respuesta atribuida a Yarbi.
- DEF-03: mensajes mayores de 30.000 puntos de código se rechazan con `message_truncated`, aviso visible y estado `partial`; nunca `complete`.
- DEF-04: auto-scroll sólo se mantiene a 72 px o menos del final. Si se lee historial, se conserva la posición y se marca `data-yarbi-new-messages`.
- DEF-05: un adaptador Markdown conservador convierte encabezados H1–H3, párrafos, negritas, cursivas, listas y tablas válidas en bloques v1. Markdown incompleto, HTML y código inline sin marca compatible permanecen como texto seguro.
- DEF-06: la validación recorre bloques incrementalmente y corta cuando excede presupuesto. No crea DOM antes de validar.
- DEF-07: se retiró la carga de Google Fonts del frontend fuente y de los artefactos generados. No existe Inter WOFF2 local con licencia verificable, por lo que se usa el fallback del sistema y queda pendiente empaquetar una fuente autorizada.

## Checkpoints

- Inicial para revisión: `6e22a4a31026bcccc49bb81c560cb4d93abceb9b`.
- Final: se registra en el commit posterior a este informe.

## Límites conocidos

- Android-Web compiló correctamente; Android físico, teclado, micrófono y lectura visual permanecen **NO VERIFICADOS** porque no hubo dispositivo conectado.
- La suite histórica completa no es verde sobre F03: 449/522 pasan, 67 fallan y 6 quedan TODO por rutas posteriores ausentes (`api/assistant/preferences.js`, `collections.js`, `command.js`) y artefactos externos que esta base autorizada no contiene. No se añadieron desde F04.2/F04.3.

Los detalles reproducibles están en los demás entregables de Etapa 1.1.
