-- F08 proposal only. Do not apply without a separate Supabase review.
-- Stores no readable recipients or message bodies.  Every outbound operation
-- is bound to the owner, provider and server-HMAC fingerprints.
begin;

do $$
begin
  if to_regclass('public.yarbi_whatsapp_send_operations') is not null then
    raise exception 'yarbi_whatsapp_send_operations_already_exists_manual_contract_review_required';
  end if;
end $$;

create table public.yarbi_whatsapp_send_operations (
  operation_id uuid primary key,
  owner_account_id uuid not null references auth.users(id) on delete restrict,
  provider text not null check (provider in ('ycloud', 'meta_cloud')),
  recipient_fingerprint text not null check (recipient_fingerprint ~ '^[a-f0-9]{64}$'),
  content_fingerprint text not null check (content_fingerprint ~ '^[a-f0-9]{64}$'),
  authorization_fingerprint text not null check (authorization_fingerprint ~ '^[a-f0-9]{64}$'),
  status text not null default 'requested' check (status in ('requested', 'sending', 'provider_accepted', 'provider_outcome_unknown', 'delivered', 'read', 'failed')),
  provider_message_id text,
  expires_at timestamptz not null,
  claimed_at timestamptz,
  accepted_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, provider_message_id),
  unique(authorization_fingerprint)
);

create index yarbi_whatsapp_send_operations_owner_created_idx
  on public.yarbi_whatsapp_send_operations(owner_account_id, created_at desc);
create index yarbi_whatsapp_send_operations_provider_message_idx
  on public.yarbi_whatsapp_send_operations(provider, provider_message_id)
  where provider_message_id is not null;

alter table public.yarbi_whatsapp_send_operations enable row level security;
revoke all on table public.yarbi_whatsapp_send_operations from public, anon, authenticated;
grant select, insert, update on table public.yarbi_whatsapp_send_operations to service_role;

create function public.claim_yarbi_whatsapp_send_operation(
  p_operation_id uuid,
  p_owner_account_id uuid,
  p_provider text,
  p_recipient_fingerprint text,
  p_content_fingerprint text,
  p_authorization_fingerprint text
) returns setof public.yarbi_whatsapp_send_operations
language plpgsql
security invoker
set search_path = public
as $$
begin
  return query
  update public.yarbi_whatsapp_send_operations
     set status = 'sending', claimed_at = now(), updated_at = now()
   where operation_id = p_operation_id
     and owner_account_id = p_owner_account_id
     and provider = p_provider
     and recipient_fingerprint = p_recipient_fingerprint
     and content_fingerprint = p_content_fingerprint
     and authorization_fingerprint = p_authorization_fingerprint
     and status = 'requested'
     and expires_at >= now()
  returning *;
end;
$$;

revoke all on function public.claim_yarbi_whatsapp_send_operation(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_yarbi_whatsapp_send_operation(uuid, uuid, text, text, text, text) to service_role;

commit;
