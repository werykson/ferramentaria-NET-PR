-- Triangulações persistidas no Supabase (substitui apenas localStorage após o app atualizado).
-- Rode no SQL Editor após atualizar o front-end.

create table if not exists public.triangulacoes (
  id text primary key,
  cc_origem text not null,
  cc_destino text not null,
  item_id bigint not null,
  quantidade numeric not null default 0,
  observacao text,
  solicitado_por text,
  solicitado_nome text,
  status text not null default 'Pendente',
  aprovado_por text,
  aprovado_nome text,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_triangulacoes_created_at on public.triangulacoes (created_at desc);
create index if not exists idx_triangulacoes_status on public.triangulacoes (status);

alter table public.triangulacoes disable row level security;
