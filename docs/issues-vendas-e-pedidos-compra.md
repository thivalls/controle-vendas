# Issues: Renomear Pedidos → Vendas e Criar Módulo de Pedidos de Compra

Baseado em [`docs/prd-vendas-e-pedidos-compra.md`](./prd-vendas-e-pedidos-compra.md).

Duas fases sequenciais. **A Fase 2 só deve começar depois da Fase 1 estar validada em produção** (checklist manual da PRD, seção 12), porque a Fase 2 reaproveita o nome de tabela `pedidos`, que só fica livre depois do rename.

## Dependency graph

```
Fase 1 — Renomear Pedidos (venda) → Vendas
1. [infra]    Migração idempotente: renomear pedidos→vendas no banco
2. [backend]  Renomear rota pedidos.js → vendas.js e queries internas   ← depende de 1
3. [api]      Montar /api/vendas e atualizar venda_id em caixa/estoque/relatorios/produtos ← depende de 2
4. [frontend] Atualizar app.js/index.html para consumir /api/vendas     ← depende de 3
5. [chore]    Atualizar script de migração de data/db.json legado       ← depende de 1
6. [docs]     Atualizar README (Fase 1)                                 ← depende de 4

── checkpoint manual: validar checklist da PRD em produção antes de seguir ──

Fase 2 — Criar Pedidos (compra)
7. [infra]        Schema novo: fornecedores, pedidos(compra), pedido_itens(compra), colunas pedido_id ← depende de 1 (nome livre)
8. [backend+api]   CRUD de Fornecedores                                          ← depende de 7
9. [backend+api]   Criar pedido de compra (efeitos em estoque/custo/caixa) + GET  ← depende de 7, 8
10. [api]          Cancelar pedido de compra (estorno)                           ← depende de 9
11. [backend]      Bloquear exclusão de produto referenciado em pedido de compra ← depende de 9
12. [frontend]     Telas de Fornecedores e Pedidos (compra)                      ← depende de 8, 9, 10
13. [docs]         Atualizar README (Fase 2)                                     ← depende de 12
```

---

### Issue 1 — [infra] Migração idempotente: renomear pedidos→vendas

**Goal:** Renomear as tabelas e colunas que hoje representam vendas ao cliente, sem perder nenhum dado já existente em produção.

**Context:** `src/db.js#initSchema` hoje só roda `src/schema.sql`, que usa `CREATE TABLE IF NOT EXISTS` — isso não migra schema já existente, só cria do zero. É preciso adicionar um passo de migração que rode **antes** do `schema.sql` atual, verificando o estado do banco via `INFORMATION_SCHEMA` (checar se a tabela `pedidos` existe e `vendas` não existe antes de agir), para poder rodar com segurança toda vez que o servidor sobe — inclusive numa base que já foi migrada antes (não deve dar erro na segunda vez).

**Acceptance criteria:**
- [ ] Em um banco com o schema antigo (tabelas `pedidos`, `pedido_itens`, colunas `pedido_id` em `movimentos_estoque` e `caixa`), subir o servidor renomeia `pedidos`→`vendas`, `pedido_itens`→`venda_itens`, e as colunas `pedido_id`→`venda_id` nas duas tabelas, preservando 100% das linhas e valores.
- [ ] As foreign keys continuam válidas depois do rename (`venda_itens.pedido_id`→ também precisa virar `venda_id`, apontando para `vendas.id`; `movimentos_estoque.venda_id`/`caixa.venda_id` apontando para `vendas.id`).
- [ ] Rodar a migração duas vezes seguidas (servidor reiniciado) não gera erro nem tenta renomear de novo.
- [ ] Em um banco totalmente vazio (primeira instalação), a migração não faz nada (não encontra `pedidos` para renomear) e o `schema.sql` segue criando tudo do zero normalmente.

**Out of scope:** Criar as tabelas novas da Fase 2 (`fornecedores`, `pedidos`/`pedido_itens` de compra) — isso é a Issue 7.

**Edge cases to handle:**
- Servidor cai no meio da migração (ex: falha de conexão) → próxima subida deve conseguir completar os passos que faltaram, sem duplicar nem falhar nos que já foram feitos (checagem via `INFORMATION_SCHEMA.TABLES`/`INFORMATION_SCHEMA.COLUMNS` antes de cada `RENAME`/`ALTER`).
- Banco já tem `vendas` mas por algum motivo ainda tem `pedidos` também (estado inconsistente manual) → decidir e documentar o comportamento (recomenda-se: logar aviso e não sobrescrever `vendas`, para evitar perda de dados).

