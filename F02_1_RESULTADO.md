# YARBI F02.1 — Cierre de identidad y aislamiento WhatsApp

## Resultado

**F02.1 IMPLEMENTADA LOCALMENTE CON DOS BLOQUEOS SEGUROS EXPLÍCITOS.**

La superficie interactiva de WhatsApp quedó separada del webhook de proveedor:

- `GET /api/whatsapp/messages` ahora exige Bearer, resuelve el scope canónico en servidor y sólo consulta/entrega mensajes de contactos autorizados.
- Los datos de scope entregados por navegador se rechazan; los filtros funcionales y la paginación se conservan.
- El webhook mantiene las ramas firmadas de YCloud y Meta, deduplicación y la llamada interna al procesador. Ya no sirve como API de usuario por token compartido.
- Los borradores tienen una ruta autenticada, pero fallan cerrados hasta que exista una relación comprobable con `crm_contacts`.
- Notion rechaza credenciales suministradas por navegador y no hace egress sin un vínculo verificable contacto/owner→recurso.
- El fallback del frontend que enviaba preferencias a `/api/whatsapp/messages` fue retirado.

## Cambios principales

- Nuevo handler directo: `api/whatsapp/messages.js`.
- Nuevo handler routerizado: `api_handlers/assistant/drafts.js`.
- Rewrites, router assistant, webhook, proxy Notion y bridge del frontend actualizados.
- Matriz de rewrites actualizada a 24 patrones API y 9 entrypoints físicos estáticos.
- Pruebas focalizadas nuevas para scope A/B, entradas manipuladas, borradores, Notion y aislamiento del webhook.

## Validación

- 25/25 pruebas focalizadas PASS.
- Builds Web y Android PASS; fuente `p02i-0c5cf70f24e0c587`.
- No hubo despliegues, consultas remotas, migraciones, cambios de RLS, acciones comerciales, proveedores ni APK.

## Pendiente deliberadamente bloqueado

1. `draft_actions`: no se autoriza lectura hasta demostrar la relación canónica de cada borrador con un `contact_id` dentro del scope.
2. Notion: no se autoriza proxy hasta disponer de una proyección servidor-side verificable de recurso hacia contacto/owner.
3. El código fuente conserva referencias históricas a `X-Assistant-Token`; para rutas migradas el valor se borra y el bridge lo elimina. Su retiro total debe hacerse por superficie, no mediante sustitución masiva insegura.
4. El número de bundles reales de Vercel sigue NOT PROVEN; sólo se verificó el conteo estático, sin `vercel build` ni despliegue.

Véanse `F02_1_AUTH_ENDPOINT_MATRIX.md` y `F02_1_REGRESSION_RESULTS.md` para evidencia y límites.
