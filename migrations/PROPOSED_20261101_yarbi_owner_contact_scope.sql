-- PROPUESTA SOLAMENTE. NO APLICADA.
-- Requiere autorización posterior y preflight del catálogo aislado.
-- Fuente canónica de pertenencia: auth.users.id -> crm_contacts.id.

begin;

do $$
declare
  contacts_id_type text;
begin
  if to_regclass('public.yarbi_owner_contact_scope') is not null then
    raise exception 'owner_contact_scope_already_exists_manual_contract_review_required';
  end if;
  if to_regclass('public.crm_contacts') is null then
    raise exception 'owner_contact_scope_requires_crm_contacts';
  end if;
  select data_type into contacts_id_type
  from information_schema.columns
  where table_schema = 'public' and table_name = 'crm_contacts' and column_name = 'id';
  if contacts_id_type is distinct from 'bigint' then
    raise exception 'owner_contact_scope_crm_contacts_id_incompatible:%', coalesce(contacts_id_type, '<missing>');
  end if;
end $$;

create table public.yarbi_owner_contact_scope (
  owner_account_id uuid not null references auth.users(id) on delete cascade,
  contact_id bigint not null references public.crm_contacts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_account_id, contact_id)
);

alter table public.yarbi_owner_contact_scope enable row level security;

-- Una política explícita para el dueño autenticado. El backend service_role
-- conserva el acceso técnico requerido por el adaptador; no se añaden grants.
create policy yarbi_owner_contact_scope_select_own
  on public.yarbi_owner_contact_scope
  for select
  to authenticated
  using (owner_account_id = auth.uid());

create index yarbi_owner_contact_scope_contact_idx
  on public.yarbi_owner_contact_scope(contact_id, owner_account_id);

commit;