**Depends on:** none

**Suggested tests:**
- Manual: restaurar um dump de banco com o schema atual (produção real ou cópia), rodar o servidor, confirmar via `mysql` client que `vendas`/`venda_itens` existem com as mesmas contagens de linha que `pedidos`/`pedido_itens` tinham antes.
- Manual: rodar `docker compose up` duas vezes seguidas sobre a mesma base já migrada e confirmar que não há erro no log.
- Manual: apagar o volume e subir do zero, confirmar instalação limpa funcionando.

**Complexity:** M — mexe em schema de produção com dados reais; precisa ser bem testado antes de qualquer outra issue.

---

### Issue 2 — [backend] Renomear rota pedidos.js → vendas.js e queries internas

**Goal:** Fazer o código do backend refletir a nomenclatura "venda" para o fluxo de venda ao cliente, consistente com o banco já migrado na Issue 1.

**Context:** Arquivo atual: `src/routes/pedidos.js`. Renomear para `src/routes/vendas.js`. Atualizar todas as queries SQL (`FROM pedidos`, `FROM pedido_itens`, `pedido_id`) para `vendas`/`venda_itens`/`venda_id`. Renomear funções e variáveis internas: `mapPedido`→`mapVenda`, `mapItem` pode continuar ou virar `mapItemVenda`, `buscarPedidosComItens`→`buscarVendasComItens`. Mensagens de erro e motivos gravados (`'Pedido não encontrado'`, `Venda - Pedido #${id}`, `Recebimento do Pedido #${id}`, `Cancelamento de venda`, `Estorno do Pedido #${id}`) devem trocar "Pedido" por "Venda" (FR-10). O objeto retornado ao frontend mantém os mesmos nomes de campo (`clienteId`, `itens`, `total`, etc — FR-06), só a entidade muda de nome.

**Acceptance criteria:**
- [ ] `src/routes/pedidos.js` não existe mais; `src/routes/vendas.js` existe com o mesmo comportamento funcional de antes (criar, listar, buscar por id, cancelar).
- [ ] Nenhuma query SQL no arquivo referencia mais `pedidos`/`pedido_itens`/`pedido_id`.
- [ ] Mensagens de erro e textos gravados em `motivo`/`descricao` usam "Venda" no lugar de "Pedido".
- [ ] O router ainda não está montado em nenhum path novo (isso é a Issue 3) — pode deixar temporariamente sem uso ou já ajustar o require em `server.js` como parte desta issue, à critério de quem implementar, desde que a Issue 3 não fique bloqueada.

**Out of scope:** Mudar o path da API (`/api/pedidos`→`/api/vendas`) e atualizar `caixa.js`/`estoque.js`/`relatorios.js`/`produtos.js` — isso é a Issue 3.

**Edge cases to handle:**
- Nenhum comportamento funcional deve mudar — este é um rename puro, sem alterar regras de negócio (validações, transação, cálculo de total continuam idênticos).

**Depends on:** Issue 1

**Suggested tests:**
- Manual: com o banco já migrado (Issue 1), chamar as rotas ainda no path antigo (ou já no novo, se o require em `server.js` for atualizado junto) e confirmar que criar/listar/cancelar venda funciona igual a antes.

**Complexity:** S

---

### Issue 3 — [api] Montar /api/vendas e atualizar venda_id em caixa/estoque/relatorios/produtos

**Goal:** Expor o novo path `/api/vendas` e garantir que todo o resto do backend que lia a coluna `pedido_id` (agora `venda_id`) continue funcionando corretamente.

**Context:** Arquivos a revisar: `src/server.js` (trocar `app.use('/api/pedidos', pedidosRouter)` por `app.use('/api/vendas', vendasRouter)`), `src/routes/caixa.js` (`mapLancamento` lê `row.pedido_id` → deve ler `row.venda_id` e expor como `vendaId` no JSON; bloqueios de editar/excluir lançamento vinculado a pedido devem checar `venda_id`), `src/routes/estoque.js` (mesma troca de `pedido_id`→`venda_id`/`pedidoId`→`vendaId`), `src/routes/relatorios.js` (query `FROM pedidos`/`pedido_itens` no relatório mensal → `FROM vendas`/`venda_itens`), `src/routes/produtos.js` (bloqueio de exclusão de produto que hoje consulta `pedido_itens` → consultar `venda_itens`).

