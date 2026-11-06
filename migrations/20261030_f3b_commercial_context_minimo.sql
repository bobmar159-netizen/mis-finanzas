-- Fase 3B: contexto comercial determinista. Solo se aplica al entorno aislado
-- hasta autorizar una promoción separada.
begin;

do $$
declare
  column_row record;
begin
  if to_regclass('public.crm_contacts') is null
     or to_regclass('public.whatsapp_messages') is null then
    raise exception 'F3B: faltan tablas de contexto comercial';
  end if;
  if to_regprocedure('public.update_yarbi_commercial_context(bigint,text,timestamptz,text,boolean,text,text)') is not null then
    raise exception 'F3B: update_yarbi_commercial_context ya existe; no se sustituye silenciosamente';
  end if;

  alter table public.crm_contacts add column if not exists last_contact_at timestamptz;
  alter table public.crm_contacts add column if not exists last_contact_message_id text;
  alter table public.crm_contacts add column if not exists latest_service text;
  alter table public.crm_contacts add column if not exists latest_service_source_message_id text;
  alter table public.crm_contacts add column if not exists commercial_context_reason text;
  alter table public.crm_contacts add column if not exists commercial_context_source text;
  alter table public.crm_contacts add column if not exists commercial_context_source_message_id text;
  alter table public.crm_contacts add column if not exists commercial_context_updated_at timestamptz;

  for column_row in
    select column_name, data_type, is_nullable
    from information_schema.columns
    where table_schema='public' and table_name='crm_contacts'
      and column_name in ('last_contact_at','last_contact_message_id','latest_service','latest_service_source_message_id','commercial_context_reason','commercial_context_source','commercial_context_source_message_id','commercial_context_updated_at')
  loop
    if (column_row.column_name in ('last_contact_at','commercial_context_updated_at') and column_row.data_type <> 'timestamp with time zone')
       or (column_row.column_name not in ('last_contact_at','commercial_context_updated_at') and column_row.data_type <> 'text')
       or column_row.is_nullable <> 'YES' then
      raise exception 'F3B: columna incompatible %.%', 'crm_contacts', column_row.column_name;
    end if;
  end loop;
end
$$;

alter table public.crm_contacts
  add constraint crm_contacts_latest_service_check
  check (latest_service is null or latest_service in ('instalacion_nueva','punto_adicional','modificacion_tuberia','conversion_artefacto','reparacion','otro','unknown'));
alter table public.crm_contacts
  add constraint crm_contacts_context_source_check
  check (commercial_context_source is null or commercial_context_source in ('interactive_service_selection','operator_verified','none'));
alter table public.crm_contacts
  add constraint crm_contacts_last_contact_message_fkey
  foreign key (last_contact_message_id) references public.whatsapp_messages(id) on delete set null;
alter table public.crm_contacts
  add constraint crm_contacts_latest_service_message_fkey
  foreign key (latest_service_source_message_id) references public.whatsapp_messages(id) on delete set null;
alter table public.crm_contacts
  add constraint crm_contacts_context_message_fkey
  foreign key (commercial_context_source_message_id) references public.whatsapp_messages(id) on delete set null;

create index crm_contacts_last_contact_at_idx on public.crm_contacts(last_contact_at desc nulls last);

