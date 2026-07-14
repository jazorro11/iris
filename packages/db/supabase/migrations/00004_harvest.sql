create table if not exists harvest_conversations (
  id uuid primary key default gen_random_uuid(),
  persona_key text not null,
  estado text not null default 'activa' check (estado in ('activa','terminada','detenida')),
  turno_actual int not null default 0,
  motivo_fin text,
  owner_chat_id bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- A lo más una conversación activa a la vez (concurrencia = 1).
create unique index if not exists harvest_una_activa
  on harvest_conversations ((estado)) where estado = 'activa';

create table if not exists harvest_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references harvest_conversations(id) on delete cascade,
  rol text not null check (rol in ('comprador','dueño')),
  texto text not null,
  turno int not null,
  created_at timestamptz not null default now()
);

create table if not exists harvest_dataset (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references harvest_conversations(id) on delete cascade,
  persona_key text not null,
  turno int not null,
  mensaje_comprador text not null,
  respuesta_dueno text not null,
  contexto_previo text not null default '',
  veta text not null check (veta in ('precio','objecion','producto','tono','otro')),
  notas_extraccion text not null default '',
  langfuse_dataset_item_id text,
  created_at timestamptz not null default now()
);

-- Idempotencia de webhooks: un update_id de Telegram se procesa una sola vez.
create table if not exists harvest_updates_vistos (
  update_id bigint primary key,
  created_at timestamptz not null default now()
);
