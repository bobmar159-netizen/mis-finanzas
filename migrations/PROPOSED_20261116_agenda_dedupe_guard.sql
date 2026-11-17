-- Yarbi Agenda idempotency guard.
-- PROPOSAL ONLY: do not execute until the exact isolated Preview project/ref is verified.
-- The preflight aborts without deleting or rewriting any existing agenda row.
begin;

do $$
begin
  if to_regclass('public.agenda_events') is null then
    raise exception 'agenda_events table is unavailable; no changes applied';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'agenda_events' and column_name = 'source'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'agenda_events' and column_name = 'dedupe_key'
  ) then
    raise exception 'agenda_events source/dedupe_key contract not present; no changes applied';
  end if;

  if exists (
    select 1
    from public.agenda_events
    where source = 'yarbi_form' and dedupe_key is not null
    group by dedupe_key
    having count(*) > 1
  ) then
    raise exception 'duplicate Yarbi agenda keys exist; reconcile manually before applying guard';
  end if;
end
$$;

create unique index if not exists agenda_events_yarbi_dedupe_key_uq
  on public.agenda_events (dedupe_key)
  where source = 'yarbi_form' and dedupe_key is not null;

commit;
