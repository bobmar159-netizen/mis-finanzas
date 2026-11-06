-- Fase 3A: resolución transaccional de identidad por teléfono.
-- Solo para el entorno aislado hasta recibir una aprobación de producción aparte.
begin;

do $$
declare
  status_constraint record;
  status_definition text;
begin
  if to_regclass('public.whatsapp_messages') is null
     or to_regclass('public.ai_message_analysis') is null
     or to_regclass('public.crm_contacts') is null
     or to_regclass('public.contact_identifiers') is null then
    raise exception 'F3A: faltan tablas canónicas de identidad';
  end if;
  if to_regprocedure('public.resolve_or_create_contact_by_phone(text,text,bigint)') is not null then
    raise exception 'F3A: resolve_or_create_contact_by_phone ya existe; no se sustituye silenciosamente';
  end if;

  select c.oid, c.conname, pg_get_constraintdef(c.oid) as definition
    into status_constraint
    from pg_constraint c
   where c.conrelid='public.ai_message_analysis'::regclass
     and c.contype='c'
     and lower(pg_get_constraintdef(c.oid)) like '%identity_pending%'
   limit 1;
  if not found then
    raise exception 'F3A: no se encontró la restricción de estados de ai_message_analysis';
  end if;
  status_definition := lower(status_constraint.definition);
  if status_definition not like '%pending%'
     or status_definition not like '%processing%'
     or status_definition not like '%completed%'
     or status_definition not like '%failed%'
     or status_definition not like '%skipped%'
     or status_definition not like '%identity_pending%' then
    raise exception 'F3A: restricción de estados incompatible: %', status_constraint.definition;
  end if;
  execute format('alter table public.ai_message_analysis drop constraint %I', status_constraint.conname);
  alter table public.ai_message_analysis add constraint ai_message_analysis_status_check
    check (status in ('pending','processing','completed','failed','skipped','identity_pending','identity_resolved'));
end
$$;

create function public.resolve_or_create_contact_by_phone(
  p_phone text,
  p_message_id text,
  p_analysis_id bigint
)
returns table(contact_id bigint, outcome text)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  normalized_phone text;
  selected_contact_id bigint;
  created_contact_id bigint;
  message_contact_id bigint;
  analysis_contact_id bigint;
begin
  normalized_phone := regexp_replace(coalesce(p_phone,''), '\D', '', 'g');
  if normalized_phone like '51%' and length(normalized_phone)=11 then
    normalized_phone := substr(normalized_phone, 3);
  end if;
  if normalized_phone !~ '^\d{8,15}$' then
    raise exception 'identity_phone_invalid' using errcode='22023';
  end if;
  if nullif(btrim(p_message_id),'') is null or p_analysis_id is null then
    raise exception 'identity_reference_invalid' using errcode='22023';
  end if;

  -- Serializa únicamente el mismo teléfono; teléfonos distintos permanecen paralelos.
  perform pg_advisory_xact_lock(hashtext('yarbi-phone:' || normalized_phone)::bigint);

  select ci.contact_id into selected_contact_id
    from public.contact_identifiers ci
   where ci.identifier_type='phone' and ci.normalized_value=normalized_phone
   limit 1;

  if selected_contact_id is null then
    -- No se fabrica nombre: full_name y display_name permanecen NULL.
    insert into public.crm_contacts(source) values ('whatsapp')
      returning id into created_contact_id;
    begin
      insert into public.contact_identifiers(
        contact_id, identifier_type, identifier_value, normalized_value, is_primary
      ) values (
        created_contact_id, 'phone', normalized_phone, normalized_phone, true
      );
      selected_contact_id := created_contact_id;
      outcome := 'created_new';
    exception when unique_violation then
      select ci.contact_id into selected_contact_id
        from public.contact_identifiers ci
       where ci.identifier_type='phone' and ci.normalized_value=normalized_phone
       limit 1;
      if selected_contact_id is null then raise; end if;
      delete from public.crm_contacts where id=created_contact_id;
      outcome := 'resolved_existing';
    end;
  else
    outcome := 'resolved_existing';
  end if;

  update public.whatsapp_messages as wm
     set contact_id=selected_contact_id
   where wm.id=p_message_id
     and (wm.contact_id is null or wm.contact_id=selected_contact_id)
  returning wm.contact_id into message_contact_id;
  if message_contact_id is null then
    raise exception 'identity_message_link_conflict' using errcode='23514';
  end if;

  update public.ai_message_analysis as ama
     set contact_id=selected_contact_id
   where ama.id=p_analysis_id and ama.message_id=p_message_id
     and (ama.contact_id is null or ama.contact_id=selected_contact_id)
  returning ama.contact_id into analysis_contact_id;
  if analysis_contact_id is null then
    raise exception 'identity_analysis_link_conflict' using errcode='23514';
  end if;

  contact_id := selected_contact_id;
  return next;
end;
$$;

revoke all on function public.resolve_or_create_contact_by_phone(text,text,bigint) from public, anon, authenticated;
grant execute on function public.resolve_or_create_contact_by_phone(text,text,bigint) to service_role;

commit;
