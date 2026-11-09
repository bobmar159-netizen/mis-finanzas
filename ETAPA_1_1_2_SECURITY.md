# Etapa 1.1.2 — Seguridad

## Controles conservados

- El borrador Live usa `textContent`, no HTML interpretable.
- El mensaje final normal atraviesa `YarbiConversationRenderer`, que valida contenido y degrada entradas hostiles o incompletas a una representación parcial segura.
- La prueba usa un payload `<script>alert(1)</script>` y verifica que llega al renderer, se marca `partial` y no queda como una burbuja heredada final.
- La deduplicación evita persistencias y renderizados adicionales para el mismo `turnId` finalizado.
- Los callbacks vacíos, interrumpidos y cancelados retiran estado temporal sin producir mensajes falsos.

## Límites de esta etapa

No se realizaron llamadas a Gemini, no se cargaron secretos y no se accedió a Supabase remoto. La prueba es un recorrido local con mocks de DOM, persistencia y transporte Live. La seguridad de un dispositivo Android físico y de un proveedor real requiere una validación posterior autorizada.
