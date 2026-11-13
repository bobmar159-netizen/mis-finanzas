-- Propuesta local: cola durable para aprendizaje histórico por contacto.
-- No aplicar automáticamente. No almacena texto de WhatsApp: solo referencias
-- de mensaje y propuestas que requieren revisión explícita del propietario.
begin;

create table if not exists public.yarbi_historical_intelligence_batches (
  id uuid primary key default gen_random_uuid(),
  owner_account_id uuid not null references auth.users(id) on delete cascade,
  contact_id bigint not null references public.crm_contacts(id) on delete cascade,
  idempotency_key text not null check (idempotency_key ~ '^[a-f0-9]{64}$'),
  message_ids jsonb not null check (jsonb_typeof(message_ids) = 'array' and jsonb_array_length(message_ids) between 1 and 60),
  outgoing_message_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(outgoing_message_ids) = 'array'),
  segment_index integer not null check (segment_index >= 0),
  segment_count integer not null check (segment_count >= 1 and segment_index < segment_count),
  occurred_from bigint,
  occurred_to bigint,
  status text not null default 'ready' check (status in ('ready','processing','awaiting_owner_review','approved','rejected','failed')),
  requires_owner_review boolean not null default true check (requires_owner_review),
  commercial_effects_allowed boolean not null default false check (not commercial_effects_allowed),
  proposal jsonb,
  error_code text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(owner_account_id, idempotency_key),
  check ((status in ('ready','processing') and proposal is null) or status not in ('ready','processing')),
  check ((status = 'awaiting_owner_review' and proposal is not null) or status <> 'awaiting_owner_review')
);

create index if not exists yarbi_historical_intelligence_owner_status_idx
  on public.yarbi_historical_intelligence_batches(owner_account_id, status, created_at asc);

create index if not exists yarbi_historical_intelligence_contact_idx
  on public.yarbi_historical_intelligence_batches(contact_id, created_at asc);

alter table public.yarbi_historical_intelligence_batches enable row level security;
-- La aplicación no escribe la tabla directamente. Incluso service_role usa
-- las RPC siguientes: dejan una frontera transaccional verificable entre el
-- planificador, el proveedor y la revisión humana.
revoke all on table public.yarbi_historical_intelligence_batches from public, anon, authenticated, service_role;

create function public.enqueue_yarbi_historical_intelligence_batch(
  p_owner_account_id uuid,
  p_contact_id bigint,
  p_idempotency_key text,
  p_message_ids jsonb,
  p_outgoing_message_ids jsonb,
  p_segment_index integer,
  p_segment_count integer,
  p_occurred_from bigint,
  p_occurred_to bigint
)
returns table(batch_id uuid, outcome text, status text, attempt_count integer)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.yarbi_historical_intelligence_batches%rowtype;
begin
  if p_owner_account_id is null or p_contact_id is null or p_contact_id <= 0
    or p_idempotency_key !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_message_ids) <> 'array'
    or jsonb_array_length(p_message_ids) not between 1 and 60
    or jsonb_typeof(p_outgoing_message_ids) <> 'array'
    or p_segment_index < 0 or p_segment_count < 1 or p_segment_index >= p_segment_count then
    raise exception 'historical_batch_input_invalid' using errcode = '22023';
  end if;

  insert into public.yarbi_historical_intelligence_batches (
    owner_account_id, contact_id, idempotency_key, message_ids,
    outgoing_message_ids, segment_index, segment_count, occurred_from, occurred_to
  ) values (
    p_owner_account_id, p_contact_id, p_idempotency_key, p_message_ids,
    p_outgoing_message_ids, p_segment_index, p_segment_count, p_occurred_from, p_occurred_to
  )
  on conflict (owner_account_id, idempotency_key) do nothing
  returning * into v_row;

  if found then
    return query select v_row.id, 'created'::text, v_row.status, v_row.attempt_count;
    return;
  end if;

  select * into v_row
  from public.yarbi_historical_intelligence_batches
  where owner_account_id = p_owner_account_id and idempotency_key = p_idempotency_key;
  return query select v_row.id, 'existing'::text, v_row.status, v_row.attempt_count;
end;
$$;

