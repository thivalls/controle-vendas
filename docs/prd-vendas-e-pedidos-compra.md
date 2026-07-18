# PRD: Renomear Pedidos → Vendas e Criar Módulo de Pedidos de Compra

**Status:** Draft
**Author:** (via Claude, a pedido do dono do sistema)
**Date:** 2026-07-18
**Version:** 1.0

---

## 1. Problem statement

O sistema hoje tem um módulo chamado "Pedidos" que na verdade representa **vendas para clientes** (baixa estoque, lança entrada no caixa). Isso cria ambiguidade de nomenclatura assim que se tenta modelar o outro lado do negócio: a **compra de mercadoria de fornecedores** para reabastecer o estoque. Hoje essa reposição só existe como um endpoint avulso e simplificado (`POST /produtos/:id/entrada`), item a item, sem suportar uma "nota de compra" com múltiplos produtos, sem vínculo a fornecedor e sem nota fiscal — o que não reflete como uma compra real acontece (uma nota fiscal chega com vários itens, quantidades e preços). O dono do sistema faz login diariamente para lançar vendas e reposições de estoque; a falta de um fluxo de compra estruturado obriga lançamentos manuais produto a produto, mais lentos e mais sujeitos a erro de digitação de custo.

## 2. Goals

- O termo "Pedido" no sistema passa a significar exclusivamente **pedido de compra** (entrada de mercadoria); o fluxo atual de venda ao cliente passa a se chamar "Venda" em 100% das camadas (banco, API, frontend, docs) — sem nenhuma referência residual a "pedido" com sentido de venda.
- O usuário consegue registrar uma compra com vários produtos numa única operação (like a nota fiscal), informando quantidade e preço unitário de cada item, e o sistema dá entrada no estoque e lança a saída no caixa automaticamente, na mesma transação.
- A nota fiscal é um dado **opcional** do pedido de compra (não bloqueia o registro se ausente).
- Nenhuma venda, movimento de estoque ou lançamento de caixa histórico é perdido ou corrompido durante a renomeação (migração segura de dados existentes em produção).
- Os relatórios (lucro mensal) continuam corretos após a renomeação, sem alterar os números já calculados para meses passados.

## 3. Non-goals

- **Fluxo de aprovação/pendência de compra** (pedido "pendente" até confirmar recebimento): fora de escopo agora — todo pedido de compra nasce com status `concluido`, mesma lógica das vendas hoje. Pode virar um pedido futuro.
- **Upload/anexo de XML ou PDF da nota fiscal**: fora de escopo — só campos de texto (número e data da nota).
- **Remoção dos endpoints avulsos de estoque** (`POST /produtos/:id/entrada` e `/:id/saida`): decisão explícita do usuário é mantê-los como estão, para ajustes/correções pontuais que não passam por um pedido de compra formal.
- **Multi-moeda, impostos, frete rateado por item**: fora de escopo — total do pedido de compra é a soma simples de `quantidade × preço unitário`.
- **Edição de pedido de compra já concluído**: assim como vendas hoje, não há edição — só cancelamento (estorno).

## 4. User stories

1. Como dono do sistema, quero que a tela e a API que hoje se chamam "Pedidos" passem a se chamar "Vendas" em todo lugar, para que o nome reflita o que o fluxo realmente faz. — **P0**
   - **Notas:** inclui tabelas do banco, rotas da API, textos da interface e README.
2. Como dono do sistema, quero criar um pedido de compra escolhendo o fornecedor e adicionando vários produtos com quantidade e preço unitário, para dar entrada no estoque de uma vez só, igual a uma nota de compra real. — **P0**
   - **Notas:** cálculo do total é automático; salvar dá entrada no estoque e lança saída no caixa na mesma transação.
3. Como dono do sistema, quero informar opcionalmente o número e a data da nota fiscal ao registrar um pedido de compra, para manter rastreabilidade sem ser obrigado a isso quando não tiver a nota em mãos. — **P0**
4. Como dono do sistema, quero que o preço de custo do produto seja atualizado automaticamente com o preço unitário pago na última compra, para que o relatório de lucro use o custo mais atual sem eu precisar editar cada produto manualmente. — **P0**
5. Como dono do sistema, quero poder cancelar um pedido de compra, revertendo a entrada de estoque e o lançamento de caixa, para corrigir erros de lançamento sem mexer direto no banco. — **P1**
   - **Notas:** simétrico ao cancelamento de venda já existente.
