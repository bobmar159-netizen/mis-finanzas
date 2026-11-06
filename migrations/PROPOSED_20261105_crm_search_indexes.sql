-- PROPUESTA LOCAL — NO APLICADA
-- Índices para la ruta CRM de solo lectura. Se derivan exclusivamente de
-- tablas y columnas ya consultadas por el código existente. Ejecutar cada
-- CREATE INDEX CONCURRENTLY por separado, fuera de una transacción, después
-- de revisar el catálogo real del entorno correspondiente.

create index concurrently if not exists whatsapp_messages_contact_timestamp_search_idx
  on public.whatsapp_messages (contact_id, timestamp desc)
  where deleted_at is null;

create index concurrently if not exists ai_message_analysis_contact_completed_search_idx
  on public.ai_message_analysis (contact_id, completed_at desc)
  where status = 'completed';

create index concurrently if not exists agenda_events_contact_starts_search_idx
  on public.agenda_events (contact_id, starts_at desc);

create index concurrently if not exists yarbi_receivables_contact_status_search_idx
  on public.yarbi_receivables (contact_id, status, updated_at desc);

-- No se propone un índice para crm_contacts: la consulta comienza siempre
-- por IDs ya acotados desde yarbi_owner_contact_scope.
