# Corte e rollback: saldos consolidados

## 1) Pré-requisitos
- Aplicar no Supabase o arquivo `sql_migration_saldos_consolidados.sql`.
- Publicar o frontend com esta atualização.

## 2) Janela de corte (5-15 min)
1. Avisar usuários para não lançar movimentações durante a janela.
2. No Supabase SQL Editor, executar:
   - `select public.rpc_rebuild_saldos_from_movimentacoes();`
   - `select * from public.rpc_resumo_conciliacao_saldos();`
3. Confirmar que `divergencias = 0` (ou divergência conhecida e justificada).
4. Reabrir uso do sistema.

## 3) Validação pós-corte
- Comparar dashboard por CC e por técnico com o dia anterior.
- Testar cenários:
  - `saida_tecnico`
  - `devolucao_tecnico`
  - triangulação aprovada
  - ajuste positivo/negativo
- Validar que o histórico continua registrando em `movimentacoes`.

## 4) Plano de rollback
Se houver falha na estrutura nova:
1. O frontend entra automaticamente em fallback por histórico quando não encontra RPC/tabelas.
2. Para forçar rollback operacional imediato:
   - remover/bloquear acesso à RPC `rpc_aplicar_movimentacoes_lote` (opcional), ou
   - reverter deploy frontend para a versão anterior.
3. Nenhum lançamento é perdido, pois `movimentacoes` continua sendo gravada.

## 5) Rotina de saúde recomendada
- Executar diariamente:
  - `select * from public.rpc_resumo_conciliacao_saldos();`
- Se houver divergências:
  - analisar `select * from public.vw_conciliacao_saldos where abs(diferenca) > 0.0001;`
  - rodar `select public.rpc_rebuild_saldos_from_movimentacoes();` se necessário.
