-- Solo lectura: assertions funcionales sobre fixtures F3S en yarbi-audit-preview.
-- No consulta whatsapp_messages, ai_message_analysis, CRM real ni servicios externos.
with owners as (
  select id, email from auth.users
  where email in ('yarbi-owner-scope-a@invalid.test','yarbi-owner-scope-b@invalid.test')
), a_scope as (
  select s.contact_id from public.yarbi_owner_contact_scope s
  join owners o on o.id=s.owner_account_id
  where o.email='yarbi-owner-scope-a@invalid.test'
), b_scope as (
  select s.contact_id from public.yarbi_owner_contact_scope s
  join owners o on o.id=s.owner_account_id
  where o.email='yarbi-owner-scope-b@invalid.test'
), a_contacts as (
  select c.id,c.display_name,c.latest_service from public.crm_contacts c
  join a_scope s on s.contact_id=c.id
), b_contacts as (
  select c.id,c.display_name,c.latest_service from public.crm_contacts c
  join b_scope s on s.contact_id=c.id
), a_comas as (
  select c.id from a_contacts c
  join public.yarbi_contact_operational_memory m on m.contact_id=c.id
  where m.memory_type='district' and m.state='active' and m.value->>'district'='Comas'
), b_comas as (
  select c.id from b_contacts c
  join public.yarbi_contact_operational_memory m on m.contact_id=c.id
  where m.memory_type='district' and m.state='active' and m.value->>'district'='Comas'
), a_phone as (
  select ci.contact_id from public.contact_identifiers ci
  join a_scope s on s.contact_id=ci.contact_id
  where ci.identifier_type='phone' and ci.normalized_value='900000001'
), b_phone as (
  select ci.contact_id from public.contact_identifiers ci
  join b_scope s on s.contact_id=ci.contact_id
  where ci.identifier_type='phone' and ci.normalized_value='900000001'
)
select
  (select count(*) from a_contacts)=2 as a_scope_exact,
  (select count(*) from b_contacts)=2 as b_scope_exact,
  (select count(*) from (select id from a_contacts intersect select id from b_contacts) x)=0 as scopes_disjoint,
  (select count(*) from a_contacts where display_name='YARBI-OWNER-SCOPE-DUPLICADO')=1 as same_name_in_a,
  (select count(*) from b_contacts where display_name='YARBI-OWNER-SCOPE-DUPLICADO')=1 as same_name_in_b,
  (select count(*) from a_comas)=1 as district_filter_a,
  (select count(*) from b_comas)=1 as district_filter_b,
  (select count(*) from a_contacts where latest_service='reparacion')=1 as service_filter_a,
  (select count(*) from b_contacts where latest_service='reparacion')=1 as service_filter_b,
  (select count(*) from a_phone)=1 as exact_phone_in_a,
  (select count(*) from b_phone)=0 as exact_phone_excluded_from_b;
