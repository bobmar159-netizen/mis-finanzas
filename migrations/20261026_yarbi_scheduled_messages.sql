-- Cola durable para seguimientos que el usuario programa explícitamente.
-- No se expone al cliente: solamente el backend con service_role puede leerla
-- o cambiar su estado. Esto evita duplicados si Vercel invoca el cron más de
-- una vez y conserva evidencia de lo que se envió.
create table if not exists public.yarbi_scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  recipient_phone text not null,
  client_name text not null default '',
  message text not null,
  scheduled_for timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'sending', 'sent', 'failed', 'cancelled')),
  record_key text not null default '',
  service text not null default '',
  source text not null default 'crm_followup',
  provider text,
  provider_message_id text,
  error_detail text,
  attempts integer not null default 0,
  sent_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists yarbi_scheduled_messages_due_idx
  on public.yarbi_scheduled_messages (scheduled_for asc)
  where status = 'scheduled';

alter table public.yarbi_scheduled_messages enable row level security;

-- No hay políticas para anon/authenticated. La cola no se consulta desde el
-- APK; las rutas autenticadas del backend usan service_role y evitan exponer
-- teléfonos o mensajes programados por REST público.
