-- Migração: kit único → KIT MDU + KIT INST.
-- Rode no SQL Editor do Supabase (projeto já existente com coluna qtd_kit).

alter table public.itens add column if not exists qtd_kit_mdu numeric not null default 0;
alter table public.itens add column if not exists qtd_kit_inst numeric not null default 0;

-- Copia valores antigos para os dois tipos (depois você pode zerar KIT INST. nos itens que são só MDU).
update public.itens
set
  qtd_kit_mdu = coalesce(qtd_kit, 0),
  qtd_kit_inst = coalesce(qtd_kit, 0)
where exists (
  select 1
  from information_schema.columns
  where table_schema = 'public' and table_name = 'itens' and column_name = 'qtd_kit'
);

alter table public.itens drop column if exists qtd_kit;
