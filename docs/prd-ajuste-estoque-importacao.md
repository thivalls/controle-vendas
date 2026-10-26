# PRD: Ajuste de Estoque via Importação de Planilha (XLSX)

**Status:** Draft
**Author:** (via Claude, a pedido do dono do sistema)
**Date:** 2026-08-14
**Version:** 1.0

---

## 1. Problem statement

Depois de uma contagem física de estoque, a única forma hoje de corrigir divergências entre o estoque do sistema e o estoque real é lançar entrada/saída manualmente, SKU por SKU, pela aba Estoque. O sistema já exporta um XLSX com o estoque atual e uma coluna em branco para anotar o estoque real contado (`GET /api/skus/exportar-estoque`), mas não existe nenhum caminho de volta: os valores contados na planilha não podem ser reimportados, então o dono do sistema teria que digitar manualmente, produto a produto, cada ajuste identificado na contagem. Isso é viável hoje pelo baixo volume de SKUs (uso ainda no início), mas se torna cada vez mais lento e sujeito a erro de digitação conforme o catálogo cresce.

## 2. Goals

- O dono do sistema consegue reconciliar um inventário físico completo (dezenas de SKUs) em uma única operação: preencher a coluna "Estoque real" na planilha exportada, subir o arquivo, conferir visualmente o que vai mudar, e confirmar — sem lançar nenhum ajuste manual SKU por SKU.
- Nenhum ajuste de estoque por inventário gera lançamento indevido em caixa (não é uma compra/venda real).
- Um erro pontual em uma linha da planilha (SKU excluído, valor inválido) não impede o ajuste dos demais SKUs válidos.
- Todo ajuste aplicado fica rastreável no histórico de movimentações de estoque já existente, com motivo claro.

## 3. Non-goals

- **Desfazer/rollback automático de um lote de ajuste**: fora de escopo — se um lote for aplicado errado, a correção é lançar outro ajuste manual (ou uma nova importação) revertendo, igual a qualquer outro movimento de estoque hoje.
- **Editar outros campos do SKU (nome, preço de custo, fornecedor) via essa importação**: fora de escopo — a planilha e o fluxo tratam exclusivamente de quantidade em estoque.
- **Suporte a múltiplos usuários fazendo upload simultâneo/conflitante**: fora de escopo — sistema é projetado para uso solo (autônomos), confirmado na sessão de grill-me.
- **Paginação ou filtro na tabela de prévia**: fora de escopo por ora — volume atual de SKUs é pequeno o suficiente para uma tabela simples sem paginação (mesma lógica do restante do sistema, que ainda não pagina todas as listagens).
- **Casar a linha por código do SKU em vez de ID**: decisão explícita de usar ID (estável, sempre existe); código é opcional e usado só como conferência visual na planilha.

## 4. User stories

1. Como dono do sistema, quero fazer upload da planilha de contagem física e ver uma prévia clara de quais SKUs vão ter o estoque ajustado, antes de qualquer coisa ser gravada, para poder conferir e evitar erro antes de confirmar. — **P0**
   - **Notas:** prévia deve destacar visualmente os SKUs que vão mudar e ser discreta com os que não mudam.
2. Como dono do sistema, quero que células em branco na coluna "Estoque real" sejam tratadas como "não contado" (ignorado), e não como zero, para não zerar acidentalmente o estoque de SKUs que não recontei nessa rodada. — **P0**
3. Como dono do sistema, quero que o ajuste de estoque por inventário nunca gere lançamento no caixa, para não confundir uma correção de contagem com uma compra ou venda real. — **P0**
4. Como dono do sistema, quero que uma linha com SKU excluído ou valor inválido seja ignorada e reportada, sem travar o ajuste dos demais SKUs da planilha, para não perder uma reconciliação inteira por causa de um único problema pontual. — **P0**
5. Como dono do sistema, quero ver, depois de confirmar, uma lista detalhada do que foi de fato ajustado (quantidade antes → depois), para conferir que o resultado bate com o que eu esperava. — **P1**
6. Como dono do sistema, quero que uma planilha com o mesmo ID duplicado seja rejeitada por inteiro antes de qualquer ajuste, para não correr o risco de aplicar um valor errado por ambiguidade. — **P1**

## 5. Functional requirements

### Upload e validação do arquivo

