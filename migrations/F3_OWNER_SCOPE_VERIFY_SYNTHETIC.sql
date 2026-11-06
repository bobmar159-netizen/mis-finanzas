-- Verificación de solo lectura para yarbi-audit-preview.
-- Devuelve únicamente conteos y contratos de fixtures F3S, sin IDs ni datos reales.
with fixture_contacts as (
  select id from public.crm_contacts where source='f3_owner_scope_fixture'
), scope_stats as (
  select
    count(*) filter (where owner_account_id=(select id from auth.users where email='yarbi-owner-scope-a@invalid.test')) as owner_a_contacts,
    count(*) filter (where owner_account_id=(select id from auth.users where email='yarbi-owner-scope-b@invalid.test')) as owner_b_contacts,
    count(*) as scoped_fixture_contacts,
    count(distinct contact_id) as distinct_scoped_fixture_contacts
  from public.yarbi_owner_contact_scope
  where contact_id in (select id from fixture_contacts)
), cross_owner as (
  select count(*) as shared_fixture_contacts
  from (
    select contact_id
    from public.yarbi_owner_contact_scope
    where contact_id in (select id from fixture_contacts)
    group by contact_id
    having count(distinct owner_account_id) > 1
  ) shared
)
select
  (select count(*) from fixture_contacts) as synthetic_contacts,
  (select owner_a_contacts from scope_stats) as owner_a_contacts,
  (select owner_b_contacts from scope_stats) as owner_b_contacts,
  (select scoped_fixture_contacts from scope_stats) as scoped_fixture_contacts,
  (select distinct_scoped_fixture_contacts from scope_stats) as distinct_scoped_fixture_contacts,
  (select shared_fixture_contacts from cross_owner) as shared_fixture_contacts,
  (select relrowsecurity from pg_class where oid='public.yarbi_owner_contact_scope'::regclass) as scope_rls,
  has_table_privilege('anon','public.yarbi_owner_contact_scope','select') as anon_select,
  has_table_privilege('authenticated','public.yarbi_owner_contact_scope','select') as authenticated_select,
  has_table_privilege('service_role','public.yarbi_owner_contact_scope','select') as service_role_select;
