-- Ejecutar solamente en yarbi-audit-preview (uevilhbstnmmdlgyshlv).
-- Crea cuatro contactos y dos dueños completamente sintéticos F3S-*.
-- No inserta mensajes, conversaciones, agenda, memoria semántica ni acciones.
begin;

do $$
declare
  owner_a uuid;
  owner_b uuid;
  a_comas bigint;
  a_ate bigint;
  b_comas bigint;
  b_ate bigint;
begin
  select id into owner_a from auth.users where email='yarbi-owner-scope-a@invalid.test';
  select id into owner_b from auth.users where email='yarbi-owner-scope-b@invalid.test';
  if owner_a is null or owner_b is null then
    raise exception 'F3S owners missing: create the two synthetic auth users first';
  end if;
  if exists (select 1 from public.crm_contacts where source='f3_owner_scope_fixture') then
    raise exception 'F3S fixtures already exist: do not duplicate';
  end if;

  insert into public.crm_contacts(source, full_name, display_name, commercial_status, latest_service, last_contact_at)
    values ('f3_owner_scope_fixture','YARBI-OWNER-SCOPE-DUPLICADO','YARBI-OWNER-SCOPE-DUPLICADO','tibio','reparacion',now()) returning id into a_comas;
  insert into public.crm_contacts(source, full_name, display_name, commercial_status, latest_service, last_contact_at)
    values ('f3_owner_scope_fixture','YARBI-OWNER-SCOPE-ATE','YARBI-OWNER-SCOPE-ATE','tibio','punto_adicional',now()) returning id into a_ate;
  insert into public.crm_contacts(source, full_name, display_name, commercial_status, latest_service, last_contact_at)
    values ('f3_owner_scope_fixture','YARBI-OWNER-SCOPE-DUPLICADO','YARBI-OWNER-SCOPE-DUPLICADO','tibio','reparacion',now()) returning id into b_comas;
  insert into public.crm_contacts(source, full_name, display_name, commercial_status, latest_service, last_contact_at)
    values ('f3_owner_scope_fixture','YARBI-OWNER-SCOPE-ATE','YARBI-OWNER-SCOPE-ATE','tibio','punto_adicional',now()) returning id into b_ate;

  insert into public.contact_identifiers(contact_id,identifier_type,identifier_value,normalized_value,is_primary) values
    (a_comas,'phone','900000001','900000001',true),
    (a_ate,'phone','900000002','900000002',true),
    (b_comas,'phone','900000003','900000003',true),
    (b_ate,'phone','900000004','900000004',true);

  insert into public.yarbi_owner_contact_scope(owner_account_id,contact_id) values
    (owner_a,a_comas),(owner_a,a_ate),(owner_b,b_comas),(owner_b,b_ate);

  insert into public.yarbi_contact_operational_memory(contact_id,memory_type,memory_key,value,source,source_event_id,occurred_at,state) values
    (a_comas,'district','current','{"district":"Comas"}'::jsonb,'internal_event','F3S-A-COMAS',now(),'active'),
    (a_ate,'district','current','{"district":"Ate"}'::jsonb,'internal_event','F3S-A-ATE',now(),'active'),
    (b_comas,'district','current','{"district":"Comas"}'::jsonb,'internal_event','F3S-B-COMAS',now(),'active'),
    (b_ate,'district','current','{"district":"Ate"}'::jsonb,'internal_event','F3S-B-ATE',now(),'active');
end $$;

commit;