```
FR-01: O sistema deve expor POST /api/skus/importar-estoque, recebendo um arquivo via multipart/form-data (campo `arquivo`).
FR-02: O sistema deve rejeitar (400) arquivos que não sejam uma planilha XLSX válida, sem processar nenhuma linha.
FR-03: O sistema deve rejeitar (413) arquivos maiores que 5MB.
FR-04: O sistema deve identificar as colunas "ID" e "Estoque real" pelo texto do cabeçalho (case-insensitive), não pela posição fixa da coluna — deve continuar funcionando mesmo se o usuário reordenar colunas no Excel.
FR-05: Se a planilha não tiver as colunas obrigatórias "ID" e "Estoque real", o sistema deve rejeitar (400) informando quais colunas estão faltando, sem processar nenhuma linha.
FR-06: Se a planilha tiver duas ou mais linhas com o mesmo valor de "ID", o sistema deve rejeitar o arquivo inteiro (400), informando quais IDs estão duplicados, sem gerar nenhuma prévia.
```

### Prévia (cálculo de diferença — somente leitura)

```
FR-07: Para cada linha válida, o sistema deve buscar o SKU pelo ID e calcular a diferença entre "Estoque real" (da planilha) e o estoque atual do SKU no banco.
FR-08: Linha com "Estoque real" em branco deve ser classificada como `ignorado_nao_contado` — nenhum ajuste calculado.
FR-09: Linha cujo ID não corresponde a nenhum SKU existente deve ser classificada como `ignorado_sku_nao_encontrado`.
FR-10: Linha com valor não numérico ou negativo em "Estoque real" deve ser classificada como `ignorado_valor_invalido`.
FR-11: Linha em que "Estoque real" é igual ao estoque atual deve ser classificada como `sem_alteracao`.
FR-12: Linha em que "Estoque real" é maior que o estoque atual deve ser classificada como `entrada`, com a diferença como quantidade.
FR-13: Linha em que "Estoque real" é menor que o estoque atual deve ser classificada como `saida`, com a diferença (em módulo) como quantidade.
FR-14: A resposta da prévia deve incluir, por linha, ao menos: skuId, codigo, nome, estoqueSistema, estoqueReal, diferenca, classificacao — e um resumo agregado com a contagem de linhas em cada classificação.
FR-15: A etapa de prévia não deve gravar nenhuma alteração no banco de dados.
```

### Aplicação dos ajustes

```
FR-16: O sistema deve expor POST /api/skus/importar-estoque/aplicar, recebendo a lista de linhas classificadas como `entrada` ou `saida` (skuId + estoqueReal).
FR-17: Ao aplicar, o sistema deve recalcular a diferença de cada linha a partir do estoque atual do SKU no momento da aplicação — não deve confiar no valor de diferença computado na prévia, que pode estar desatualizado.
FR-18: Cada linha deve ser aplicada individualmente: sucesso ou falha de uma linha não deve impedir o processamento das demais (sem transação única para o arquivo inteiro).
FR-19: Aplicar uma linha deve, numa transação por linha: (a) atualizar `skus.estoque` para o novo valor; (b) criar um registro em `movimentos_estoque` do tipo `entrada` ou `saida`, com `motivo = 'Ajuste de estoque (inventário)'`.
FR-20: A aplicação de um ajuste não deve criar nenhum lançamento em `caixa`, independentemente da direção do ajuste.
FR-21: Se, no momento da aplicação, o SKU da linha não existir mais (excluído entre a prévia e a confirmação), essa linha deve ser reportada como erro no resultado final, sem interromper as demais.
FR-22: A resposta da aplicação deve retornar duas listas: linhas aplicadas com sucesso (com estoque antes/depois e tipo de movimento gerado) e linhas ignoradas/com erro (com o motivo).
```

### Interface

