-- Solo lectura. Simula el rol de backend dentro de una transacción que revierte.
begin;
set local role service_role;

select
  count(*) = 4 as service_role_reads_all_scoped_fixtures,
  count(distinct s.owner_account_id) = 2 as service_role_sees_two_synthetic_owners,
  count(distinct s.contact_id) = 4 as service_role_sees_four_distinct_contacts
from public.yarbi_owner_contact_scope s
join public.crm_contacts c on c.id=s.contact_id
where c.source='f3_owner_scope_fixture';

rollback;
