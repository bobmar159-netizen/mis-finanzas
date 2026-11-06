-- Ejecutar SOLO en yarbi-audit-preview (uevilhbstnmmdlgyshlv).
-- Reasigna cuatro scopes F3S existentes a owners sintéticos que pueden
-- iniciar sesión. No inserta contactos, mensajes, análisis ni datos reales.
begin;

do $$
declare
  old_a uuid;
  old_b uuid;
  new_a uuid;
  new_b uuid;
  new_empty uuid;
  old_a_count integer;
  old_b_count integer;
  shared_count integer;
  target_scope_count integer;
begin
  select id into old_a from auth.users where email = 'yarbi-owner-scope-a@invalid.test';
  select id into old_b from auth.users where email = 'yarbi-owner-scope-b@invalid.test';
  select id into new_a from auth.users where email = 'yarbi-e2e-auth-a@invalid.test';
  select id into new_b from auth.users where email = 'yarbi-e2e-auth-b@invalid.test';
  select id into new_empty from auth.users where email = 'yarbi-e2e-auth-empty@invalid.test';

  if old_a is null or old_b is null then raise exception 'F3REF source owners missing'; end if;
  if new_a is null or new_b is null or new_empty is null then raise exception 'F3REF create the three confirmed synthetic auth users first'; end if;
  if exists (select 1 from auth.users where id in (new_a,new_b,new_empty) and email_confirmed_at is null) then raise exception 'F3REF target owners must be confirmed'; end if;

  select count(*) into old_a_count from public.yarbi_owner_contact_scope s join public.crm_contacts c on c.id=s.contact_id where s.owner_account_id=old_a and c.source='f3_owner_scope_fixture';
  select count(*) into old_b_count from public.yarbi_owner_contact_scope s join public.crm_contacts c on c.id=s.contact_id where s.owner_account_id=old_b and c.source='f3_owner_scope_fixture';
  if old_a_count <> 2 or old_b_count <> 2 then raise exception 'F3REF expected exactly two F3S contacts per source owner, got A %, B %', old_a_count, old_b_count; end if;

  select count(*) into shared_count from (
    select s.contact_id from public.yarbi_owner_contact_scope s join public.crm_contacts c on c.id=s.contact_id where s.owner_account_id=old_a and c.source='f3_owner_scope_fixture'
    intersect
    select s.contact_id from public.yarbi_owner_contact_scope s join public.crm_contacts c on c.id=s.contact_id where s.owner_account_id=old_b and c.source='f3_owner_scope_fixture'
  ) shared;
  if shared_count <> 0 then raise exception 'F3REF source scopes share fixture contacts'; end if;

  select count(*) into target_scope_count from public.yarbi_owner_contact_scope where owner_account_id in (new_a,new_b,new_empty);
  if target_scope_count <> 0 then raise exception 'F3REF target owners must begin with zero scope rows'; end if;

  update public.yarbi_owner_contact_scope s set owner_account_id=new_a
    from public.crm_contacts c where s.contact_id=c.id and s.owner_account_id=old_a and c.source='f3_owner_scope_fixture';
  update public.yarbi_owner_contact_scope s set owner_account_id=new_b
    from public.crm_contacts c where s.contact_id=c.id and s.owner_account_id=old_b and c.source='f3_owner_scope_fixture';
end $$;

-- Evidencia sanitizada de la reasignación: solo conteos, sin UUID ni PII.
with targets as (
  select id,email from auth.users where email in ('yarbi-e2e-auth-a@invalid.test','yarbi-e2e-auth-b@invalid.test','yarbi-e2e-auth-empty@invalid.test')
), scoped as (
  select t.email,s.contact_id from targets t left join public.yarbi_owner_contact_scope s on s.owner_account_id=t.id
), fixture_scope as (
  select x.email,x.contact_id from scoped x join public.crm_contacts c on c.id=x.contact_id where c.source='f3_owner_scope_fixture'
)
select
  (select count(*) from fixture_scope where email='yarbi-e2e-auth-a@invalid.test') as owner_a_contacts,
  (select count(*) from fixture_scope where email='yarbi-e2e-auth-b@invalid.test') as owner_b_contacts,
  (select count(*) from fixture_scope where email='yarbi-e2e-auth-empty@invalid.test') as owner_empty_contacts,
  (select count(*) from (select contact_id from fixture_scope where email='yarbi-e2e-auth-a@invalid.test' intersect select contact_id from fixture_scope where email='yarbi-e2e-auth-b@invalid.test') overlap) as shared_fixture_contacts;

commit;
