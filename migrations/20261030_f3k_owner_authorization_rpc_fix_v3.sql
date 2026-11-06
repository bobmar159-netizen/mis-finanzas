-- F3K correctivo v3: owner_decision conserva el verbo de entrada "authorize",
-- no el estado derivado "authorized". Corrige únicamente esa comparación.
begin;

do $$
declare function_definition text;
begin
  select pg_get_functiondef(to_regprocedure('public.apply_yarbi_owner_action(bigint,integer,text,timestamptz,timestamptz)')) into function_definition;
  if function_definition is null then raise exception 'F3K fix v3: RPC base no existe'; end if;
  if function_definition ~* 'decision_row\.owner_decision = ''authorize''' then
    raise exception 'F3K fix v3: el parche ya está aplicado; no se sustituye silenciosamente';
  end if;
  if function_definition !~* 'decision_row\.owner_decision = ''authorized''' then
    raise exception 'F3K fix v3: no se encontró la comparación esperada; se aborta';
  end if;
  execute regexp_replace(
    function_definition,
    'decision_row\.owner_decision = ''authorized''',
    'decision_row.owner_decision = ''authorize''',
    'i'
  );
end
$$;

revoke all on function public.apply_yarbi_owner_action(bigint,integer,text,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.apply_yarbi_owner_action(bigint,integer,text,timestamptz,timestamptz) to service_role;
commit;