create function public.update_yarbi_commercial_context(
  p_contact_id bigint,
  p_message_id text,
  p_occurred_at timestamptz,
  p_service text default null,
  p_visit_requested boolean default false,
  p_source text default 'none',
  p_reason text default 'identity_resolved_no_commercial_signal'
)
returns table(
  outcome text,
  previous_status text,
  current_status text,
  previous_service text,
  current_service text,
  last_contact_at timestamptz
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  current_contact public.crm_contacts%rowtype;
  next_status text;
  next_service text;
  status_rank_current integer;
  status_rank_next integer;
  changed_last_contact boolean := false;
  changed_service boolean := false;
  changed_status boolean := false;
  evidence_is_current boolean := false;
  safe_source text := coalesce(nullif(btrim(p_source),''),'none');
  safe_reason text := coalesce(nullif(btrim(p_reason),''),'identity_resolved_no_commercial_signal');
begin
  if p_contact_id is null or nullif(btrim(p_message_id),'') is null or p_occurred_at is null then
    raise exception 'commercial_context_reference_invalid' using errcode='22023';
  end if;
  if safe_source not in ('interactive_service_selection','operator_verified','none') then
    raise exception 'commercial_context_source_invalid' using errcode='22023';
  end if;
  if p_service is not null and p_service not in ('instalacion_nueva','punto_adicional','modificacion_tuberia','conversion_artefacto','reparacion','otro','unknown') then
    raise exception 'commercial_context_service_invalid' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('yarbi-commercial:' || p_contact_id::text)::bigint);
  select * into current_contact from public.crm_contacts where id=p_contact_id for update;
  if not found then raise exception 'commercial_context_contact_not_found' using errcode='23503'; end if;
  if not exists (select 1 from public.whatsapp_messages wm where wm.id=p_message_id and wm.contact_id=p_contact_id) then
    raise exception 'commercial_context_message_not_linked' using errcode='23514';
  end if;

  previous_status := current_contact.commercial_status;
  previous_service := current_contact.latest_service;
  -- Una reentrega o mensaje atrasado no puede reescribir el contexto actual.
  evidence_is_current := current_contact.last_contact_at is null or p_occurred_at > current_contact.last_contact_at;
  next_service := case when evidence_is_current then coalesce(p_service, current_contact.latest_service) else current_contact.latest_service end;
  if evidence_is_current and p_service is not null and p_service is distinct from current_contact.latest_service then changed_service := true; end if;

  status_rank_current := case current_contact.commercial_status when 'caliente' then 2 when 'tibio' then 1 else 0 end;
  status_rank_next := case when not evidence_is_current then 0 when p_visit_requested then 2 when p_service is not null then 1 else 0 end;
  next_status := case greatest(status_rank_current,status_rank_next) when 2 then 'caliente' when 1 then 'tibio' else 'frio' end;
  changed_status := next_status is distinct from current_contact.commercial_status;
  changed_last_contact := evidence_is_current;

  update public.crm_contacts as cc
     set last_contact_at = case when changed_last_contact then p_occurred_at else cc.last_contact_at end,
         last_contact_message_id = case when changed_last_contact then p_message_id else cc.last_contact_message_id end,
         latest_service = next_service,
         latest_service_source_message_id = case when changed_service then p_message_id else cc.latest_service_source_message_id end,
         commercial_status = next_status,
         status_reason = case when changed_status then safe_reason else cc.status_reason end,
         commercial_context_reason = case when changed_last_contact or changed_service or changed_status then safe_reason else cc.commercial_context_reason end,
         commercial_context_source = case when changed_last_contact or changed_service or changed_status then safe_source else cc.commercial_context_source end,
         commercial_context_source_message_id = case when changed_last_contact or changed_service or changed_status then p_message_id else cc.commercial_context_source_message_id end,
         commercial_context_updated_at = case when changed_last_contact or changed_service or changed_status then now() else cc.commercial_context_updated_at end,
         updated_at = case when changed_last_contact or changed_service or changed_status then now() else cc.updated_at end
   where cc.id=p_contact_id;

  current_status := next_status;
  current_service := next_service;
  outcome := case when changed_status then 'status_changed'
                  when changed_service then 'service_recorded'
                  when changed_last_contact then 'context_updated'
                  else 'unchanged' end;
  last_contact_at := case when changed_last_contact then p_occurred_at else current_contact.last_contact_at end;
  return next;
end;
$$;

revoke all on function public.update_yarbi_commercial_context(bigint,text,timestamptz,text,boolean,text,text) from public, anon, authenticated;
grant execute on function public.update_yarbi_commercial_context(bigint,text,timestamptz,text,boolean,text,text) to service_role;

commit;