6. Como dono do sistema, quero um cadastro simples de fornecedores (nome, telefone, email, endereço), para vincular cada pedido de compra a quem vendeu a mercadoria. — **P1**
   - **Notas:** mesma estrutura do cadastro de clientes já existente.
7. Como dono do sistema, quero que meus dados de vendas, estoque e caixa já lançados continuem intactos depois da renomeação, para não perder histórico de um sistema que já está em uso real. — **P0**

## 5. Functional requirements

### Renomeação Pedidos → Vendas

```
FR-01: A tabela `pedidos` deve ser renomeada para `vendas`, preservando todos os registros existentes.
FR-02: A tabela `pedido_itens` deve ser renomeada para `venda_itens`, preservando todos os registros existentes.
FR-03: A coluna `pedido_id` em `movimentos_estoque` e em `caixa` deve ser renomeada para `venda_id`, preservando os valores e a foreign key (agora apontando para `vendas.id`).
FR-04: O arquivo `src/routes/pedidos.js` deve ser renomeado para `src/routes/vendas.js`, com todas as funções, variáveis e comentários internos usando a nomenclatura "venda" (ex: `mapPedido` → `mapVenda`, `buscarPedidosComItens` → `buscarVendasComItens`).
FR-05: As rotas da API devem migrar de `/api/pedidos` para `/api/vendas`, mantendo os mesmos verbos e comportamentos (`GET /`, `GET /:id`, `POST /`, `POST /:id/cancelar`).
FR-06: O payload JSON de venda deve manter os mesmos nomes de campo já usados hoje (`clienteId`, `itens`, `formaPagamento`, `observacoes`, `total`, `status`) — não há motivo de negócio para renomear esses campos, só a entidade em si.
FR-07: O frontend (`public/app.js`, `public/index.html`) deve ser atualizado para consumir `/api/vendas` e exibir os textos "Venda"/"Vendas" no lugar de "Pedido"/"Pedidos" em todos os rótulos, títulos e mensagens relativos a esse fluxo.
FR-08: O `README.md` deve ser atualizado para descrever o módulo como "Vendas" e documentar o novo módulo "Pedidos" (compras).
FR-09: A migração de renomeação deve ser idempotente e rodar automaticamente na inicialização do servidor (mesma filosofia do `initSchema` atual em `src/db.js`), sem exigir passo manual do usuário.
FR-10: Categorias de caixa e motivos de movimento de estoque gerados pelo fluxo de venda (ex: `'Venda'`, `Venda - Pedido #123`, `Recebimento do Pedido #123`, `Cancelamento de venda`, `Estorno do Pedido #123`) devem ser atualizados para referenciar "Venda #123" em vez de "Pedido #123". Lançamentos já existentes no banco (texto histórico) não precisam ser reescritos retroativamente.
FR-11: O script `scripts/migrar-json-para-mysql.js` deve ser atualizado para gravar os dados antigos de `data/db.json` diretamente nas tabelas já renomeadas (`vendas`, `venda_itens`), já que passa a rodar depois da migração de renomeação.

### Novo módulo de Pedidos (compras)