```
FR-23: O sistema deve expor uma nova página (`ajuste-estoque.html`) acessível a partir de um link/botão na tela de SKUs, ao lado do botão "Exportar estoque (XLSX)".
FR-24: A página deve permitir selecionar um arquivo .xlsx e enviá-lo para prévia.
FR-25: A prévia deve ser exibida como tabela, com destaque visual para linhas `entrada`/`saida`, e exibição discreta/agrupada para linhas `sem_alteracao` e para as categorias de `ignorado_*`.
FR-26: A página deve exibir um resumo no topo da prévia (quantos SKUs vão ser ajustados, quantos sem alteração, quantos ignorados por categoria).
FR-27: O botão "Confirmar ajustes" só deve ficar habilitado quando houver ao menos uma linha classificada como `entrada` ou `saida`.
FR-28: Ao confirmar, a página deve exibir o resultado (linhas aplicadas com estoque antes/depois, linhas que falharam com o motivo), reaproveitando a mesma clareza visual da prévia.
FR-29: A página deve permitir iniciar um novo ajuste (novo upload) a partir da tela de resultado, sem recarregar a página manualmente.
```

## 6. Non-functional requirements

- **Performance:** sem requisito novo — volume baixo (dezenas de SKUs hoje); prévia e aplicação devem responder em menos de 2s em ambiente Docker local.
- **Reliability:** cada linha é aplicada em sua própria transação (FR-18/FR-19); uma falha isolada não corrompe nem bloqueia as demais. Risco aceito: se o servidor cair no meio da aplicação de um lote, algumas linhas podem já ter sido aplicadas e outras não — aceitável no contexto de uso solo/baixo volume; o resultado reportado (FR-22) deixa claro o que foi ou não aplicado.
- **Security:** sistema não tem autenticação hoje (fora de escopo deste PRD). Validar tipo e tamanho do arquivo (FR-02/FR-03) para evitar upload de arquivos arbitrários. Sanitizar (`escaparHtml`, já usado no restante do frontend) qualquer valor vindo da planilha antes de renderizar na prévia, para evitar que um nome de SKU malicioso injete HTML.
- **Scalability:** sem mudança — mesma arquitetura mono-processo/single MySQL; 10x o volume atual (centenas de SKUs) continua trivial para uma tabela client-side sem paginação.
- **Accessibility:** manter o padrão atual do frontend (HTML simples); nenhuma regressão nos formulários novos.
- **Compliance:** N/A — sistema interno sem dados sensíveis regulados.

## 7. UX / UI requirements

**Fluxo principal:**
1. Na tela de SKUs, clicar em "Ajustar estoque (importar XLSX)" (ao lado de "Exportar estoque (XLSX)") → abre `ajuste-estoque.html`.
2. Selecionar o arquivo `.xlsx` preenchido e clicar em "Enviar" → chama `POST /api/skus/importar-estoque`.
3. Ver a prévia: resumo no topo (contadores por classificação) + tabela linha a linha, com `entrada`/`saida` em destaque (cor/badge) e `sem_alteracao`/`ignorado_*` com tratamento visual discreto (ex: texto apagado, agrupado ou colapsável).
4. Clicar em "Confirmar ajustes" (habilitado só se houver algo a ajustar) → chama `POST /api/skus/importar-estoque/aplicar`.
5. Ver o resultado: lista dos SKUs realmente ajustados (estoque antes → depois, tipo de movimento) e dos que falharam (com motivo).
6. Opção de "Fazer novo ajuste", voltando ao passo 1 sem recarregar a página.

**Estados a cobrir:** nenhum arquivo selecionado (botão "Enviar" desabilitado ou validação ao clicar), arquivo rejeitado (erro claro de por que — formato errado, colunas faltando, IDs duplicados), prévia sem nenhuma linha a ajustar (tudo `sem_alteracao`/`ignorado_*` — botão "Confirmar" desabilitado, mensagem explicando), erro ao aplicar (rede/servidor), resultado parcial (algumas linhas aplicadas, outras com erro).

**Mensagens:** reaproveitar o padrão de erro já usado (`{ erro: '...' }`) e mensagens em português consistentes com o restante do sistema (ex: `"A planilha precisa ter as colunas ID e Estoque real"`, `"ID duplicado encontrado na planilha: 12, 27"`).

**Mobile vs desktop:** sem requisito novo — seguir o layout responsivo simples já existente em `public/style.css`.

**Design:** sem mockups — reaproveitar os componentes visuais já existentes (`.panel`, `.table-wrap`, `.badge`) das telas de Produtos/SKUs.

## 8. Data model changes

