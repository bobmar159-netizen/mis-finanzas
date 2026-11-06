-- F3K correctivo v2: resuelve la última ambigüedad PL/pgSQL del nombre de
-- salida decision_id dentro de ON CONFLICT. Solo reemplaza una cláusula exacta
-- del cuerpo F3K ya instalado; aborta si el contrato no coincide.
begin;

do $$
declare function_definition text;
begin
  select pg_get_functiondef(to_regprocedure('public.apply_yarbi_owner_action(bigint,integer,text,timestamptz,timestamptz)')) into function_definition;
  if function_definition is null then
    raise exception 'F3K fix v2: RPC base no existe';
  end if;
  if function_definition ~* 'on conflict on constraint yarbi_authorized_orders_decision_id_key do nothing;' then
    raise exception 'F3K fix v2: el parche ya está aplicado; no se sustituye silenciosamente';
  end if;
  if function_definition !~* 'on conflict \(decision_id\) do nothing;' then
    raise exception 'F3K fix v2: no se encontró la cláusula esperada; se aborta';
  end if;
  execute regexp_replace(
    function_definition,
    'on conflict \(decision_id\) do nothing;',
    'on conflict on constraint yarbi_authorized_orders_decision_id_key do nothing;',
    'i'
  );
end
$$;

revoke all on function public.apply_yarbi_owner_action(bigint,integer,text,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.apply_yarbi_owner_action(bigint,integer,text,timestamptz,timestamptz) to service_role;
commit;