```
FR-12: O sistema deve expor um cadastro de fornecedores com os campos nome (obrigatório), telefone, email e endereço (opcionais), espelhando a estrutura de clientes (`GET/POST/PUT/DELETE /api/fornecedores`).
FR-13: Um fornecedor não pode ser excluído se possuir algum pedido de compra vinculado; a API deve retornar erro 400 nesse caso.
FR-14: O sistema deve expor `POST /api/pedidos` para criar um pedido de compra com: fornecedorId (obrigatório), itens (obrigatório, mínimo 1), numeroNotaFiscal (opcional), dataNotaFiscal (opcional), observacoes (opcional).
FR-15: Cada item do pedido de compra deve conter produtoId, quantidade (> 0) e precoUnitCusto (>= 0); o total do pedido é a soma de `quantidade × precoUnitCusto` de todos os itens.
FR-16: Ao salvar um pedido de compra, o sistema deve, na mesma transação: (a) somar a quantidade ao estoque de cada produto; (b) atualizar `preco_custo` do produto para o `precoUnitCusto` informado no item; (c) criar um registro de `movimentos_estoque` do tipo `entrada` para cada item, com motivo referenciando o pedido; (d) criar um lançamento de `saida` em `caixa`, categoria `Compra de mercadoria`, no valor total do pedido.
FR-17: Se o mesmo produto aparecer mais de uma vez no pedido de compra com o mesmo preço unitário, as linhas devem ser somadas em uma única linha antes de salvar (mesmo comportamento hoje aplicado às vendas).
FR-18: O sistema deve expor `GET /api/pedidos` e `GET /api/pedidos/:id`, retornando os itens e o nome do fornecedor (com fallback `'(fornecedor removido)'` se o fornecedor tiver sido excluído).
FR-19: O sistema deve expor `POST /api/pedidos/:id/cancelar`, que reverte a entrada de estoque de cada item (subtrai do estoque), lança um `saida` de `movimentos_estoque` e um estorno de `entrada` no `caixa`, e marca o pedido como `cancelado` — simétrico ao cancelamento de venda. Não deve permitir cancelar um pedido já cancelado.
FR-20: Excluir um produto que possua itens em algum pedido de compra deve ser bloqueado (400), do mesmo jeito que hoje é bloqueado para vendas.
FR-21: O frontend deve ganhar uma tela "Pedidos" para listar, criar e cancelar pedidos de compra, com seleção de fornecedor, adição dinâmica de itens (produto, quantidade, preço unitário), cálculo do total em tempo real, e campos opcionais de número/data da nota fiscal.
FR-22: O relatório mensal (`GET /api/relatorios/mensal`) deve continuar calculando `comprasDeMercadoria` somando lançamentos de caixa da categoria `Compra de mercadoria`, agora incluindo tanto entradas avulsas (`produtos.js`) quanto pedidos de compra — sem exigir mudança na fórmula de lucro, só a origem dos dados.
```

## 6. Non-functional requirements

- **Performance:** não há requisito novo de performance — volumes são baixos (uso de um único usuário/pequeno negócio); operações de pedido/venda devem continuar respondendo em menos de 1s em ambiente Docker local.
- **Reliability:** toda operação que mexe em estoque + caixa + pedido deve permanecer atômica (transação MySQL com rollback em qualquer erro), igual ao padrão já usado em `pedidos.js`/`produtos.js`.
- **Security:** sem mudança — sistema não tem autenticação hoje; fora de escopo deste PRD.
- **Scalability:** sem mudança — mesma arquitetura mono-processo/single MySQL.
- **Accessibility:** manter o padrão atual do frontend (HTML simples); nenhuma regressão de usabilidade nos formulários novos.
- **Compliance:** N/A — não aplicável, sistema interno sem dados sensíveis regulados.

## 7. UX / UI requirements

**Fluxos principais:**
1. Renomear em toda a navegação/menu o item "Pedidos" para "Vendas" (fluxo de venda ao cliente, comportamento inalterado).
2. Novo item de menu "Pedidos" (compras):
   - Lista de pedidos de compra (fornecedor, data, nota fiscal, total, status), mais recentes primeiro.
   - Botão "Novo pedido": formulário com seleção de fornecedor, campos opcionais de número/data da nota fiscal, observações, e uma lista dinâmica de itens (produto, quantidade, preço unitário), com botão de adicionar/remover linha e total calculado ao vivo.
   - Ação "Cancelar" por pedido, com confirmação, disponível apenas para pedidos `concluido`.
3. Novo cadastro de "Fornecedores", espelhando a tela de Clientes já existente (listar, criar, editar, excluir).

**Estados a cobrir:** lista vazia (nenhum pedido/fornecedor ainda), formulário com erro de validação (ex: sem itens, quantidade inválida, fornecedor não selecionado), sucesso ao salvar, pedido já cancelado (ação desabilitada).

**Mensagens:** reaproveitar o padrão de erro já usado (`{ erro: '...' }`) e mensagens em português consistentes com o restante do sistema (ex: `"O pedido precisa ter ao menos um item"`, `"Fornecedor não encontrado"`).