**Nenhuma mudança de schema necessária.** O fluxo reutiliza integralmente as tabelas existentes:
- `skus.estoque` — atualizado com o novo valor contado.
- `movimentos_estoque` — já suporta `tipo` (`entrada`/`saida`), `motivo` (texto livre) e `sku_id`; um novo movimento por linha ajustada é o suficiente para rastrear o ajuste, sem precisar de tabela nova para "lote de importação".

Isso elimina o risco de migração de schema para esta feature — todo o trabalho é em rotas novas e frontend novo.

## 9. API changes

```
Method + Path: POST /api/skus/importar-estoque
Request: multipart/form-data, campo `arquivo` (.xlsx)
Success response: 200 {
  linhas: [
    { skuId, codigo, nome, estoqueSistema, estoqueReal, diferenca, classificacao }
    // classificacao ∈ 'entrada' | 'saida' | 'sem_alteracao' | 'ignorado_nao_contado' | 'ignorado_sku_nao_encontrado' | 'ignorado_valor_invalido'
  ],
  resumo: { totalLinhas, aAjustar, semAlteracao, ignorados }
}
Error responses:
  400 — arquivo ausente, não é .xlsx, colunas obrigatórias faltando, ou IDs duplicados na planilha (mensagem lista os IDs)
  413 — arquivo maior que 5MB
  500 — erro inesperado ao processar

Method + Path: POST /api/skus/importar-estoque/aplicar
Request body: { linhas: [{ skuId, estoqueReal }] }
Success response: 200 {
  aplicados: [{ skuId, nome, estoqueAntes, estoqueDepois, tipo, quantidade }],
  ignorados: [{ skuId, motivo }]
}
Error responses:
  400 — corpo malformado (linhas ausente ou vazio)
  500 — erro inesperado
```

Nenhuma rota existente é alterada; nenhum breaking change.

## 10. Dependencies

| Dependency | Type | Owner | Risk |
|---|---|---|---|
| `exceljs` (parsing do XLSX enviado) | Interno (já é dependência, usada hoje só para exportar) | Dono do sistema | Baixo — biblioteca já em uso e testada no export |
| `multer` (upload multipart do arquivo) | Interno (já é dependência, usada hoje em `produtos.js` para imagem) | Dono do sistema | Baixo — mesmo padrão já usado |

## 11. Edge cases and error handling

```
EC-01: Célula "Estoque real" em branco → ignorado_nao_contado, nenhum movimento gerado (FR-08).
EC-02: Célula "Estoque real" com "0" explícito → tratado como valor real, zera o SKU se o estoque atual for diferente de 0.
EC-03: ID da linha não corresponde a nenhum SKU (excluído após a exportação) → ignorado_sku_nao_encontrado, reportado na prévia, resto do arquivo processado normalmente.
EC-04: SKU existente que não aparece na planilha → fica de fora do ajuste, sem alerta (silenciosamente ignorado, como esperado).
EC-05: Mesmo ID aparece duas ou mais vezes na planilha → rejeita o arquivo inteiro antes de qualquer prévia (FR-06).
EC-06: Valor não numérico ou negativo em "Estoque real" → ignorado_valor_invalido.
EC-07: "Estoque real" igual ao estoque atual → sem_alteracao, nenhum movimento gerado.
EC-08: Arquivo não é um XLSX válido (extensão/mimetype errado, ou corrompido) → 400 antes de processar qualquer linha.
EC-09: Planilha sem as colunas "ID" ou "Estoque real" (nome do cabeçalho não bate) → 400 antes de processar qualquer linha.
EC-10: SKU é excluído entre a prévia (passo 1) e a confirmação (passo 2) → linha reportada como erro no resultado da aplicação (FR-21), sem impedir as demais.
EC-11: Confirmação enviada sem nenhuma linha de entrada/saida (ex: usuário manipulou a requisição) → 400, nada aplicado.
EC-12: Estoque do SKU muda entre a prévia e a confirmação por outro motivo (ex: uma venda registrada nesse meio-tempo) → aplicação recalcula a diferença com base no estoque atual no momento de aplicar (FR-17), não confia no valor antigo da prévia.
```

## 12. Testing requirements

