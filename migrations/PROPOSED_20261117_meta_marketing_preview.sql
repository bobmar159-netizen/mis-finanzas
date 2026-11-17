-- Preparación aditiva para Meta Marketing API. Aplicar únicamente después de
-- confirmar proyecto Supabase Preview y autorizar explícitamente la migración.
-- No contiene datos ni tokens; las credenciales OAuth se guardarán cifradas.
begin;

create table if not exists public.yarbi_meta_owner_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  weekly_budget_amount numeric(12,2) not null default 200 check (weekly_budget_amount >= 0 and weekly_budget_amount <= 1000000),
  weekly_budget_currency text not null default 'PEN' check (weekly_budget_currency = 'PEN'),
  updated_at timestamptz not null default now()
);
alter table public.yarbi_meta_owner_settings enable row level security;
revoke all on public.yarbi_meta_owner_settings from anon, authenticated;
grant all on public.yarbi_meta_owner_settings to service_role;

create table if not exists public.yarbi_meta_oauth_states (
  state_hash text primary key check (state_hash ~ '^[a-f0-9]{64}$'),
  owner_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.yarbi_meta_oauth_states enable row level security;
revoke all on public.yarbi_meta_oauth_states from anon, authenticated;
grant all on public.yarbi_meta_oauth_states to service_role;

create table if not exists public.yarbi_meta_connections (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  token_ciphertext jsonb not null check (jsonb_typeof(token_ciphertext) = 'object'),
  token_expires_at timestamptz,
  scopes text[] not null default '{}',
  selected_ad_account_id text,
  last_insights_sync_at timestamptz,
  last_insights_sync_pages integer,
  last_insights_sync_pages_capped boolean not null default false,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz
);
alter table public.yarbi_meta_connections enable row level security;
revoke all on public.yarbi_meta_connections from anon, authenticated;
grant all on public.yarbi_meta_connections to service_role;

create table if not exists public.yarbi_meta_ad_accounts (
  owner_id uuid not null references auth.users(id) on delete cascade,
  ad_account_id text not null,
  name text not null,
  currency text,
  timezone_name text,
  account_status integer,
  synced_at timestamptz not null default now(),
  primary key (owner_id, ad_account_id)
);
alter table public.yarbi_meta_ad_accounts enable row level security;
revoke all on public.yarbi_meta_ad_accounts from anon, authenticated;
grant all on public.yarbi_meta_ad_accounts to service_role;

create table if not exists public.yarbi_meta_insights_daily (
  owner_id uuid not null references auth.users(id) on delete cascade,
  ad_account_id text not null,
  date_start date not null,
  date_stop date not null,
  campaign_id text,
  campaign_name text,
  adset_id text,
  adset_name text,
  ad_id text not null,
  ad_name text,
  spend numeric(14,2) not null default 0 check (spend >= 0),
  impressions bigint not null default 0 check (impressions >= 0),
  clicks bigint not null default 0 check (clicks >= 0),
  actions jsonb not null default '[]'::jsonb check (jsonb_typeof(actions) = 'array'),
  cost_per_action_type jsonb not null default '[]'::jsonb check (jsonb_typeof(cost_per_action_type) = 'array'),
  synced_at timestamptz not null default now(),
  primary key (owner_id, ad_account_id, date_start, ad_id)
);
create index if not exists yarbi_meta_insights_owner_date_idx
  on public.yarbi_meta_insights_daily (owner_id, date_start desc, ad_account_id);
alter table public.yarbi_meta_insights_daily enable row level security;
revoke all on public.yarbi_meta_insights_daily from anon, authenticated;
grant all on public.yarbi_meta_insights_daily to service_role;

-- Outbox de preparación. No se crea ningún envío automático a Conversions API.
create table if not exists public.yarbi_meta_conversion_outbox (
  event_id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  event_name text not null check (event_name in ('Lead', 'Purchase')),
  source_record_type text not null check (source_record_type in ('crm_opportunity', 'confirmed_payment')),
  source_record_id text not null,
  event_time timestamptz not null,
  ctwa_clid text,
  consent_status text not null check (consent_status in ('granted', 'not_required', 'unknown', 'denied')),
  payload_ciphertext jsonb,
  status text not null default 'prepared' check (status in ('prepared', 'approved', 'sent', 'failed', 'cancelled')),
  created_at timestamptz not null default now(),
  unique (owner_id, source_record_type, source_record_id, event_name)
);
alter table public.yarbi_meta_conversion_outbox enable row level security;
revoke all on public.yarbi_meta_conversion_outbox from anon, authenticated;
grant all on public.yarbi_meta_conversion_outbox to service_role;

commit;