**Mobile vs desktop:** sem requisito novo — seguir o layout responsivo simples já existente em `public/style.css`.

**Design:** sem mockups — reaproveitar os componentes visuais (tabelas, formulários) já usados nas telas de Vendas e Produtos.

## 8. Data model changes

**Renomeações (preservando dados):**
- `pedidos` → `vendas`
- `pedido_itens` → `venda_itens`
- `movimentos_estoque.pedido_id` → `movimentos_estoque.venda_id` (FK para `vendas.id`)
- `caixa.pedido_id` → `caixa.venda_id` (FK para `vendas.id`)

**Novas tabelas:**

```sql
CREATE TABLE fornecedores (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  telefone VARCHAR(50) NOT NULL DEFAULT '',
  email VARCHAR(255) NOT NULL DEFAULT '',
  endereco VARCHAR(500) NOT NULL DEFAULT '',
  criado_em DATETIME NOT NULL
);

CREATE TABLE pedidos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  fornecedor_id INT NOT NULL,
  data DATETIME NOT NULL,
  status ENUM('concluido', 'cancelado') NOT NULL DEFAULT 'concluido',
  numero_nota_fiscal VARCHAR(100) NULL,
  data_nota_fiscal DATE NULL,
  observacoes TEXT,
  total DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (fornecedor_id) REFERENCES fornecedores(id)
);

CREATE TABLE pedido_itens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pedido_id INT NOT NULL,
  produto_id INT NOT NULL,
  quantidade INT NOT NULL,
  preco_unit_custo DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
  FOREIGN KEY (produto_id) REFERENCES produtos(id)
);
```

**Colunas novas em tabelas existentes:**
- `movimentos_estoque.pedido_id INT NULL` — FK para `pedidos.id` (a nova tabela de compras), `ON DELETE SET NULL`. Convive com `venda_id`; cada movimento tem no máximo um dos dois preenchido.
- `caixa.pedido_id INT NULL` — FK para `pedidos.id`, `ON DELETE SET NULL`. Mesma regra de exclusividade com `venda_id`.

**Migração de dados existentes (produção):** como `src/db.js#initSchema` hoje só roda `CREATE TABLE IF NOT EXISTS` (idempotente, mas não migra schema existente), é necessário um passo de migração que rode antes do `schema.sql` atual e que seja seguro rodar toda vez que o servidor sobe:
1. Se a tabela `pedidos` existir e a tabela `vendas` não existir → `RENAME TABLE pedidos TO vendas, pedido_itens TO venda_itens;` e `ALTER TABLE movimentos_estoque CHANGE pedido_id venda_id INT NULL; ALTER TABLE caixa CHANGE pedido_id venda_id INT NULL;` (checar `INFORMATION_SCHEMA.COLUMNS`/`TABLES` antes de cada passo para ser idempotente).
2. Depois disso, `schema.sql` roda normalmente e cria `pedidos`, `pedido_itens`, `fornecedores` do zero (tabelas novas, sem conflito de nome) e adiciona as colunas novas `pedido_id` em `movimentos_estoque`/`caixa` via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (ou checagem manual, já que MySQL só suporta `ADD COLUMN IF NOT EXISTS` a partir de versões recentes — confirmar versão do MySQL usada no `docker-compose.yml`).
3. Este passo de migração deve ser coberto por um teste manual: subir o container com dados de uma versão anterior do `schema.sql` e confirmar que os dados de venda continuam acessíveis via `/api/vendas` depois do rename.

**Impacto em queries existentes:** `relatorios.js` e `produtos.js` fazem `SELECT ... FROM pedidos`/`pedido_itens` hoje — precisam ser atualizados para `vendas`/`venda_itens` (venda) ou continuar usando `pedidos`/`pedido_itens` (agora com sentido de compra, ver FR-22).

## 9. API changes

**Renomeadas (mesmo contrato, novo path):**
```
GET    /api/pedidos           → GET    /api/vendas
GET    /api/pedidos/:id       → GET    /api/vendas/:id
POST   /api/pedidos           → POST   /api/vendas
POST   /api/pedidos/:id/cancelar → POST /api/vendas/:id/cancelar
```
Breaking change: qualquer consumidor externo do `/api/pedidos` atual quebra. Único consumidor é o próprio `public/app.js`, atualizado junto (FR-07).

