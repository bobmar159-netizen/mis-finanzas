begin;

create table if not exists public.yarbi_conversation_messages (
  owner_key text not null,
  id text not null,
  role text not null check (role in ('user', 'assistant')),
  text text not null check (char_length(text) between 1 and 8000),
  channel text not null default 'chat',
  message_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (owner_key, id)
);

create index if not exists yarbi_conversation_messages_owner_time_idx
  on public.yarbi_conversation_messages (owner_key, message_at desc);

alter table public.yarbi_conversation_messages enable row level security;

revoke all on public.yarbi_conversation_messages from anon, authenticated;
grant all on public.yarbi_conversation_messages to service_role;

commit;
