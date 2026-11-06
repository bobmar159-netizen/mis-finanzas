-- F3K correctivo aislado: elimina ambiguedad PL/pgSQL entre el parámetro de
-- salida decision_id y la columna de las órdenes. No altera tablas ni ACL.
begin;

do $$
begin
  if to_regprocedure('public.apply_yarbi_owner_action(bigint,integer,text,timestamptz,timestamptz)') is null then
    raise exception 'F3K fix: RPC base no existe';
  end if;
end
$$;

create or replace function public.apply_yarbi_owner_action(
  p_inbox_id bigint,
  p_item_index integer,
  p_decision text,
  p_postpone_until timestamptz,
  p_now timestamptz
) returns table(outcome text, decision_id bigint, owner_status text, execution_state text)
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  inbox_row public.yarbi_owner_inbox%rowtype;
  decision_row public.yarbi_owner_action_decisions%rowtype;
  v_decision_id bigint;
  item jsonb;
  action_name text;
  type_name text;
  contact_value bigint;
  requires_auth boolean;
  has_existing_decision boolean := false;
  resolved_location boolean;
  allowed_customer_actions text[] := array['ask_for_location','ask_for_service','ask_for_district','ask_for_schedule','follow_up_customer','confirm_visit'];
  allowed_order_actions text[] := array['ask_for_location','ask_for_service','ask_for_district','ask_for_schedule','follow_up_customer','confirm_visit','prepare_quote'];
  op_ref text;
