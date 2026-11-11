-- Propuesta local: cola durable para aprendizaje histórico por contacto.
-- No aplicar automáticamente. No almacena texto de WhatsApp: solo referencias
-- de mensaje y propuestas que requieren revisión explícita del propietario.
begin;

create table if not exists public.yarbi_historical_intelligence_batches (
  id uuid primary key default gen_random_uuid(),
  owner_account_id uuid not null references auth.users(id) on delete cascade,
  contact_id bigint not null references public.crm_contacts(id) on delete cascade,
  idempotency_key text not null check (idempotency_key ~ '^[a-f0-9]{64}$'),
  message_ids jsonb not null check (jsonb_typeof(message_ids) = 'array' and jsonb_array_length(message_ids) between 1 and 60),
  outgoing_message_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(outgoing_message_ids) = 'array'),
  segment_index integer not null check (segment_index >= 0),
  segment_count integer not null check (segment_count >= 1 and segment_index < segment_count),
  occurred_from bigint,
  occurred_to bigint,
  status text not null default 'ready' check (status in ('ready','processing','awaiting_owner_review','approved','rejected','failed')),
  requires_owner_review boolean not null default true check (requires_owner_review),
  commercial_effects_allowed boolean not null default false check (not commercial_effects_allowed),
  proposal jsonb,
  error_code text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(owner_account_id, idempotency_key),
  check ((status in ('ready','processing') and proposal is null) or status not in ('ready','processing')),
  check ((status = 'awaiting_owner_review' and proposal is not null) or status <> 'awaiting_owner_review')
);

create index if not exists yarbi_historical_intelligence_owner_status_idx
  on public.yarbi_historical_intelligence_batches(owner_account_id, status, created_at asc);

create index if not exists yarbi_historical_intelligence_contact_idx
  on public.yarbi_historical_intelligence_batches(contact_id, created_at asc);

alter table public.yarbi_historical_intelligence_batches enable row level security;
revoke all on table public.yarbi_historical_intelligence_batches from public, anon, authenticated;
grant select, insert, update on table public.yarbi_historical_intelligence_batches to service_role;

commit;
