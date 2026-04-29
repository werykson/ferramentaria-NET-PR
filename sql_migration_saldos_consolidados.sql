-- Migração: saldos consolidados como fonte principal.
-- Objetivo: manter movimentacoes como auditoria e usar saldos_* para cálculo operacional.

create table if not exists public.saldos_estoque_item_cc (
  item_id bigint not null,
  cc text not null,
  quantidade numeric(14,3) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (item_id, cc)
);

create table if not exists public.saldos_tecnico_item_cc (
  tecnico_id bigint not null,
  item_id bigint not null,
  cc text not null,
  quantidade numeric(14,3) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (tecnico_id, item_id, cc)
);

create index if not exists idx_saldos_estoque_cc_item
  on public.saldos_estoque_item_cc (cc, item_id);

create index if not exists idx_saldos_tecnico_cc_item
  on public.saldos_tecnico_item_cc (cc, item_id);

create or replace function public.rpc_aplicar_movimentacoes_lote(
  p_linhas jsonb,
  p_movimentado_por text default null,
  p_movimentado_nome text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  linha jsonb;
  v_tipo text;
  v_item_id bigint;
  v_tecnico_id bigint;
  v_cc text;
  v_quantidade numeric(14,3);
  v_observacao text;
  v_delta_estoque numeric(14,3);
  v_delta_tecnico numeric(14,3);
  v_qtd_estoque numeric(14,3);
  v_qtd_tecnico numeric(14,3);
  v_processadas integer := 0;
begin
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' then
    raise exception 'Parâmetro p_linhas inválido: esperado array JSON.';
  end if;

  for linha in select value from jsonb_array_elements(p_linhas) loop
    v_tipo := nullif(trim(linha->>'tipo'), '');
    v_item_id := nullif(linha->>'item_id', '')::bigint;
    v_tecnico_id := nullif(linha->>'tecnico_id', '')::bigint;
    v_cc := nullif(trim(linha->>'cc'), '');
    v_quantidade := coalesce(nullif(linha->>'quantidade', '')::numeric, 0);
    v_observacao := nullif(trim(linha->>'observacao'), '');

    if v_tipo is null then
      raise exception 'Linha inválida: tipo obrigatório.';
    end if;
    if v_item_id is null or v_item_id <= 0 then
      raise exception 'Linha inválida: item_id obrigatório.';
    end if;
    if v_cc is null then
      raise exception 'Linha inválida: cc obrigatório.';
    end if;
    if v_quantidade <= 0 then
      raise exception 'Linha inválida: quantidade deve ser maior que zero.';
    end if;

    insert into public.movimentacoes (
      tipo,
      item_id,
      tecnico_id,
      cc,
      quantidade,
      observacao,
      movimentado_por,
      movimentado_nome
    )
    values (
      v_tipo,
      v_item_id,
      v_tecnico_id,
      v_cc,
      v_quantidade,
      v_observacao,
      p_movimentado_por,
      p_movimentado_nome
    );

    v_delta_estoque := 0;
    if v_tipo in ('entrada', 'devolucao_tecnico', 'ajuste_positivo', 'triangulacao_entrada') then
      v_delta_estoque := v_quantidade;
    elsif v_tipo in ('saida_tecnico', 'ajuste_negativo', 'substituicao_perda', 'substituicao_quebra', 'substituicao_desgaste', 'triangulacao_saida') then
      v_delta_estoque := -v_quantidade;
    end if;

    if v_delta_estoque <> 0 then
      insert into public.saldos_estoque_item_cc (item_id, cc, quantidade, updated_at)
      values (v_item_id, v_cc, v_delta_estoque, now())
      on conflict (item_id, cc)
      do update
        set quantidade = public.saldos_estoque_item_cc.quantidade + excluded.quantidade,
            updated_at = now()
      returning quantidade into v_qtd_estoque;

      if coalesce(v_qtd_estoque, 0) < 0 then
        raise exception 'Saldo de estoque negativo para item_id=% cc=%', v_item_id, v_cc;
      end if;
    end if;

    v_delta_tecnico := 0;
    if v_tipo = 'saida_tecnico' then
      v_delta_tecnico := v_quantidade;
    elsif v_tipo = 'devolucao_tecnico' then
      v_delta_tecnico := -v_quantidade;
    end if;

    if v_delta_tecnico <> 0 then
      if v_tecnico_id is null or v_tecnico_id <= 0 then
        raise exception 'Linha inválida: tecnico_id obrigatório para tipo=%', v_tipo;
      end if;

      insert into public.saldos_tecnico_item_cc (tecnico_id, item_id, cc, quantidade, updated_at)
      values (v_tecnico_id, v_item_id, v_cc, v_delta_tecnico, now())
      on conflict (tecnico_id, item_id, cc)
      do update
        set quantidade = public.saldos_tecnico_item_cc.quantidade + excluded.quantidade,
            updated_at = now()
      returning quantidade into v_qtd_tecnico;

      if coalesce(v_qtd_tecnico, 0) < 0 then
        raise exception 'Saldo técnico negativo para tecnico_id=% item_id=% cc=%', v_tecnico_id, v_item_id, v_cc;
      end if;
    end if;

    v_processadas := v_processadas + 1;
  end loop;

  return jsonb_build_object('ok', true, 'processadas', v_processadas);
end;
$$;

create or replace function public.rpc_rebuild_saldos_from_movimentacoes()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estoque integer := 0;
  v_tecnico integer := 0;
begin
  truncate table public.saldos_estoque_item_cc;
  truncate table public.saldos_tecnico_item_cc;

  insert into public.saldos_estoque_item_cc (item_id, cc, quantidade, updated_at)
  select
    m.item_id,
    m.cc,
    sum(
      case
        when m.tipo in ('entrada', 'devolucao_tecnico', 'ajuste_positivo', 'triangulacao_entrada') then coalesce(m.quantidade, 0)
        when m.tipo in ('saida_tecnico', 'ajuste_negativo', 'substituicao_perda', 'substituicao_quebra', 'substituicao_desgaste', 'triangulacao_saida') then -coalesce(m.quantidade, 0)
        else 0
      end
    ) as quantidade,
    now() as updated_at
  from public.movimentacoes m
  where m.item_id is not null
    and nullif(trim(coalesce(m.cc, '')), '') is not null
  group by m.item_id, m.cc
  having sum(
    case
      when m.tipo in ('entrada', 'devolucao_tecnico', 'ajuste_positivo', 'triangulacao_entrada') then coalesce(m.quantidade, 0)
      when m.tipo in ('saida_tecnico', 'ajuste_negativo', 'substituicao_perda', 'substituicao_quebra', 'substituicao_desgaste', 'triangulacao_saida') then -coalesce(m.quantidade, 0)
      else 0
    end
  ) <> 0;

  get diagnostics v_estoque = row_count;

  insert into public.saldos_tecnico_item_cc (tecnico_id, item_id, cc, quantidade, updated_at)
  select
    m.tecnico_id,
    m.item_id,
    m.cc,
    sum(
      case
        when m.tipo = 'saida_tecnico' then coalesce(m.quantidade, 0)
        when m.tipo = 'devolucao_tecnico' then -coalesce(m.quantidade, 0)
        else 0
      end
    ) as quantidade,
    now() as updated_at
  from public.movimentacoes m
  where m.tecnico_id is not null
    and m.item_id is not null
    and nullif(trim(coalesce(m.cc, '')), '') is not null
  group by m.tecnico_id, m.item_id, m.cc
  having sum(
    case
      when m.tipo = 'saida_tecnico' then coalesce(m.quantidade, 0)
      when m.tipo = 'devolucao_tecnico' then -coalesce(m.quantidade, 0)
      else 0
    end
  ) <> 0;

  get diagnostics v_tecnico = row_count;

  return jsonb_build_object(
    'ok', true,
    'saldos_estoque_linhas', v_estoque,
    'saldos_tecnico_linhas', v_tecnico
  );
end;
$$;

create or replace view public.vw_conciliacao_saldos as
with saldo_calc_estoque as (
  select
    m.item_id,
    m.cc,
    sum(
      case
        when m.tipo in ('entrada', 'devolucao_tecnico', 'ajuste_positivo', 'triangulacao_entrada') then coalesce(m.quantidade, 0)
        when m.tipo in ('saida_tecnico', 'ajuste_negativo', 'substituicao_perda', 'substituicao_quebra', 'substituicao_desgaste', 'triangulacao_saida') then -coalesce(m.quantidade, 0)
        else 0
      end
    ) as calculado
  from public.movimentacoes m
  group by m.item_id, m.cc
),
saldo_calc_tecnico as (
  select
    m.tecnico_id,
    m.item_id,
    m.cc,
    sum(
      case
        when m.tipo = 'saida_tecnico' then coalesce(m.quantidade, 0)
        when m.tipo = 'devolucao_tecnico' then -coalesce(m.quantidade, 0)
        else 0
      end
    ) as calculado
  from public.movimentacoes m
  where m.tecnico_id is not null
  group by m.tecnico_id, m.item_id, m.cc
)
select
  'estoque'::text as origem,
  null::bigint as tecnico_id,
  coalesce(sc.item_id, se.item_id) as item_id,
  coalesce(sc.cc, se.cc) as cc,
  coalesce(sc.calculado, 0) as saldo_calculado,
  coalesce(se.quantidade, 0) as saldo_consolidado,
  coalesce(se.quantidade, 0) - coalesce(sc.calculado, 0) as diferenca
from saldo_calc_estoque sc
full outer join public.saldos_estoque_item_cc se
  on se.item_id = sc.item_id and se.cc = sc.cc
union all
select
  'tecnico'::text as origem,
  coalesce(sc.tecnico_id, st.tecnico_id) as tecnico_id,
  coalesce(sc.item_id, st.item_id) as item_id,
  coalesce(sc.cc, st.cc) as cc,
  coalesce(sc.calculado, 0) as saldo_calculado,
  coalesce(st.quantidade, 0) as saldo_consolidado,
  coalesce(st.quantidade, 0) - coalesce(sc.calculado, 0) as diferenca
from saldo_calc_tecnico sc
full outer join public.saldos_tecnico_item_cc st
  on st.tecnico_id = sc.tecnico_id and st.item_id = sc.item_id and st.cc = sc.cc;

create or replace function public.rpc_resumo_conciliacao_saldos()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ok', true,
    'divergencias', count(*) filter (where abs(diferenca) > 0.0001),
    'total_linhas', count(*)
  )
  from public.vw_conciliacao_saldos;
$$;