begin
  if p_inbox_id is null or p_item_index is null or p_item_index < 0
     or p_decision not in ('authorize','postpone','dismiss') or p_now is null then
    raise exception 'owner_action_contract_invalid' using errcode = '22023';
  end if;
  if p_decision = 'postpone' and (p_postpone_until is null or p_postpone_until <= p_now) then
    raise exception 'owner_action_postpone_until_invalid' using errcode = '22023';
  end if;
  if p_decision <> 'postpone' and p_postpone_until is not null then
    raise exception 'owner_action_postpone_until_unexpected' using errcode = '22023';
  end if;

  select * into inbox_row from public.yarbi_owner_inbox where id=p_inbox_id for update;
  if not found then raise exception 'owner_action_inbox_not_found' using errcode = 'P0002'; end if;
  item := inbox_row.payload -> 'items' -> p_item_index;
  if item is null or jsonb_typeof(item) <> 'object' then raise exception 'owner_action_item_not_found' using errcode = 'P0002'; end if;
  action_name := nullif(btrim(item->>'action'), '');
  type_name := nullif(btrim(item->>'type'), '');
  contact_value := nullif(item->>'contact_id', '')::bigint;
  requires_auth := coalesce((item->>'requires_authorization')::boolean, false);
  if action_name is null or type_name not in ('customer_action','internal_action','owner_review') then
    raise exception 'owner_action_item_invalid' using errcode = '22023';
  end if;
  op_ref := 'owner-action:' || p_inbox_id::text || ':' || p_item_index::text;

  select * into decision_row from public.yarbi_owner_action_decisions
   where inbox_id=p_inbox_id and item_index=p_item_index for update;
  has_existing_decision := found;
  if has_existing_decision and decision_row.owner_decision = 'authorized' then
    outcome := 'already_authorized'; decision_id := decision_row.id; owner_status := 'authorized'; execution_state := 'authorized_pending_execution'; return next; return;
  end if;
  if has_existing_decision and decision_row.owner_decision = 'dismiss' then
    outcome := 'already_dismissed'; decision_id := decision_row.id; owner_status := 'dismissed'; execution_state := null; return next; return;
  end if;

  if p_decision = 'authorize' then
    if type_name = 'owner_review' or action_name = 'review_context_conflict' then
      outcome := 'owner_review'; decision_id := case when has_existing_decision then decision_row.id else null end; owner_status := inbox_row.owner_decision_status; execution_state := null; return next; return;
    end if;
    if action_name = any(allowed_customer_actions) and requires_auth is distinct from true then
      raise exception 'owner_action_authorization_contract_invalid' using errcode = '22023';
    end if;
    if action_name <> all(allowed_order_actions) then raise exception 'owner_action_not_supported' using errcode = '22023'; end if;
    if action_name = 'ask_for_location' and contact_value is not null then
      select exists(select 1 from public.yarbi_contact_operational_memory om
        where om.contact_id=contact_value and om.memory_type='location' and om.state='active') into resolved_location;
      if resolved_location then
        if has_existing_decision then
          update public.yarbi_owner_action_decisions set owner_decision='authorize', outcome='stale_recommendation', decision_version=decision_version+1, decision_at=p_now, updated_at=p_now, operation_ref=op_ref where id=decision_row.id returning id into v_decision_id;
        else
          insert into public.yarbi_owner_action_decisions(inbox_id,item_index,notification_fingerprint,contact_id,recommended_action,recommendation_type,requires_authorization,owner_decision,decision_at,outcome,operation_ref)
          values(p_inbox_id,p_item_index,inbox_row.fingerprint,contact_value,action_name,type_name,requires_auth,'authorize',p_now,'stale_recommendation',op_ref) returning id into v_decision_id;
        end if;
        outcome := 'stale_recommendation'; decision_id := v_decision_id; owner_status := inbox_row.owner_decision_status; execution_state := null; return next; return;
      end if;
    end if;
  end if;

  if has_existing_decision then
    update public.yarbi_owner_action_decisions
       set owner_decision=p_decision, postpone_until=case when p_decision='postpone' then p_postpone_until else null end,
           decision_version=decision_version+1, decision_at=p_now,
           outcome=case when p_decision='authorize' then 'authorized' when p_decision='postpone' then 'postponed' else 'dismissed' end,
           operation_ref=op_ref, updated_at=p_now
     where id=decision_row.id returning id into v_decision_id;
  else
    insert into public.yarbi_owner_action_decisions(inbox_id,item_index,notification_fingerprint,contact_id,recommended_action,recommendation_type,requires_authorization,owner_decision,postpone_until,decision_at,outcome,operation_ref)
    values(p_inbox_id,p_item_index,inbox_row.fingerprint,contact_value,action_name,type_name,requires_auth,p_decision,
      case when p_decision='postpone' then p_postpone_until else null end,p_now,
      case when p_decision='authorize' then 'authorized' when p_decision='postpone' then 'postponed' else 'dismissed' end,op_ref)
    returning id into v_decision_id;
  end if;

  if p_decision='authorize' then
    insert into public.yarbi_authorized_orders(decision_id,inbox_id,contact_id,authorized_action)
    values(v_decision_id,p_inbox_id,contact_value,action_name) on conflict (decision_id) do nothing;
    update public.yarbi_owner_inbox set owner_decision_status='authorized', postpone_until=null, decision_updated_at=p_now where id=p_inbox_id;
    outcome := 'authorized'; owner_status := 'authorized'; execution_state := 'authorized_pending_execution';
  elsif p_decision='postpone' then
    update public.yarbi_owner_inbox set owner_decision_status='postponed', postpone_until=p_postpone_until, decision_updated_at=p_now where id=p_inbox_id;
    outcome := 'postponed'; owner_status := 'postponed'; execution_state := null;
  else
    update public.yarbi_owner_inbox set owner_decision_status='dismissed', postpone_until=null, dismissed_at=coalesce(dismissed_at,p_now), decision_updated_at=p_now where id=p_inbox_id;
    outcome := 'dismissed'; owner_status := 'dismissed'; execution_state := null;
  end if;
  decision_id := v_decision_id;
  return next;
end;
$$;

revoke all on function public.apply_yarbi_owner_action(bigint,integer,text,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.apply_yarbi_owner_action(bigint,integer,text,timestamptz,timestamptz) to service_role;
commit;
