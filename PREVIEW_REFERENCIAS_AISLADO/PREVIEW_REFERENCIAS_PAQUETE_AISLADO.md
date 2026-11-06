# Preview aislado — referencias autenticadas

Este directorio es una raíz de deployment independiente para la validación E2E de `POST /api/assistant/reference-candidates`.

## Contenido

- Una Function: `api/assistant/reference-candidates.js`.
- Bibliotecas estrictamente requeridas para autenticación de Supabase, scope canónico, candidatos, resolvedor, política Preview y trazabilidad.

## Exclusiones verificables

No contiene frontend/UI-01, webhook, procesador, WhatsApp, Gemini, Agenda, Maps, Notion, Calendar, cron ni rutas comerciales.

## Configuración permitida

El deployment solo inicia si el entorno es Preview y existen los nombres de variable siguientes con valores del proyecto aislado:

- `YARBI_PREVIEW_OWNER_REFERENCES_ONLY=true`
- `YARBI_PREVIEW_SUPABASE_PROJECT_REF=uevilhbstnmmdlgyshlv`
- `SUPABASE_URL=https://uevilhbstnmmdlgyshlv.supabase.co`
- `SUPABASE_SECRET_KEY`
- `YARBI_TRACE_HMAC_KEY`

Los modos Preview incompatibles deben estar desactivados. La Function bloquea una referencia de producción o cualquier variable comercial prohibida.

No hay claves ni datos reales dentro del paquete.
