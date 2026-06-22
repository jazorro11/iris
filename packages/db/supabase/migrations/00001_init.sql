-- Iris — esquema inicial

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null unique,
  telegram_username text,
  estado text not null default 'incompleto',
  campos_faltantes text[] not null default '{}',
  solicitud jsonb not null default '{}'::jsonb,
  proposito text,
  tipo_pieza text,
  origen_pais text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lead_messages (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null,
  rol text not null check (rol in ('comprador', 'agente')),
  texto text not null,
  created_at timestamptz not null default now()
);
create index if not exists lead_messages_user_idx
  on public.lead_messages (telegram_user_id, created_at);

-- RLS habilitado: el webhook usa service role (bypassa RLS). Sin políticas públicas.
alter table public.leads enable row level security;
alter table public.lead_messages enable row level security;
