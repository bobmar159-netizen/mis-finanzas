-- Reparación F3E para la ambigüedad PL/pgSQL entre la columna y el OUT `state`.
-- No toca tabla, índices, RLS ni grants; reemplaza únicamente las dos RPC F3E.
begin;

create or replace function public.upsert_yarbi_contact_operational_memory(
  p_contact_id bigint, p_memory_type text, p_memory_key text, p_value jsonb,
  p_source text, p_source_message_id text, p_source_event_id text, p_occurred_at timestamptz
)
returns table(outcome text, memory_id bigint, previous_memory_id bigint, state text)
language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  active_fact public.yarbi_contact_operational_memory%rowtype;
  existing_fact public.yarbi_contact_operational_memory%rowtype;
  inserted_id bigint;
  safe_type text := nullif(btrim(p_memory_type), '');
  safe_key text := nullif(btrim(p_memory_key), '');
  safe_source text := nullif(btrim(p_source), '');
  safe_message_id text := nullif(btrim(p_source_message_id), '');
  safe_event_id text := nullif(btrim(p_source_event_id), '');
begin
  if p_contact_id is null or safe_type is null or safe_key is null or safe_source is null
     or p_occurred_at is null or p_value is null or jsonb_typeof(p_value) <> 'object'
     or (safe_message_id is null and safe_event_id is null) then
    raise exception 'operational_memory_reference_invalid' using errcode='22023';
  end if;
  if safe_type not in ('service','district','location','pending_step','visit','customer_commitment','business_commitment','objection')
     or safe_source not in ('verified_webhook','operator_verified','structured_context','internal_event')
     or length(safe_key) > 120 then
    raise exception 'operational_memory_contract_invalid' using errcode='22023';
  end if;
  if not exists (select 1 from public.crm_contacts cc where cc.id=p_contact_id) then
    raise exception 'operational_memory_contact_not_found' using errcode='23503';
  end if;
  if safe_message_id is not null and not exists (
    select 1 from public.whatsapp_messages wm where wm.id=safe_message_id and wm.contact_id=p_contact_id
  ) then
    raise exception 'operational_memory_message_not_linked' using errcode='23514';
  end if;
  perform pg_advisory_xact_lock(hashtext('yarbi-operational-memory:' || p_contact_id::text || ':' || safe_type || ':' || safe_key)::bigint);
  if safe_event_id is not null then
    select * into existing_fact from public.yarbi_contact_operational_memory om
     where om.contact_id=p_contact_id and om.memory_type=safe_type and om.memory_key=safe_key and om.source_event_id=safe_event_id limit 1;
    if found then outcome := 'duplicate_event'; memory_id := existing_fact.id; previous_memory_id := null; state := existing_fact.state; return next; return; end if;
  end if;
  select * into active_fact from public.yarbi_contact_operational_memory om
   where om.contact_id=p_contact_id and om.memory_type=safe_type and om.memory_key=safe_key and om.state='active' for update;
  if not found then
    insert into public.yarbi_contact_operational_memory(contact_id,memory_type,memory_key,value,source,source_message_id,source_event_id,occurred_at,state)
    values (p_contact_id,safe_type,safe_key,p_value,safe_source,safe_message_id,safe_event_id,p_occurred_at,'active') returning id into inserted_id;
    outcome := 'created'; memory_id := inserted_id; previous_memory_id := null; state := 'active'; return next; return;
  end if;
  if p_occurred_at > active_fact.occurred_at then
    update public.yarbi_contact_operational_memory as current_memory
       set state='superseded', superseded_at=now(), updated_at=now()
     where current_memory.id=active_fact.id and current_memory.state='active';
    insert into public.yarbi_contact_operational_memory(contact_id,memory_type,memory_key,value,source,source_message_id,source_event_id,occurred_at,state)
    values (p_contact_id,safe_type,safe_key,p_value,safe_source,safe_message_id,safe_event_id,p_occurred_at,'active') returning id into inserted_id;
    outcome := 'superseded_previous'; memory_id := inserted_id; previous_memory_id := active_fact.id; state := 'active'; return next; return;
  end if;
  insert into public.yarbi_contact_operational_memory(contact_id,memory_type,memory_key,value,source,source_message_id,source_event_id,occurred_at,state,superseded_at)
  values (p_contact_id,safe_type,safe_key,p_value,safe_source,safe_message_id,safe_event_id,p_occurred_at,'superseded',now()) returning id into inserted_id;
  outcome := 'stale_recorded'; memory_id := inserted_id; previous_memory_id := active_fact.id; state := 'superseded'; return next;
end;
$$;

create or replace function public.resolve_yarbi_contact_operational_memory(
  p_contact_id bigint, p_memory_type text, p_memory_key text, p_source_message_id text,
  p_source_event_id text, p_occurred_at timestamptz
)
returns table(outcome text, memory_id bigint, state text)
language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  active_fact public.yarbi_contact_operational_memory%rowtype;
  resolved_fact public.yarbi_contact_operational_memory%rowtype;
  safe_type text := nullif(btrim(p_memory_type), '');
  safe_key text := nullif(btrim(p_memory_key), '');
  safe_message_id text := nullif(btrim(p_source_message_id), '');
  safe_event_id text := nullif(btrim(p_source_event_id), '');
begin
  if p_contact_id is null or safe_type is null or safe_key is null or safe_event_id is null or p_occurred_at is null then raise exception 'operational_memory_resolution_invalid' using errcode='22023'; end if;
  if safe_type not in ('service','district','location','pending_step','visit','customer_commitment','business_commitment','objection') or length(safe_key) > 120 then raise exception 'operational_memory_contract_invalid' using errcode='22023'; end if;
  if safe_message_id is not null and not exists (select 1 from public.whatsapp_messages wm where wm.id=safe_message_id and wm.contact_id=p_contact_id) then raise exception 'operational_memory_message_not_linked' using errcode='23514'; end if;
  perform pg_advisory_xact_lock(hashtext('yarbi-operational-memory:' || p_contact_id::text || ':' || safe_type || ':' || safe_key)::bigint);
  select * into resolved_fact from public.yarbi_contact_operational_memory om
   where om.contact_id=p_contact_id and om.memory_type=safe_type and om.memory_key=safe_key and om.resolution_source_event_id=safe_event_id limit 1;
  if found then outcome := 'duplicate_resolution'; memory_id := resolved_fact.id; state := resolved_fact.state; return next; return; end if;
  select * into active_fact from public.yarbi_contact_operational_memory om
   where om.contact_id=p_contact_id and om.memory_type=safe_type and om.memory_key=safe_key and om.state='active' for update;
  if not found then outcome := 'unchanged'; memory_id := null; state := null; return next; return; end if;
  if p_occurred_at < active_fact.occurred_at then outcome := 'stale_ignored'; memory_id := active_fact.id; state := active_fact.state; return next; return; end if;
  update public.yarbi_contact_operational_memory as current_memory
     set state='resolved', resolved_at=now(), resolution_source_message_id=safe_message_id,
         resolution_source_event_id=safe_event_id, updated_at=now()
   where current_memory.id=active_fact.id and current_memory.state='active';
  outcome := 'resolved'; memory_id := active_fact.id; state := 'resolved'; return next;
end;
$$;

commit;
