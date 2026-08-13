# TODO

- [x] Criar na página de visualização de cliente alguns dados do histórico de compras dele
- [x] Adicionar export de estoque em XLSX (todos os produtos + estoque), para conferência física — ideal ter uma coluna "Estoque sistema" e outra "Estoque real"
- [x] Adicionar coluna de ID na listagem de produtos
- [x] Adicionar coluna de ID na listagem de clientes

## Precisam de refinamento (dúvidas em aberto, ver conversa)

- [ ] Adicionar paginação em todas as listagens do sistema — decidir: paginação client-side (mais simples, dado já vem todo da API) ou server-side (`page`/`limit` na API, melhor se as tabelas crescerem muito)?
- [ ] Deixar salvo o número de página selecionado no navegador, para o usuário não precisar ficar selecionando toda vez que listar (somente este item deve persistir; os demais filtros não devem persistir por hora) — depende do item de paginação acima; decidir se a página fica salva por tabela ou de forma global
- [ ] Decidir sobre relatório financeiro x relatório de vendas: usar um relatório para cada, ou um só para os dois? Se for um só, falta adicionar as saídas (hoje o relatório só mostra entradas de pedidos) — preciso de ajuda para decidir
- [ ] Criar página para ajuste de estoque via upload do próprio XLSX gerado (exportado acima): os valores da coluna "Estoque real" devem ser normalizados no sistema, lançando entrada ou saída conforme a diferença, com descrição/justificativa "Inventário" ou "Ajuste de estoque" (o que for mais semântico) — decidir: casar a linha por ID ou por código do SKU? O que fazer quando uma linha não bater com nenhum SKU existente (foi excluído)?
- [ ] Criar filtro de fornecedor na listagem de produtos (deve aceitar multi select no filtro) — hoje não existe vínculo direto produto→fornecedor, só via histórico de compras (pedido → SKU → fornecedor); confirmar se é assim que deve ser derivado ou se prefere um campo de fornecedor padrão no produto/SKU
- [ ] Melhorar UX para evitar rolagem horizontal nas tabelas — decidir abordagem: esconder/abreviar colunas em telas estreitas, virar linha em card no mobile, ou fixar a primeira coluna