- **Unit tests:** não há suíte de testes automatizados no projeto hoje (fora de escopo introduzir framework de testes neste PRD); validar manualmente conforme checklist abaixo.
- **Integration tests:** N/A — mesmo motivo acima.
- **E2E tests:** N/A.
- **Ambiente de teste:** este fluxo muta estoque em lote — testar em um container Docker + banco MySQL isolados (não no banco real do dono do sistema), mesmo com plano de limpar os dados de teste depois.
- **Manual testing checklist (obrigatório antes de considerar concluído):**
  - [ ] Exportar a planilha, não alterar nada, reimportar → prévia mostra tudo como `sem_alteracao`, nenhum movimento gerado ao confirmar.
  - [ ] Preencher "Estoque real" maior que o atual em um SKU e menor em outro na mesma planilha → prévia classifica corretamente `entrada`/`saida`; ao confirmar, gera os movimentos certos e **nenhum** lançamento em caixa.
  - [ ] Deixar uma célula de "Estoque real" em branco → linha ignorada como "não contado", sem afetar o estoque daquele SKU.
  - [ ] Colocar "0" explícito em um SKU com estoque > 0 → zera o estoque ao confirmar.
  - [ ] Editar a planilha pra apontar um ID que não existe mais (excluir esse SKU antes de reimportar) → linha ignorada com aviso, resto do arquivo processado.
  - [ ] Duplicar uma linha (mesmo ID duas vezes) → upload inteiro rejeitado com mensagem clara, nenhuma prévia gerada.
  - [ ] Subir um arquivo que não é XLSX (ex: um `.csv` renomeado) → rejeitado com erro claro.
  - [ ] Remover a coluna "Estoque real" do arquivo antes de subir → rejeitado com erro claro.
  - [ ] Reordenar as colunas da planilha manualmente → prévia continua funcionando (match por cabeçalho, não por posição).
  - [ ] Conferir que os movimentos gerados aparecem na aba Estoque com motivo "Ajuste de estoque (inventário)" e sem nenhum lançamento correspondente em Caixa.
- **Performance tests:** N/A — fora de escopo.

## 13. Observability

- **Logs:** registrar no console (`console.log`, mesmo padrão do restante do sistema) um resumo de cada lote aplicado (quantos aplicados, quantos ignorados) para rastreamento básico. O histórico de verdade vive em `movimentos_estoque` (motivo "Ajuste de estoque (inventário)"), já consultável pela aba Estoque existente.
- **Metrics:** N/A — sistema não tem infraestrutura de métricas hoje.
- **Alerts:** N/A.
- **Dashboards:** N/A.

## 14. Rollout plan

- **Feature flag:** não aplicável — sistema de uso único/pequeno negócio, sem ambiente de staging separado.
- **Rollout stages:** deploy único (`docker compose up -d --build`, mesmo processo já usado nas features anteriores), sem fases — a feature é aditiva (rotas novas, página nova, nenhuma tabela alterada).
- **Rollback trigger:** se um ajuste aplicado gerar quantidade/tipo de movimento errado, ou se algum lançamento em caixa for criado indevidamente por essa funcionalidade.
- **Rollback procedure:** reverter o commit e rebuildar (`git revert` + `docker compose up -d --build`). Como nenhuma tabela/coluna nova foi criada, não há passo de reversão de schema. Ajustes de estoque já aplicados incorretamente precisam ser corrigidos manualmente (lançamento inverso pela aba Estoque), já que não há undo automático (non-goal explícito).

## 15. Open questions

| # | Question | Owner | Deadline | Status |
|---|---|---|---|---|
| 1 | O limite de 5MB para o arquivo (FR-03) foi inferido do precedente de upload de imagem de produto, não confirmado explicitamente pelo dono do sistema — está adequado, ou o limite deveria ser outro? | Dono do sistema | Antes de implementar FR-03 | Open |

## 16. Success metrics

- Qualitativo: dono do sistema consegue reconciliar uma contagem física completa numa única operação (upload → prévia → confirmar), sem lançar ajuste manual SKU por SKU.
- Qualitativo: zero lançamentos indevidos em caixa originados por essa funcionalidade.
- Quantitativo: zero incidentes de estoque incorreto (SKU zerado por engano por causa de célula em branco interpretada como zero) após o lançamento.
- Quantitativo: tempo para reconciliar um inventário de N SKUs cai de "N lançamentos manuais" para "1 upload + 1 confirmação".

---

PRD complete. Next steps in the workflow:
- Run `/create-issues` to break this PRD into ordered, atomic development issues
- Or run `/grill-me` again if any section above exposed a gap that needs clarification first