**Novas:**
```
Method + Path: GET /api/fornecedores
Success: 200 [{ id, nome, telefone, email, endereco, criadoEm }]

Method + Path: POST /api/fornecedores
Request body: { nome, telefone?, email?, endereco? }
Success: 201 { id, nome, telefone, email, endereco, criadoEm }
Errors: 400 — nome obrigatório

Method + Path: PUT /api/fornecedores/:id
Request body: { nome?, telefone?, email?, endereco? }
Success: 200 { ...fornecedor atualizado }
Errors: 404 — fornecedor não encontrado

Method + Path: DELETE /api/fornecedores/:id
Success: 204
Errors: 400 — fornecedor possui pedidos e não pode ser excluído

Method + Path: GET /api/pedidos
Success: 200 [{ id, fornecedorId, fornecedorNome, data, status, numeroNotaFiscal, dataNotaFiscal, observacoes, total, itens: [...] }]

Method + Path: GET /api/pedidos/:id
Success: 200 { ...mesmo shape acima }
Errors: 404 — pedido não encontrado

Method + Path: POST /api/pedidos
Request body: { fornecedorId, itens: [{ produtoId, quantidade, precoUnitCusto }], numeroNotaFiscal?, dataNotaFiscal?, observacoes? }
Success: 201 { ...pedido completo com itens }
Errors:
  400 — fornecedor obrigatório / não encontrado
  400 — pedido precisa de ao menos um item
  400 — produto não encontrado
  400 — quantidade ou preço inválido

Method + Path: POST /api/pedidos/:id/cancelar
Success: 200 { ...pedido atualizado, status: 'cancelado' }
Errors:
  404 — pedido não encontrado
  400 — pedido já está cancelado
```

## 10. Dependencies

| Dependency | Type | Owner | Risk |
|---|---|---|---|
| Migração de rename em produção (dados reais no volume Docker) | Infra/Dados | Dono do sistema | Alto — precisa ser testada antes de subir em cima dos dados reais |
| `scripts/migrar-json-para-mysql.js` (import de `data/db.json`) | Interno | Dono do sistema | Baixo — só relevante se ainda houver `db.json` legado não migrado |
| Versão do MySQL no `docker-compose.yml` (suporte a `ADD COLUMN IF NOT EXISTS`/checagem via `INFORMATION_SCHEMA`) | Infra | Dono do sistema | Baixo |

## 11. Edge cases and error handling

```
EC-01: Servidor sobe pela primeira vez (banco vazio) → migração de rename não encontra tabela `pedidos` antiga, não faz nada; `schema.sql` cria tudo do zero (vendas, pedidos/compras, fornecedores) normalmente.
EC-02: Servidor sobe numa base já migrada anteriormente (rename já rodou) → passo de migração deve detectar que `vendas` já existe e pular o rename sem erro.
EC-03: Pedido de compra criado com produto que não existe → 400, transação revertida, nenhum efeito colateral em estoque/caixa.
EC-04: Pedido de compra com quantidade <= 0 ou preço unitário negativo → 400, transação revertida.
EC-05: Cancelar um pedido de compra já cancelado → 400, sem duplicar estorno.
EC-06: Excluir fornecedor com pedidos vinculados → 400, bloqueado.
EC-07: Excluir produto referenciado em pedido de compra OU em venda → 400 nos dois casos.
EC-08: Dois pedidos de compra concorrentes para o mesmo produto → usar `SELECT ... FOR UPDATE` em `produtos` dentro da transação, igual ao padrão já usado em `vendas.js`/`produtos.js`, para evitar condição de corrida no estoque.
EC-09: Pedido de compra sem nota fiscal informada → campos `numeroNotaFiscal`/`dataNotaFiscal` gravados como `NULL`, sem erro de validação.
EC-10: Falha no meio da migração de rename (ex: queda de conexão) → como não há transação DDL no MySQL, a migração deve ser escrita em passos idempotentes e re-executáveis (checar existência antes de cada rename), para que uma nova tentativa na próxima subida do servidor complete o que faltou sem duplicar nem falhar.
```

## 12. Testing requirements

