-- Aprendizajes aprobados y verificables del simulador de clientes de Yarbi.
create table if not exists public.yarbi_training_examples (
  owner_key text not null,
  id text not null,
  client_message text not null,
  original_response text not null,
  approved_response text not null,
  correction text not null default '',
  learning_kind text not null default 'example',
  learning_name text not null,
  learning_rule text not null,
  intent text not null default 'consulta_general',
  service text not null default 'general',
  scope text not null default 'whatsapp',
  active boolean not null default true,
  tested boolean not null default false,
  test_passed boolean,
  test_message text not null default '',
  test_response text not null default '',
  usage_count integer not null default 0 check (usage_count >= 0),
  last_used_at timestamptz,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (owner_key, id)
);

create index if not exists yarbi_training_examples_active_idx
  on public.yarbi_training_examples (owner_key, active, updated_at desc)
  where deleted_at is null;

alter table public.yarbi_training_examples enable row level security;
revoke all on table public.yarbi_training_examples from anon, authenticated;
grant all on table public.yarbi_training_examples to service_role;

comment on table public.yarbi_training_examples is
  'Ejemplos y reglas aprobados por el dueño en el simulador; no autoriza envíos automáticos.';

select
  to_regclass('public.yarbi_training_examples') as training_table,
  (select relrowsecurity from pg_class where oid = 'public.yarbi_training_examples'::regclass) as rls_enabled,
  to_regclass('public.yarbi_training_examples_active_idx') as active_index;