**Acceptance criteria:**
- [ ] `GET/POST /api/vendas`, `GET /api/vendas/:id`, `POST /api/vendas/:id/cancelar` respondem corretamente; `/api/pedidos` não existe mais para esse fluxo.
- [ ] `GET /api/caixa` e `GET /api/estoque` retornam `vendaId` (não mais `pedidoId`) nos registros vinculados a uma venda.
- [ ] `GET /api/relatorios/mensal` retorna exatamente os mesmos valores de `vendas`, `custoProdutosVendidos` e `lucro` que retornava antes da migração, para um mês fechado já existente no banco.
- [ ] Excluir um produto referenciado em `venda_itens` continua bloqueado com 400.

**Out of scope:** Frontend (Issue 4); campos/lógica relacionados a pedido de compra (Fase 2).

**Edge cases to handle:**
- Lançamento de caixa vinculado a uma venda continua não-editável/não-excluível diretamente (mensagem de erro deve mencionar "venda" em vez de "pedido").
- Relatório mensal de um mês com vendas canceladas deve continuar excluindo-as do total corretamente (comportamento inalterado, só a fonte dos dados muda de nome).

**Depends on:** Issue 2

**Suggested tests:**
- Manual: rodar a checklist de "Fase 1" da seção 12 da PRD (criar venda, cancelar venda, conferir caixa/estoque, conferir relatório mensal antes/depois).

**Complexity:** S

---

### Issue 4 — [frontend] Atualizar app.js/index.html para consumir /api/vendas

**Goal:** Fazer a interface refletir "Venda"/"Vendas" em vez de "Pedido"/"Pedidos" no fluxo de venda ao cliente, e apontar para o novo path da API.

**Context:** Arquivos: `public/app.js` (chamadas fetch para `/api/pedidos` → `/api/vendas`, nomes de variáveis/funções internas relacionadas), `public/index.html` (títulos, rótulos de menu, textos de formulário e tabela que hoje dizem "Pedido"/"Pedidos" no contexto de venda).

**Acceptance criteria:**
- [ ] Nenhuma chamada no frontend aponta mais para `/api/pedidos` para o fluxo de venda.
- [ ] Nenhum texto visível na tela do fluxo de venda ao cliente contém a palavra "Pedido" (deve dizer "Venda"/"Vendas").
- [ ] Criar, listar e cancelar venda funcionam de ponta a ponta pela interface (testado manualmente no navegador).

**Out of scope:** Qualquer tela nova de Fornecedores/Pedidos de compra (Fase 2).

**Edge cases to handle:**
- Mensagens de erro vindas da API (ex: "Cliente não encontrado") devem continuar sendo exibidas corretamente na UI mesmo com os textos renomeados ao redor.

**Depends on:** Issue 3

**Suggested tests:**
- Manual (obrigatório, é mudança de UI): abrir o sistema no navegador, criar uma venda, cancelar uma venda, conferir que a tela de caixa e estoque mostram os vínculos corretamente.

**Complexity:** S

---

### Issue 5 — [chore] Atualizar script de migração de data/db.json legado

**Goal:** Garantir que quem ainda precisar importar um `data/db.json` antigo (ver README) grave os dados diretamente nas tabelas já renomeadas.

**Context:** `scripts/migrar-json-para-mysql.js` hoje deve inserir em `pedidos`/`pedido_itens`. Depois da Issue 1, essas tabelas passam a se chamar `vendas`/`venda_itens` — o script precisa ser atualizado para gravar nos nomes novos.

**Acceptance criteria:**
- [ ] O script referencia `vendas`/`venda_itens` (e `venda_id` onde aplicável) em vez de `pedidos`/`pedido_itens`.
- [ ] Rodar `npm run migrate` com um `data/db.json` de exemplo popula corretamente a tabela `vendas` e seus itens.

**Out of scope:** Qualquer suporte a importar dados de fornecedores/pedidos de compra (não existiam no `db.json` legado).

