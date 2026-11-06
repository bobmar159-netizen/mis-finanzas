-- Yarbi Action Ledger V1
-- Fuente de trazabilidad para acciones propuestas, confirmadas, ejecutadas,
-- canceladas o fallidas. No modifica agenda, movimientos ni clientes existentes.

create table if not exists public.yarbi_agent_actions (
  action_id text primary key,
  module text not null,
  action_type text not null,
  status text not null check (status in ('proposed', 'confirmed', 'executing', 'executed', 'failed', 'cancelled')),
  target_type text,
  target_id text,
  confirmation_required boolean not null default true,
  request_payload jsonb not null default '{}'::jsonb,
  result_payload jsonb not null default '{}'::jsonb,
  error_message text,
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  executed_at timestamptz
);

create index if not exists yarbi_agent_actions_updated_idx
  on public.yarbi_agent_actions (updated_at desc);
create index if not exists yarbi_agent_actions_target_idx
  on public.yarbi_agent_actions (target_type, target_id, updated_at desc);
create index if not exists yarbi_agent_actions_status_idx
  on public.yarbi_agent_actions (status, updated_at desc);

alter table public.yarbi_agent_actions enable row level security;
revoke all on table public.yarbi_agent_actions from anon, authenticated;
grant select, insert, update on table public.yarbi_agent_actions to service_role;

create table if not exists public.yarbi_client_resolutions (
  identity_key text primary key,
  contact_id bigint,
  agenda_event_id bigint,
  phone text,
  client_name text,
  status text not null,
  reason text,
  follow_up_at date,
  linked_service_id text,
  linked_service_date date,
  financial_mutation boolean not null default false,
  resolved_at timestamptz not null,
  source text not null default 'yarbi_app',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists yarbi_client_resolutions_follow_up_idx
  on public.yarbi_client_resolutions (follow_up_at, updated_at desc);
create index if not exists yarbi_client_resolutions_contact_idx
  on public.yarbi_client_resolutions (contact_id, updated_at desc);

alter table public.yarbi_client_resolutions enable row level security;
revoke all on table public.yarbi_client_resolutions from anon, authenticated;
grant select, insert, update on table public.yarbi_client_resolutions to service_role;
