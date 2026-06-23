-- Iris — inventario de esmeraldas

create table if not exists public.inventario (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  forma text not null,
  peso_ct numeric not null,
  precio_usd_ct numeric not null,
  cantidad_piedras int not null default 1,
  media_url text,
  disponible boolean not null default true,
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inventario_match_idx
  on public.inventario (disponible, forma);

-- RLS habilitado: el webhook usa service role (bypassa RLS). Sin políticas públicas.
-- El Table Editor de Supabase (consola) también opera con privilegios de servicio.
alter table public.inventario enable row level security;