**Edge cases to handle:**
- Script continua idempotente (só importa se as tabelas estiverem vazias, comportamento já documentado no README) — não deve reimportar/duplicar se rodado de novo.

**Depends on:** Issue 1

**Suggested tests:**
- Manual: rodar o script contra um `db.json` de exemplo e um banco recém-migrado, confirmar dados em `vendas`.

**Complexity:** XS

---

### Issue 6 — [docs] Atualizar README (Fase 1)

**Goal:** Deixar a documentação do projeto consistente com a nova nomenclatura antes de começar a Fase 2.

**Context:** `README.md`, seção "O que o sistema faz" — item "Pedidos" (linha ~58) deve virar "Vendas", com o texto atualizado.

**Acceptance criteria:**
- [ ] README não menciona mais "Pedidos" no sentido de venda ao cliente.
- [ ] Seção "Vendas" descreve o comportamento atual corretamente (cliente, baixa de estoque, lançamento em caixa, cancelamento).

**Out of scope:** Documentar o novo módulo de Pedidos (compra) — isso é a Issue 13, só depois que o módulo existir.

**Edge cases to handle:** N/A — mudança de texto.

**Depends on:** Issue 4

**Suggested tests:** Revisão de leitura.

**Complexity:** XS

---

> **Checkpoint antes da Fase 2:** rodar a checklist manual completa da seção 12 da PRD em produção (ou cópia fiel dos dados de produção) e confirmar que nada quebrou antes de abrir a Issue 7.

---

### Issue 7 — [infra] Schema novo: fornecedores, pedidos(compra), pedido_itens(compra), colunas pedido_id

**Goal:** Criar a base de dados para o novo módulo de pedidos de compra, agora que o nome `pedidos` está livre.

**Context:** Adicionar em `src/schema.sql` (via `CREATE TABLE IF NOT EXISTS`, mesmo padrão já usado): tabela `fornecedores` (espelhando `clientes`), tabela `pedidos` (compra: `fornecedor_id`, `data`, `status` enum `concluido`/`cancelado`, `numero_nota_fiscal` nullable, `data_nota_fiscal` nullable, `observacoes`, `total`), tabela `pedido_itens` (compra: `pedido_id`, `produto_id`, `quantidade`, `preco_unit_custo`). Também adicionar a coluna `pedido_id INT NULL` (FK para o novo `pedidos.id`, `ON DELETE SET NULL`) em `movimentos_estoque` e em `caixa` — como essas tabelas já existem, é preciso um passo de `ALTER TABLE ... ADD COLUMN` condicional (checar `INFORMATION_SCHEMA.COLUMNS` antes, já que nem toda versão de MySQL suporta `ADD COLUMN IF NOT EXISTS`), no mesmo lugar da migração criada na Issue 1.

**Acceptance criteria:**
- [ ] Subir o servidor numa base já com a Fase 1 aplicada cria `fornecedores`, `pedidos`, `pedido_itens` do zero, sem conflito com as tabelas de venda já renomeadas.
- [ ] `movimentos_estoque` e `caixa` ganham a coluna `pedido_id` (nullable, FK), preservando todos os dados existentes.
- [ ] Rodar a migração duas vezes seguidas não duplica nem falha (idempotente, mesma exigência da Issue 1).
- [ ] Numa instalação nova (do zero), todas as tabelas (vendas e compras) são criadas corretamente numa única subida.

**Out of scope:** Popular dados; rotas de API (Issues 8–11).

**Edge cases to handle:**
- Rodar num banco que ainda não passou pela Fase 1 (`pedidos` ainda existe com sentido de venda) → a migração da Issue 1 deve rodar antes e liberar o nome; documentar essa ordem de execução claramente no código/comentário da migração.

**Depends on:** Issue 1

**Suggested tests:**
- Manual: banco pós-Fase 1 → subir servidor → conferir via `mysql` client que as tabelas/colunas novas existem com os tipos e FKs corretos.
- Manual: instalação do zero → conferir que tudo é criado numa subida só.

**Complexity:** M — segunda rodada de migração idempotente sobre schema já em produção.

---

### Issue 8 — [backend+api] CRUD de Fornecedores

**Goal:** Permitir cadastrar, listar, editar e excluir fornecedores, para vincular aos pedidos de compra.

