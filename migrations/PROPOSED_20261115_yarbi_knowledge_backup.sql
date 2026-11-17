-- Propuesta local para respaldo autenticado de la biblioteca BKE.
-- No aplicar automáticamente. El original del documento permanece en el teléfono;
-- Supabase conserva únicamente metadatos aprobados, texto extraído y vectores.
begin;

create table if not exists public.yarbi_knowledge_assets (
  owner_account_id uuid not null references auth.users(id) on delete cascade,
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  title text not null check (char_length(title) between 1 and 140),
  mime_type text not null check (char_length(mime_type) between 1 and 120),
  source_kind text not null check (source_kind in ('pdf','text','image','audio','video')),
  source_bytes bigint not null check (source_bytes between 0 and 125829120),
  extraction_version text,
  embedding_version text,
  section_count integer not null check (section_count between 1 and 8000),
  approval_state text not null default 'approved' check (approval_state = 'approved'),
  learning_enabled boolean not null default true,
  backup_complete boolean not null default false,
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_account_id, source_sha256)
);

create table if not exists public.yarbi_knowledge_sections (
  owner_account_id uuid not null,
  source_sha256 text not null,
  section_index integer not null check (section_index between 0 and 7999),
  source_section_id text not null check (char_length(source_section_id) between 1 and 160),
  section_label text not null check (char_length(section_label) between 1 and 240),
  section_text text not null check (char_length(section_text) between 1 and 2200),
  embedding_base64 text,
  embedding_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_account_id, source_sha256, section_index),
  foreign key (owner_account_id, source_sha256)
    references public.yarbi_knowledge_assets(owner_account_id, source_sha256)
    on delete cascade,
  -- El handler guarda vectores cuantizados de 768 bytes: su base64 canónico
  -- ocupa exactamente 1024 caracteres. No aceptar valores truncados.
  check (embedding_base64 is null or (char_length(embedding_base64) = 1024 and embedding_base64 ~ '^[A-Za-z0-9+/]{1024}$')),
  check (embedding_base64 is null or embedding_version is not null)
);

-- Gemini File Search: un store independiente por archivo y propietario permite
-- excluir fuentes pausadas y borrar el índice remoto de una fuente sin tocar
-- las demás. store_name nunca se entrega al navegador.
create table if not exists public.yarbi_knowledge_file_search_stores (
  owner_account_id uuid not null references auth.users(id) on delete cascade,
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  title text not null check (char_length(title) between 1 and 140),
  source_bytes bigint not null check (source_bytes between 1 and 50000000),
  store_name text not null unique check (store_name ~ '^fileSearchStores/[A-Za-z0-9_-]{1,160}$'),
  index_state text not null default 'uploading' check (index_state in ('uploading','ready','failed')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_account_id, source_sha256),
  foreign key (owner_account_id, source_sha256)
    references public.yarbi_knowledge_assets(owner_account_id, source_sha256)
    on delete cascade
);

create index if not exists yarbi_knowledge_assets_owner_updated_idx
  on public.yarbi_knowledge_assets(owner_account_id, updated_at desc);
create index if not exists yarbi_knowledge_file_search_ready_owner_updated_idx
  on public.yarbi_knowledge_file_search_stores(owner_account_id, updated_at desc)
  where active = true and index_state = 'ready';

-- CREATE TABLE IF NOT EXISTS no repara ni valida tablas preexistentes. Fallar
-- de forma explícita evita desplegar un handler sobre un esquema incompatible.
do $$
declare
  missing_columns text;
  missing_keys text;
begin
  select string_agg(required.table_name || '.' || required.column_name, ', ' order by required.table_name, required.column_name)
    into missing_columns
  from (values
    ('yarbi_knowledge_assets','owner_account_id'), ('yarbi_knowledge_assets','source_sha256'),
    ('yarbi_knowledge_assets','title'), ('yarbi_knowledge_assets','mime_type'),
    ('yarbi_knowledge_assets','source_kind'), ('yarbi_knowledge_assets','source_bytes'),
    ('yarbi_knowledge_assets','extraction_version'), ('yarbi_knowledge_assets','embedding_version'),
    ('yarbi_knowledge_assets','section_count'), ('yarbi_knowledge_assets','approval_state'),
    ('yarbi_knowledge_assets','learning_enabled'), ('yarbi_knowledge_assets','backup_complete'),
    ('yarbi_knowledge_assets','approved_at'), ('yarbi_knowledge_assets','created_at'), ('yarbi_knowledge_assets','updated_at'),
    ('yarbi_knowledge_sections','owner_account_id'), ('yarbi_knowledge_sections','source_sha256'),
    ('yarbi_knowledge_sections','section_index'), ('yarbi_knowledge_sections','source_section_id'),
    ('yarbi_knowledge_sections','section_label'), ('yarbi_knowledge_sections','section_text'),
    ('yarbi_knowledge_sections','embedding_base64'), ('yarbi_knowledge_sections','embedding_version'),
    ('yarbi_knowledge_sections','created_at'), ('yarbi_knowledge_sections','updated_at'),
    ('yarbi_knowledge_file_search_stores','owner_account_id'), ('yarbi_knowledge_file_search_stores','source_sha256'),
    ('yarbi_knowledge_file_search_stores','title'), ('yarbi_knowledge_file_search_stores','source_bytes'),
    ('yarbi_knowledge_file_search_stores','store_name'), ('yarbi_knowledge_file_search_stores','index_state'),
    ('yarbi_knowledge_file_search_stores','active'), ('yarbi_knowledge_file_search_stores','created_at'),
    ('yarbi_knowledge_file_search_stores','updated_at')
  ) as required(table_name, column_name)
  where not exists (
    select 1 from information_schema.columns actual
    where actual.table_schema = 'public'
      and actual.table_name = required.table_name
      and actual.column_name = required.column_name
  );

  if missing_columns is not null then
    raise exception 'yarbi_knowledge_schema_mismatch: missing columns %', missing_columns;
  end if;

  select string_agg(required.table_name || ' ' || required.definition, '; ' order by required.table_name)
    into missing_keys
  from (values
    ('yarbi_knowledge_assets','PRIMARY KEY (owner_account_id, source_sha256)'),
    ('yarbi_knowledge_sections','PRIMARY KEY (owner_account_id, source_sha256, section_index)'),
    ('yarbi_knowledge_file_search_stores','PRIMARY KEY (owner_account_id, source_sha256)'),
    ('yarbi_knowledge_file_search_stores','UNIQUE (store_name)')
  ) as required(table_name, definition)
  where not exists (
    select 1 from pg_constraint actual
    where actual.conrelid = ('public.' || quote_ident(required.table_name))::regclass
      and pg_get_constraintdef(actual.oid) = required.definition
  );

  if missing_keys is not null then
    raise exception 'yarbi_knowledge_schema_mismatch: missing keys %', missing_keys;
  end if;
end;
$$;

alter table public.yarbi_knowledge_assets enable row level security;
alter table public.yarbi_knowledge_sections enable row level security;
alter table public.yarbi_knowledge_file_search_stores enable row level security;
alter table public.yarbi_knowledge_assets force row level security;
alter table public.yarbi_knowledge_sections force row level security;
alter table public.yarbi_knowledge_file_search_stores force row level security;
revoke all on public.yarbi_knowledge_assets, public.yarbi_knowledge_sections, public.yarbi_knowledge_file_search_stores from public, anon, authenticated;
grant all on public.yarbi_knowledge_assets, public.yarbi_knowledge_sections, public.yarbi_knowledge_file_search_stores to service_role;

commit;
