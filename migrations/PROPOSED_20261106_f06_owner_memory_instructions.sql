-- F06: propuesta local, no aplicada. Instrucciones permanentes autenticadas
-- por owner_account_id; las reglas legacy owner_key no se convierten
-- automáticamente porque no se puede demostrar su identidad de origen.
begin;

create table if not exists public.yarbi_owner_instructions (
  id uuid primary key default gen_random_uuid(),
  owner_account_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  instruction text not null check (length(btrim(instruction)) between 8 and 1200),
  category text not null default 'behavior' check (category in ('behavior','preference','reply_training')),
  scope text not null default 'owner' check (scope = 'owner'),
  active boolean not null default true,
  origin text not null default 'owner_confirmed' check (origin in ('owner_confirmed','training_approved','voice_proposed','whatsapp_proposed')),
  source_channel text not null default 'app' check (source_channel in ('app','voice','whatsapp')),
  semantic_key text not null check (semantic_key ~ '^[a-f0-9]{32}$'),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (owner_account_id, semantic_key)
);

create index if not exists yarbi_owner_instructions_active_idx
  on public.yarbi_owner_instructions(owner_account_id, updated_at desc)
  where deleted_at is null and active;

alter table public.yarbi_owner_instructions enable row level security;
revoke all on public.yarbi_owner_instructions from public, anon, authenticated;
grant select, insert, update on public.yarbi_owner_instructions to service_role;

commit;