**Context:** Criar `src/routes/fornecedores.js` espelhando exatamente `src/routes/clientes.js` (mesmos campos: `nome` obrigatório, `telefone`/`email`/`endereco` opcionais). Montar em `server.js` como `app.use('/api/fornecedores', fornecedoresRouter)`. A exclusão deve checar a tabela `pedidos` (compra) por `fornecedor_id` antes de permitir (FR-13) — a tabela já existe pela Issue 7, mesmo que ainda vazia (nenhuma outra issue depende disso para funcionar).

**Acceptance criteria:**
- [ ] `GET/POST/PUT/DELETE /api/fornecedores` funcionam com o mesmo contrato descrito na seção 9 da PRD.
- [ ] Criar fornecedor sem nome retorna 400.
- [ ] Excluir fornecedor com pedido de compra vinculado retorna 400 (mesmo que a criação de pedidos ainda não exista via API nesta issue — pode ser testado inserindo uma linha manualmente ou adiando o teste até a Issue 9 estar pronta).

**Out of scope:** Tela de frontend (Issue 12); pedidos de compra em si (Issue 9).

**Edge cases to handle:**
- Excluir fornecedor sem nenhum pedido vinculado → permitido (204).

**Depends on:** Issue 7

**Suggested tests:**
- Manual: `curl`/Postman contra os 4 endpoints, cobrindo caminho feliz e os dois erros de validação.

**Complexity:** XS — cópia direta do padrão de `clientes.js`.

---

### Issue 9 — [backend+api] Criar pedido de compra (efeitos em estoque/custo/caixa) + GET

**Goal:** Implementar o núcleo do novo módulo: registrar uma compra com múltiplos itens que dá entrada no estoque, atualiza o custo do produto e lança a saída no caixa, tudo numa transação.

**Context:** Criar `src/routes/pedidos.js` (compra), seguindo o mesmo padrão transacional de `src/routes/vendas.js` (`pool.getConnection()`, `beginTransaction`, `SELECT ... FOR UPDATE` nos produtos para evitar corrida — EC-08 da PRD) e do endpoint `POST /produtos/:id/entrada` já existente (para o padrão de atualizar estoque + lançar caixa). Implementar `POST /api/pedidos` (FR-14 a FR-17: valida fornecedor e itens, soma linhas duplicadas do mesmo produto+preço, calcula total, insere `pedidos`/`pedido_itens`, soma `estoque` e **atualiza `preco_custo`** de cada produto — FR-16b —, insere `movimentos_estoque` tipo `entrada` por item com `pedido_id` preenchido, insere um único lançamento `caixa` tipo `saida` categoria `'Compra de mercadoria'` com `pedido_id` preenchido) e `GET /api/pedidos` / `GET /api/pedidos/:id` (FR-18, com nome do fornecedor e fallback `'(fornecedor removido)'`). Também atualizar `mapLancamento` em `caixa.js` e o mapeamento em `estoque.js` (tocados na Issue 3) para incluir `pedidoId` nos registros vinculados a um pedido de compra, ao lado de `vendaId` — cada registro deve ter no máximo um dos dois preenchido.

**Acceptance criteria:**
- [ ] `POST /api/pedidos` com 2+ itens do mesmo produto e mesmo preço soma as quantidades numa única linha antes de salvar (mesmo comportamento hoje aplicado a vendas).
- [ ] Depois de criar um pedido, o `estoque` e o `preco_custo` de cada produto envolvido refletem os valores do pedido.
- [ ] Um `movimentos_estoque` tipo `entrada` é criado por item, e um lançamento `caixa` tipo `saida` categoria `'Compra de mercadoria'` é criado no valor total do pedido — ambos com `pedido_id` apontando para o pedido criado.
- [ ] `numeroNotaFiscal`/`dataNotaFiscal` são opcionais — criar um pedido sem esses campos funciona normalmente (EC-09).
- [ ] `GET /api/estoque` e `GET /api/caixa` passam a expor `pedidoId` nos registros gerados por um pedido de compra.
- [ ] Toda a operação de criação é atômica: forçar um erro no meio (ex: produto inexistente no segundo item) não deixa nenhum efeito parcial em estoque/caixa/pedido.

**Out of scope:** Cancelamento (Issue 10); bloqueio de exclusão de produto (Issue 11); frontend (Issue 12).

