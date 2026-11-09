# Etapa 1 — Arquitectura del renderer conversacional

## Posición en el sistema

`api_handlers/assistant/conversation.js`, FAST/STANDARD/DEEP, autenticación,
continuidad firmada y Gemini Live no cambian. La interfaz existente continúa
llamando a `/api/assistant/conversation`; el renderer se ejecuta después de
recibir una respuesta y sólo decide cómo representarla.

```text
F03: respuesta de texto o contenido tipado
  -> adaptador de texto plano seguro
  -> validador yarbi.conversation-content.v1
  -> renderer DOM declarativo
  -> contenedor de chat existente
```

## Componentes

| Componente | Función | Estado |
|---|---|---|
| `frontend/yarbi-conversation-renderer.js` | Adaptación, validación y creación DOM segura de bloques | Nuevo, local. |
| `frontend/index.html` | Carga el renderer y lo usa desde `gfcAppendCopilotChatMessage` | Integración visual. |
| `api_handlers/assistant/conversation.js` | Cerebro y respuesta autenticada F03 | Reutilizado, sin cambios. |
| `frontend/yarbi-app-voice.js` | Micrófono y revisión de transcripción | Reutilizado, sin cambios. |

No hay streaming backend en la ruta inspeccionada. El renderer conserva estado
`complete|partial` en el elemento para una actualización incremental posterior,
sin crear un protocolo ni un endpoint de streaming en esta etapa.

## Compatibilidad

Texto plano de FAST, STANDARD, DEEP y respuestas heredadas se convierte a un
párrafo tipado. Los bloques estructurados futuros se validan antes de ser
renderizados. Los tipos multimedia/documentales se reconocen como referencias
tipadas, pero no activan BKE ni recuperan archivos.