- **Unit tests:** não há suíte de testes automatizados no projeto hoje (fora de escopo introduzir framework de testes neste PRD); validar manualmente conforme checklist abaixo.
- **Integration tests:** N/A — mesmo motivo acima.
- **E2E tests:** N/A.
- **Manual testing checklist (obrigatório antes de considerar concluído):**
  - [ ] Subir o sistema com dados existentes (simulando produção) e confirmar que vendas antigas aparecem corretamente em `/api/vendas` e na tela "Vendas".
  - [ ] Confirmar que `movimentos_estoque` e `caixa` antigos mantiveram o vínculo correto (agora via `venda_id`).
  - [ ] Criar uma venda nova e confirmar baixa de estoque + lançamento de caixa.
  - [ ] Cancelar uma venda e confirmar estorno.
  - [ ] Cadastrar um fornecedor.
  - [ ] Criar um pedido de compra com 2+ produtos, com e sem nota fiscal, e confirmar: entrada de estoque, atualização de `preco_custo`, lançamento de caixa (saída), total calculado corretamente.
  - [ ] Cancelar um pedido de compra e confirmar reversão de estoque e estorno de caixa.
  - [ ] Tentar excluir produto/fornecedor/cliente vinculado e confirmar bloqueio com mensagem de erro.
  - [ ] Conferir relatório mensal antes e depois da mudança para o mesmo mês, validando que `vendas`, `custoProdutosVendidos`, `comprasDeMercadoria` e `lucro` não mudaram de valor.
- **Performance tests:** N/A — fora de escopo.

## 13. Observability

- **Logs:** manter o padrão atual (`console.error` no middleware de erro do Express); nenhum log estruturado novo exigido.
- **Metrics:** N/A — sistema não tem infraestrutura de métricas hoje.
- **Alerts:** N/A.
- **Dashboards:** N/A.

## 14. Rollout plan

- **Feature flag:** não aplicável — sistema de uso único/pequeno negócio, sem ambiente de staging separado; a migração precisa ser segura o suficiente para rodar direto em produção.
- **Rollout stages:** único deploy, mas em duas fases de trabalho sequenciais (ver seção de issues): (1) renomear Pedidos→Vendas e validar que nada quebrou, (2) só então criar o novo módulo de Pedidos (compras). Isso limita o raio de impacto de qualquer problema de migração.
- **Rollback trigger:** se após o deploy a tela de Vendas não carregar os pedidos antigos, ou o total/saldo do caixa divergir do esperado.
- **Rollback procedure:** antes de aplicar a migração em produção, fazer backup do volume MySQL (`docker compose exec db mysqldump ...` ou snapshot do volume Docker `controle-vendas-mysql-data`). Se algo falhar, restaurar o backup e reverter o deploy do código para a versão anterior (que ainda espera tabela `pedidos` com sentido de venda).

## 15. Open questions

| # | Question | Owner | Deadline | Status |
|---|---|---|---|---|
| 1 | Qual a versão exata do MySQL usada no `docker-compose.yml`? Define se dá para usar `ADD COLUMN IF NOT EXISTS` direto ou se precisa checar `INFORMATION_SCHEMA` manualmente na migração. | Dono do sistema | Antes de implementar a issue de migração de schema | Open |
| 2 | Existe algum backup atual do volume `controle-vendas-mysql-data` antes de aplicarmos a migração em produção? | Dono do sistema | Antes do deploy da Fase 1 (rename) | Open |

## 16. Success metrics

- Qualitativo: dono do sistema consegue registrar uma compra de múltiplos produtos em uma única tela, sem precisar lançar entrada de estoque produto a produto.
- Qualitativo: nenhuma referência a "Pedido" com sentido de venda sobra na interface ou na API depois da Fase 1.
- Quantitativo: zero perda de registros de venda/estoque/caixa após a migração (contagem de linhas nas tabelas antes/depois do rename deve bater).
- Quantitativo: relatório mensal de um mês fechado antes da migração deve retornar exatamente os mesmos valores (`vendas`, `custoProdutosVendidos`, `lucro`) depois da migração.

---

PRD complete. Next steps in the workflow:
- Run `/create-issues` to break this PRD into ordered, atomic development issues
- Or run `/grill-me` again if any section above exposed a gap that needs clarification first