**Edge cases to handle:**
- Produto informado não existe → 400, rollback completo.
- Quantidade <= 0 ou preço unitário negativo → 400, rollback completo.
- Fornecedor não informado ou inexistente → 400, rollback completo.
- Dois pedidos concorrentes para o mesmo produto → `FOR UPDATE` evita condição de corrida no estoque (EC-08).

**Depends on:** Issue 7, Issue 8

**Suggested tests:**
- Manual: criar pedido com 1 item, com múltiplos itens, com item duplicado (mesmo produto/preço), sem nota fiscal, com nota fiscal.
- Manual: conferir estoque, preço de custo, movimentos e caixa depois de cada cenário acima.
- Manual: tentar criar pedido com produto inexistente e confirmar rollback total (estoque/caixa inalterados).

**Complexity:** L — é o coração da feature, com transação multi-tabela e mudança em endpoints de listagem já existentes (`caixa.js`, `estoque.js`).

---

### Issue 10 — [api] Cancelar pedido de compra (estorno)

**Goal:** Permitir reverter um pedido de compra lançado por engano, sem exigir alteração manual no banco.

**Context:** Implementar `POST /api/pedidos/:id/cancelar` em `src/routes/pedidos.js` (compra), simétrico ao `POST /api/vendas/:id/cancelar` já existente: subtrai a quantidade de cada item do estoque, lança `movimentos_estoque` tipo `saida` por item, lança um estorno `entrada` no `caixa` no valor total do pedido, marca `status = 'cancelado'` (FR-19).

**Acceptance criteria:**
- [ ] Cancelar um pedido `concluido` reverte estoque, gera os movimentos/lançamentos de estorno e muda o status para `cancelado`.
- [ ] Cancelar um pedido já `cancelado` retorna 400 e não duplica o estorno (EC-05).
- [ ] Cancelar um pedido inexistente retorna 404.
- [ ] Toda a operação é transacional (rollback completo em qualquer erro no meio).

**Out of scope:** Frontend (Issue 12).

**Edge cases to handle:**
- Estoque do produto já foi alterado manualmente depois da compra (ex: venda parcial) → estornar ainda deve subtrair a quantidade original do pedido do estoque atual, mesmo que resulte em estoque menor do que o esperado (mesmo comportamento já aceito hoje no cancelamento de venda, que soma de volta sem checar consistência prévia).

**Depends on:** Issue 9

**Suggested tests:**
- Manual: criar e cancelar um pedido, conferir estoque/caixa/movimentos revertidos.
- Manual: tentar cancelar o mesmo pedido de novo e confirmar erro 400.

**Complexity:** S

---

### Issue 11 — [backend] Bloquear exclusão de produto referenciado em pedido de compra

**Goal:** Evitar excluir um produto que tenha histórico de compra, mantendo a integridade do relatório e do histórico (FR-20).

**Context:** `src/routes/produtos.js`, endpoint `DELETE /:id`, já bloqueia exclusão se o produto está em `venda_itens` (ajustado na Issue 3). Adicionar a mesma checagem para `pedido_itens` (compra) — bloquear se o produto aparecer em qualquer um dos dois.

**Acceptance criteria:**
- [ ] Excluir um produto referenciado em algum `pedido_itens` (compra) retorna 400 com mensagem clara.
- [ ] Excluir um produto sem nenhuma referência (nem venda, nem compra) continua funcionando (204).

**Out of scope:** Mudanças em `venda_itens` (já coberto na Issue 3).

**Edge cases to handle:**
- Produto referenciado em venda E em compra → bloqueado (basta uma das duas checagens já bloquear).

**Depends on:** Issue 7, Issue 9

**Suggested tests:**
- Manual: criar pedido de compra com um produto, tentar excluir o produto, confirmar 400.

**Complexity:** XS

---

### Issue 12 — [frontend] Telas de Fornecedores e Pedidos (compra)

**Goal:** Dar ao usuário uma interface para cadastrar fornecedores e registrar/cancelar pedidos de compra, sem precisar chamar a API diretamente.

**Context:** Seguir os padrões visuais já usados em `public/index.html`/`public/app.js`/`public/style.css` para Clientes (tela de Fornecedores, CRUD simples) e para o formulário de Venda (tela de Pedidos: seleção de fornecedor, lista dinâmica de itens com produto/quantidade/preço unitário, total calculado ao vivo, campos opcionais de número/data de nota fiscal, botão cancelar por pedido). Ver seção 7 da PRD para os estados a cobrir (lista vazia, erro de validação, sucesso, pedido já cancelado).

