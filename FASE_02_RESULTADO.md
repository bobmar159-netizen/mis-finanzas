# Yarbi — Fase 02: CRM, identidad y expediente

Estado: **IMPLEMENTADO_LOCAL**. No se consultaron ni modificaron servicios remotos, Production, Supabase, Vercel, Agenda, WhatsApp, Gemini o la APK.

## Entregado

- Se conservó el buscador CRM por nombre, teléfono parcial, distrito, servicio, historial, cotización y características, siempre limitado por `yarbi_owner_contact_scope` y sin aceptar un owner desde el navegador.
- Se agregó `POST /api/assistant/crm-dossier`, una lectura autenticada para abrir un expediente por `contact_id` ya seleccionado. Revalida el scope canónico antes de leer y devuelve identidad, contexto, faltantes y cronología limitada.
- La ruta no crea contactos, mensajes, Agenda, cobros ni acciones comerciales. Los orígenes opcionales ausentes se exponen como no disponibles en vez de usar fallbacks.
- El panel existente de “Funciones de Yarbi” abre el expediente real y muestra historial de solo lectura. Web y Android se generan desde `frontend/` con el mismo release `p02i-b2037537e426dff5`.

## Verificación local

- 21/21 pruebas CRM, expediente, owner scope, router y UI focalizadas: PASS.
- 4/4 pruebas de build unificado: PASS.
- Build Web: PASS; Build Android con origen HTTPS sintético: PASS.
- Pruebas de aislamiento: owner fuera de scope no obtiene datos; el cliente no puede inyectar `owner_id`; las simulaciones solo permiten el host Supabase aislado y no generan escrituras comerciales.

## Estado por entorno

- Local: PASS.
- Preview aislado: pendiente de F01. El proyecto Vercel separado ya existe, pero falta configurar manualmente su `SUPABASE_SECRET_KEY` aislada antes de desplegar o ejecutar HTTP conectado.
- Android: artefacto web generado; APK y prueba en dispositivo pendientes.
- Production: no consultado ni modificado.

## Límites conocidos

- El expediente no autoriza cambios de contacto, deduplicación, Agenda ni cobros: esas operaciones siguen requiriendo sus flujos de confirmación de fases posteriores.
- Fuentes de CRM opcionales pueden no existir en el Preview aislado; la ruta conserva el expediente parcial y declara su disponibilidad sin inventar datos.

Siguiente dependencia: completar F01 con el secreto exclusivo del proyecto aislado y un deployment Preview; después validar por HTTP búsqueda y expediente con fixtures. La siguiente fase de producto independiente será Agenda (F03).
