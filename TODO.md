# TODO

- [x] Criar na página de visualização de cliente alguns dados do histórico de compras dele
- [x] Adicionar export de estoque em XLSX (todos os produtos + estoque), para conferência física — ideal ter uma coluna "Estoque sistema" e outra "Estoque real"
- [x] Adicionar coluna de ID na listagem de produtos
- [x] Adicionar coluna de ID na listagem de clientes
- [x] Criar filtro de fornecedor na listagem de produtos (multi-select) — implementado como campo `fornecedor_id` no SKU (não derivado do histórico de pedidos, que hoje está vazio)
- [x] Deixar salva a quantidade de itens por página selecionada no navegador (por tabela, não global) — feito em Produtos, SKUs, Clientes e Fornecedores, as 4 listagens que já usam o componente de tabela com paginação. Vendas/Estoque/Pedidos/Caixa ficam para quando ganharem paginação (item abaixo)
- [x] Criar página para ajuste de estoque via upload do próprio XLSX gerado — em SKUs → "Ajustar estoque (importar XLSX)". Casamento por ID do SKU (coluna por texto de cabeçalho, não posição); linha sem SKU correspondente é ignorada com aviso, sem travar o resto; célula em branco = "não contado" (ignora), nunca vira zero; mostra prévia antes de aplicar; motivo do movimento gerado é "Ajuste de estoque (inventário)", sem tocar caixa. Ver [`docs/prd-ajuste-estoque-importacao.md`](docs/prd-ajuste-estoque-importacao.md) e [`docs/issues-ajuste-estoque-importacao.md`](docs/issues-ajuste-estoque-importacao.md)

## Precisam de refinamento (dúvidas em aberto, ver conversa)

- [ ] Adicionar paginação nas listagens que ainda não têm (Vendas, Estoque, Pedidos, Caixa, em index.html) — decidir: paginação client-side (mais simples, dado já vem todo da API) ou server-side (`page`/`limit` na API, melhor se as tabelas crescerem muito)?
- [ ] Decidir sobre relatório financeiro x relatório de vendas: usar um relatório para cada, ou um só para os dois? Se for um só, falta adicionar as saídas (hoje o relatório só mostra entradas de pedidos) — preciso de ajuda para decidir
- [ ] Melhorar UX para evitar rolagem horizontal nas tabelas — decidir abordagem: esconder/abreviar colunas em telas estreitas, virar linha em card no mobile, ou fixar a primeira coluna