**Acceptance criteria:**
- [ ] Tela "Fornecedores": listar, criar, editar, excluir — funcionando de ponta a ponta no navegador.
- [ ] Tela "Pedidos": listar (fornecedor, data, nota fiscal, total, status), criar com itens dinâmicos e total ao vivo, cancelar (com confirmação) — funcionando de ponta a ponta no navegador.
- [ ] Erros de validação da API (fornecedor não encontrado, item inválido, etc) aparecem para o usuário de forma legível.
- [ ] Ação de cancelar fica desabilitada/oculta para pedidos já `cancelado`.

**Out of scope:** Qualquer mudança no fluxo de Vendas (já concluído na Fase 1).

**Edge cases to handle:**
- Nenhum fornecedor cadastrado ainda → formulário de novo pedido orienta a cadastrar um fornecedor primeiro (ou linka para a tela de Fornecedores).
- Nenhum produto cadastrado ainda → mesma orientação para a tela de Produtos.

**Depends on:** Issue 8, Issue 9, Issue 10

**Suggested tests:**
- Manual (obrigatório, é UI nova): fluxo completo no navegador — cadastrar fornecedor, criar pedido com 2+ itens, conferir estoque/custo/caixa atualizados nas outras telas, cancelar o pedido, conferir reversão.

**Complexity:** M — duas telas novas, uma delas (Pedidos) com formulário dinâmico de itens.

---

### Issue 13 — [docs] Atualizar README (Fase 2)

**Goal:** Documentar o novo módulo para quem for usar ou dar manutenção no sistema depois.

**Context:** `README.md`, seção "O que o sistema faz" — adicionar itens "Fornecedores" e "Pedidos" (compra), descrevendo o comportamento (nota fiscal opcional, atualização automática de custo, efeito em estoque/caixa, cancelamento).

**Acceptance criteria:**
- [ ] README descreve o módulo de Pedidos (compra) e Fornecedores com o mesmo nível de detalhe usado para os módulos existentes.
- [ ] Fica claro na documentação a diferença entre "Vendas" (saída, cliente) e "Pedidos" (entrada, fornecedor).

**Out of scope:** Nenhum.

**Edge cases to handle:** N/A — mudança de texto.

**Depends on:** Issue 12

**Suggested tests:** Revisão de leitura.

**Complexity:** XS

---

## Risks and open questions

- [Risk] A migração de rename (Issues 1 e 7) roda direto sobre o volume MySQL de produção, sem staging separado → mitigação: fazer backup do volume (`controle-vendas-mysql-data`) antes de aplicar cada uma, conforme seção 14 da PRD.
- [Risk] `DECIMAL`/enum e nomes de coluna precisam bater exatamente entre `RENAME`/`ALTER` e o `schema.sql` final, ou o `CREATE TABLE IF NOT EXISTS` subsequente pode silenciosamente não criar o que falta (ele não altera tabela existente) → mitigação: testar a sequência completa (migração + schema.sql) do zero e também partindo de um dump real antes de considerar a Issue 1 e a Issue 7 prontas.
- [Open] Qual a versão exata do MySQL no `docker-compose.yml`? Define se dá para usar `ADD COLUMN IF NOT EXISTS` direto (MySQL 8.0.29+) ou se a migração precisa checar `INFORMATION_SCHEMA` manualmente — decidir antes de implementar a Issue 1.
- [Open] Existe backup atual do volume `controle-vendas-mysql-data`? Confirmar antes do deploy da Fase 1.

## Parallel tracks

```
Track A (schema/backend, sequencial por natureza da migração):
  1 → 2 → 3 → [checkpoint manual] → 7 → 9 → 10 → 11

Track B (frontend, encaixa depois que a API correspondente está pronta):
  (depende de 3) → 4
  (depende de 8, 9, 10) → 12

Track C (independente, pode rodar em paralelo a qualquer momento após 1/7):
  5 (depende só de 1)
  8 (depende só de 7, pode andar em paralelo com 9 já que fornecedor e pedido de compra são entidades distintas até o ponto de FK)

Docs fecham cada fase: 6 (fim da Fase 1), 13 (fim da Fase 2)
```