create function public.claim_yarbi_historical_intelligence_batch(
  p_owner_account_id uuid
)
returns table(
  batch_id uuid,
  contact_id bigint,
  idempotency_key text,
  message_ids jsonb,
  outgoing_message_ids jsonb,
  segment_index integer,
  segment_count integer,
  occurred_from bigint,
  occurred_to bigint,
  attempt_count integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  return query
  with next_batch as (
    select id
    from public.yarbi_historical_intelligence_batches
    where owner_account_id = p_owner_account_id and status = 'ready'
    order by created_at asc, id asc
    for update skip locked
    limit 1
  ), claimed as (
    update public.yarbi_historical_intelligence_batches as batch
    set status = 'processing', attempt_count = batch.attempt_count + 1, updated_at = now()
    from next_batch
    where batch.id = next_batch.id
    returning batch.*
  )
  select claimed.id, claimed.contact_id, claimed.idempotency_key,
    claimed.message_ids, claimed.outgoing_message_ids, claimed.segment_index,
    claimed.segment_count, claimed.occurred_from, claimed.occurred_to, claimed.attempt_count
  from claimed;
end;
$$;

create function public.complete_yarbi_historical_intelligence_batch(
  p_owner_account_id uuid,
  p_batch_id uuid,
  p_expected_attempt_count integer,
  p_proposal jsonb
)
returns table(batch_id uuid, status text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.yarbi_historical_intelligence_batches%rowtype;
begin
  if p_batch_id is null or p_expected_attempt_count < 1
    or jsonb_typeof(p_proposal) <> 'object'
    or p_proposal ->> 'schema' <> 'yarbi.historical-intelligence-result.v1'
    or p_proposal ->> 'task_key' !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_proposal -> 'contact_context_observations') <> 'array'
    or jsonb_typeof(p_proposal -> 'reply_style_patterns') <> 'array'
    or coalesce((p_proposal ->> 'commercial_effects_allowed')::boolean, true) <> false
    or coalesce((p_proposal ->> 'requires_owner_review')::boolean, false) <> true then
    raise exception 'historical_batch_completion_invalid' using errcode = '22023';
  end if;

  select * into v_row
  from public.yarbi_historical_intelligence_batches
  where id = p_batch_id and owner_account_id = p_owner_account_id
  for update;

  if not found then
    raise exception 'historical_batch_not_found' using errcode = 'P0002';
  end if;
  if v_row.status <> 'processing' or v_row.attempt_count <> p_expected_attempt_count then
    raise exception 'historical_batch_claim_conflict' using errcode = '40001';
  end if;
  if p_proposal ->> 'task_key' <> v_row.idempotency_key
    or p_proposal ->> 'contact_id' <> v_row.contact_id::text then
    raise exception 'historical_batch_result_binding_invalid' using errcode = '22023';
  end if;

  update public.yarbi_historical_intelligence_batches
  set status = 'awaiting_owner_review', proposal = p_proposal,
      completed_at = now(), updated_at = now(), error_code = null
  where id = v_row.id;
  return query select v_row.id, 'awaiting_owner_review'::text;
end;
$$;

create function public.fail_yarbi_historical_intelligence_batch(
  p_owner_account_id uuid,
  p_batch_id uuid,
  p_expected_attempt_count integer,
  p_error_code text
)
returns table(batch_id uuid, status text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.yarbi_historical_intelligence_batches%rowtype;
begin
  if p_batch_id is null or p_expected_attempt_count < 1 or p_error_code !~ '^[a-z0-9_:-]{1,80}$' then
    raise exception 'historical_batch_failure_invalid' using errcode = '22023';
  end if;
  select * into v_row
  from public.yarbi_historical_intelligence_batches
  where id = p_batch_id and owner_account_id = p_owner_account_id
  for update;
  if not found then
    raise exception 'historical_batch_not_found' using errcode = 'P0002';
  end if;
  if v_row.status <> 'processing' or v_row.attempt_count <> p_expected_attempt_count then
    raise exception 'historical_batch_claim_conflict' using errcode = '40001';
  end if;
  update public.yarbi_historical_intelligence_batches
  set status = 'failed', error_code = p_error_code, updated_at = now()
  where id = v_row.id;
  return query select v_row.id, 'failed'::text;
end;
$$;

-- Lectura y decisión separadas del procesamiento. Ambas RPC conservan el
-- vínculo con el owner autenticado y nunca devuelven texto de mensajes: la
-- propuesta ya fue normalizada antes de persistirse.
create function public.list_yarbi_historical_intelligence_review_batches(
  p_owner_account_id uuid,
  p_limit integer default 20
)
returns table(
  batch_id uuid,
  contact_id bigint,
  status text,
  segment_index integer,
  segment_count integer,
  occurred_from bigint,
  occurred_to bigint,
  proposal jsonb,
  completed_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_owner_account_id is null or p_limit not between 1 and 50 then
    raise exception 'historical_batch_review_list_invalid' using errcode = '22023';
  end if;
  return query
  select batch.id, batch.contact_id, batch.status, batch.segment_index,
    batch.segment_count, batch.occurred_from, batch.occurred_to, batch.proposal,
    batch.completed_at
  from public.yarbi_historical_intelligence_batches as batch
  where batch.owner_account_id = p_owner_account_id
    and batch.status = 'awaiting_owner_review'
  order by batch.completed_at asc nulls last, batch.id asc
  limit p_limit;
end;
$$;

create function public.review_yarbi_historical_intelligence_batch(
  p_owner_account_id uuid,
  p_batch_id uuid,
  p_decision text
)
returns table(batch_id uuid, contact_id bigint, status text, proposal jsonb)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.yarbi_historical_intelligence_batches%rowtype;
begin
  if p_owner_account_id is null or p_batch_id is null
    or p_decision not in ('approved', 'rejected') then
    raise exception 'historical_batch_review_invalid' using errcode = '22023';
  end if;
  select * into v_row
  from public.yarbi_historical_intelligence_batches
  where id = p_batch_id and owner_account_id = p_owner_account_id
  for update;
  if not found then
    raise exception 'historical_batch_not_found' using errcode = 'P0002';
  end if;
  -- Un doble clic con la misma decisión es idempotente. Una decisión opuesta
  -- o un estado no revisable se rechaza de forma explícita.
  if v_row.status <> 'awaiting_owner_review' then
    if v_row.status = p_decision then
      return query select v_row.id, v_row.contact_id, v_row.status, v_row.proposal;
      return;
    end if;
    raise exception 'historical_batch_review_conflict' using errcode = '40001';
  end if;
  update public.yarbi_historical_intelligence_batches
  set status = p_decision, updated_at = now()
  where id = v_row.id
  returning * into v_row;
  return query select v_row.id, v_row.contact_id, v_row.status, v_row.proposal;
end;
$$;

-- Fuente de contexto para composición de respuestas. No expone mensajes
-- crudos: solo propuestas que el propietario ya aprobó, siempre filtradas por
-- su identidad canónica y, si corresponde, por el contacto ya resuelto.
create function public.list_yarbi_historical_intelligence_approved_batches(
  p_owner_account_id uuid,
  p_contact_id bigint default null,
  p_limit integer default 100
)
returns table(
  batch_id uuid,
  contact_id bigint,
  status text,
  segment_index integer,
  segment_count integer,
  occurred_from bigint,
  occurred_to bigint,
  proposal jsonb,
  completed_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_owner_account_id is null or p_limit not between 1 and 200
    or (p_contact_id is not null and p_contact_id <= 0) then
    raise exception 'historical_batch_approved_context_invalid' using errcode = '22023';
  end if;
  return query
  select batch.id, batch.contact_id, batch.status, batch.segment_index,
    batch.segment_count, batch.occurred_from, batch.occurred_to, batch.proposal,
    batch.completed_at
  from public.yarbi_historical_intelligence_batches as batch
  where batch.owner_account_id = p_owner_account_id
    and batch.status = 'approved'
    and (p_contact_id is null or batch.contact_id = p_contact_id)
  order by batch.completed_at desc nulls last, batch.id asc
  limit p_limit;
end;
$$;

revoke all on function public.enqueue_yarbi_historical_intelligence_batch(uuid,bigint,text,jsonb,jsonb,integer,integer,bigint,bigint), public.claim_yarbi_historical_intelligence_batch(uuid), public.complete_yarbi_historical_intelligence_batch(uuid,uuid,integer,jsonb), public.fail_yarbi_historical_intelligence_batch(uuid,uuid,integer,text), public.list_yarbi_historical_intelligence_review_batches(uuid,integer), public.review_yarbi_historical_intelligence_batch(uuid,uuid,text), public.list_yarbi_historical_intelligence_approved_batches(uuid,bigint,integer) from public, anon, authenticated;
grant execute on function public.enqueue_yarbi_historical_intelligence_batch(uuid,bigint,text,jsonb,jsonb,integer,integer,bigint,bigint), public.claim_yarbi_historical_intelligence_batch(uuid), public.complete_yarbi_historical_intelligence_batch(uuid,uuid,integer,jsonb), public.fail_yarbi_historical_intelligence_batch(uuid,uuid,integer,text), public.list_yarbi_historical_intelligence_review_batches(uuid,integer), public.review_yarbi_historical_intelligence_batch(uuid,uuid,text), public.list_yarbi_historical_intelligence_approved_batches(uuid,bigint,integer) to service_role;

commit;
