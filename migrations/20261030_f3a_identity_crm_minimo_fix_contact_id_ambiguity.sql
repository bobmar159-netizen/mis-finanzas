-- Fase 3A: corrección puntual del resolver ya instalado en el entorno aislado.
-- El cambio solo califica columnas homónimas para evitar la ambigüedad PL/pgSQL.
begin;

create or replace function public.resolve_or_create_contact_by_phone(
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

  perform pg_advisory_xact_lock(hashtext('yarbi-phone:' || normalized_phone)::bigint);

  select ci.contact_id into selected_contact_id
    from public.contact_identifiers ci
   where ci.identifier_type='phone' and ci.normalized_value=normalized_phone
   limit 1;

  if selected_contact_id is null then
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
