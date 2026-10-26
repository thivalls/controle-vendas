# Issues: Ajuste de Estoque via Importação de Planilha (XLSX)

Baseado em [`docs/prd-ajuste-estoque-importacao.md`](./prd-ajuste-estoque-importacao.md).

Feature única, sem migração de schema (o PRD já descarta essa necessidade — reaproveita `skus.estoque` e `movimentos_estoque` como existem hoje). Cinco issues, duas trilhas que podem rodar em paralelo depois da primeira.

## Dependency graph

```
1. [api]      Endpoint de prévia de importação de estoque (upload + validação + classificação)
2. [api]      Endpoint de aplicação dos ajustes de estoque                              ← depende de 1
3. [frontend] Tela de importação de estoque (upload → prévia)                            ← depende de 1
4. [frontend] Tela de importação de estoque (confirmar → resultado)                      ← depende de 2, 3
5. [docs]     Atualizar README com a nova funcionalidade                                 ← depende de 4
```

---

### Issue 1 — [api] Endpoint de prévia de importação de estoque

**Goal:** Receber o XLSX de contagem física, validar sua estrutura e devolver, sem gravar nada no banco, uma classificação linha a linha do que mudaria se o ajuste fosse aplicado.

**Context:** Novo endpoint em `src/routes/skus.js`, junto dos demais endpoints de SKU (`GET /exportar-estoque` já existe ali e serve de referência de formato — mesmas colunas ID/Código/Nome/Estoque sistema/Estoque real). Usar `multer` (já é dependência, ver uso em `src/routes/produtos.js` para upload de imagem — usar `memoryStorage()` aqui, não precisa persistir o arquivo em disco) e `exceljs` (já é dependência, usado hoje só pra exportar) pra ler o buffer recebido. Colunas devem ser identificadas pelo **texto do cabeçalho**, não pela posição (FR-04) — não presumir que a ordem das colunas é sempre ID/Código/Nome/Estoque sistema/Estoque real. Extrair a lógica de classificação linha a linha (comparar `estoqueReal` da planilha com `skus.estoque` atual) numa função separada e reutilizável, porque a Issue 2 precisa da mesma lógica pra recalcular no momento da aplicação — não duplicar esse cálculo.

**Acceptance criteria:**
- [ ] `POST /api/skus/importar-estoque` aceita multipart/form-data com campo `arquivo` e devolve `{ linhas: [...], resumo: {...} }` (ver contrato completo no PRD, seção 9), sem alterar `skus.estoque` nem `movimentos_estoque`.
- [ ] Cada linha é classificada corretamente em uma das 6 categorias: `entrada`, `saida`, `sem_alteracao`, `ignorado_nao_contado`, `ignorado_sku_nao_encontrado`, `ignorado_valor_invalido` (FR-08 a FR-13).
- [ ] Arquivo sem extensão/mimetype de XLSX → 400, nenhuma linha processada.
- [ ] Arquivo maior que 5MB → 413.
- [ ] Planilha sem as colunas "ID" ou "Estoque real" (procuradas pelo texto do cabeçalho) → 400 com mensagem indicando quais faltam.
- [ ] Planilha com IDs duplicados → 400 com a lista dos IDs duplicados, nenhuma prévia gerada.
- [ ] Reordenar colunas manualmente na planilha exportada não quebra a leitura (teste manual).

**Out of scope:** Gravar qualquer ajuste no banco (Issue 2); interface de upload (Issue 3).

**Edge cases to handle:**
- Célula "Estoque real" em branco → `ignorado_nao_contado`, não confundir com zero (FR-08, EC-01).
- Célula "Estoque real" com `0` explícito → tratado como valor real (EC-02).
- Valor não numérico ou negativo em "Estoque real" → `ignorado_valor_invalido` (FR-10).
- ID que não corresponde a nenhum SKU (SKU excluído após a exportação) → `ignorado_sku_nao_encontrado` (FR-09), sem interromper a leitura das demais linhas.
- SKU existente que não aparece na planilha → simplesmente não entra na resposta, sem erro (EC-04).

**Depends on:** none

**Suggested tests:**
- Manual: exportar a planilha atual, reenviar sem alterar nada → todas as linhas `sem_alteracao`.
- Manual: editar valores variados (branco, 0, número maior, número menor, texto inválido, ID inexistente, ID duplicado) e conferir a classificação de cada caso na resposta JSON (via curl ou devtools, já que a UI ainda não existe nesta issue).
- Manual: reordenar colunas da planilha antes de enviar, confirmar que a leitura por cabeçalho continua funcionando.

**Complexity:** M — várias regras de classificação e validação de arquivo, mas sem tocar em escrita/transação.

---

### Issue 2 — [api] Endpoint de aplicação dos ajustes de estoque

**Goal:** Receber a lista de linhas a ajustar (vinda da prévia) e efetivamente atualizar o estoque de cada SKU, registrando o movimento correspondente — sem tocar em caixa.

**Context:** Novo endpoint em `src/routes/skus.js`, ao lado do da Issue 1. Reutilizar a função de classificação/cálculo de diferença extraída na Issue 1 pra recalcular cada linha com base no estoque **atual** do SKU (FR-17) — nunca confiar no valor de diferença que veio da prévia, que pode estar desatualizado. Cada linha é uma transação própria (padrão já usado em `POST /:id/entrada` e `POST /:id/saida` no mesmo arquivo: `pool.getConnection()` + `beginTransaction()`/`commit()`/`rollback()` por linha, não uma transação única pro payload inteiro). Diferente do endpoint de entrada existente, este **nunca** cria lançamento em `caixa`, mesmo quando aumenta o estoque.

**Acceptance criteria:**
- [ ] `POST /api/skus/importar-estoque/aplicar` recebe `{ linhas: [{ skuId, estoqueReal }] }` e devolve `{ aplicados: [...], ignorados: [...] }` (contrato completo no PRD, seção 9).
- [ ] Cada linha aplicada atualiza `skus.estoque` e cria um registro em `movimentos_estoque` (`tipo` `entrada` ou `saida` conforme a diferença, `motivo = 'Ajuste de estoque (inventário)'`).
- [ ] Nenhuma linha aplicada por este endpoint cria registro em `caixa`, em nenhuma direção (testar explicitamente aumento e diminuição de estoque).
- [ ] Uma linha com `skuId` que não existe mais no banco no momento da aplicação é reportada em `ignorados`, sem impedir a aplicação das demais linhas do payload.
- [ ] Payload sem nenhuma linha, ou malformado, retorna 400 sem aplicar nada.

**Out of scope:** Calcular a classificação original (reaproveita a lógica da Issue 1); interface de confirmação (Issue 4).

**Edge cases to handle:**
- Diferença recalculada no momento da aplicação for zero (estoque já mudou por outro motivo entre a prévia e a confirmação, e agora bate) → não gerar movimento nenhum pra essa linha, reportar como aplicado-sem-efeito ou já correto (decidir na implementação e documentar no PR).
- SKU excluído entre a prévia e a confirmação → linha cai em `ignorados`, resto do payload processado normalmente (FR-21).
- Falha ao aplicar uma linha específica (ex: erro de banco pontual) → não deve abortar as linhas seguintes do mesmo payload.

**Depends on:** Issue 1

**Suggested tests:**
- **Testar em um container Docker + banco MySQL isolados, não no banco real** — este endpoint muta estoque em lote (ver PRD, seção 12).
- Manual: aplicar um payload misto (uma linha de entrada, uma de saída, uma com SKU inexistente) e conferir `aplicados`/`ignorados`, o novo `estoque` de cada SKU, os `movimentos_estoque` gerados, e confirmar que **nenhum** lançamento apareceu em `caixa`.
- Manual: aplicar o mesmo payload duas vezes seguidas — a segunda vez deve gerar diferença zero pra tudo (idempotência natural, já que recalcula do estoque atual).

**Complexity:** S — lógica de classificação já existe (Issue 1); o que resta é a transação por linha e a garantia de não tocar caixa.

---

### Issue 3 — [frontend] Tela de importação de estoque (upload → prévia)

**Goal:** Dar ao usuário uma tela pra escolher o arquivo de contagem e ver, antes de qualquer coisa ser gravada, exatamente o que vai mudar.

**Context:** Nova página `public/ajuste-estoque.html` + `public/js/ajuste-estoque.js`, seguindo o padrão visual das outras páginas (`.panel`, `header`/`sidebar` já montados por `common.js`/`initSidebar`). Adicionar um link/botão "Ajustar estoque (importar XLSX)" em `public/skus.html`, ao lado do botão "Exportar estoque (XLSX)" já existente. A tabela de prévia **não** deve reaproveitar `criarTabela`/`data-table.js` (esse componente é pra listagens com busca/paginação/ações por linha; aqui é uma tabela de diff estática, mais parecida com a renderização manual já usada em `public/app.js` pra Vendas/Estoque/Pedidos — usar esse padrão de `tbody.innerHTML` direto). Chama `POST /api/skus/importar-estoque` (Issue 1) ao enviar o arquivo.

**Acceptance criteria:**
- [ ] Selecionar um `.xlsx` e clicar em "Enviar" mostra a prévia: resumo no topo (contagem por classificação) + tabela linha a linha.
- [ ] Linhas `entrada`/`saida` têm destaque visual (ex: `badge` como já usado em outras telas); linhas `sem_alteracao` e as categorias `ignorado_*` aparecem com tratamento visual discreto (menor destaque, ou agrupadas/colapsáveis).
- [ ] Erros do backend (arquivo inválido, colunas faltando, IDs duplicados) aparecem como mensagem clara na tela, sem quebrar a página.
- [ ] Link "Ajustar estoque (importar XLSX)" aparece em `skus.html` e leva pra nova página.

**Out of scope:** Botão de confirmar e aplicar o ajuste, e tela de resultado (Issue 4) — nesta issue a prévia é só exibida, sem ação de gravar.

**Edge cases to handle:**
- Nenhum arquivo selecionado ao clicar "Enviar" → validação no frontend, sem chamar a API.
- Prévia com zero linhas em `entrada`/`saida` (planilha sem nenhuma mudança real) → mensagem deixando isso claro, não uma tabela vazia sem explicação.
- Nomes de SKU vindos da planilha devem passar por `escaparHtml` (já usado em todo o resto do frontend) antes de entrar no HTML da prévia.

**Depends on:** Issue 1

**Suggested tests:**
- Manual (obrigatório, é UI nova): no navegador, subir a planilha de exportação sem alterar nada, com alterações válidas, e com um arquivo inválido — conferir os três casos visualmente.

**Complexity:** M — página nova, renderização de tabela com várias categorias visuais e estados de erro.

---

### Issue 4 — [frontend] Tela de importação de estoque (confirmar → resultado)

**Goal:** Permitir confirmar a prévia já exibida e mostrar, de forma igualmente clara, o que foi de fato ajustado.

**Context:** Continuação de `public/ajuste-estoque.html`/`ajuste-estoque.js` (Issue 3). Adiciona o botão "Confirmar ajustes", que envia pra `POST /api/skus/importar-estoque/aplicar` (Issue 2) só as linhas classificadas como `entrada`/`saida` da prévia já carregada em memória no frontend (não precisa reenviar o arquivo). Tela de resultado reaproveita a mesma estrutura visual da prévia (tabela + resumo), trocando "o que vai mudar" por "o que mudou".

**Acceptance criteria:**
- [ ] Botão "Confirmar ajustes" só fica habilitado quando a prévia tem ao menos uma linha `entrada`/`saida`.
- [ ] Ao confirmar, a tela mostra o resultado: linhas aplicadas (estoque antes → depois, tipo de movimento) e linhas ignoradas/com erro (motivo).
- [ ] Existe uma ação clara pra iniciar um novo ajuste (novo upload) a partir da tela de resultado, sem precisar dar F5.
- [ ] Erro de rede/servidor ao confirmar é exibido de forma clara, sem perder a prévia já carregada (usuário pode tentar de novo sem reenviar o arquivo).

**Out of scope:** Qualquer forma de desfazer um ajuste já aplicado (non-goal explícito do PRD).

**Edge cases to handle:**
- Resultado parcial (algumas linhas aplicadas, outras com erro) → deixar isso visualmente óbvio, não só um "sucesso" genérico.
- Confirmar duas vezes seguidas sem recarregar (double-click) → evitar POST duplicado (desabilitar o botão durante a chamada).

**Depends on:** Issue 2, Issue 3

**Suggested tests:**
- **Testar em um container Docker + banco MySQL isolados, não no banco real** — este fluxo aplica ajustes de verdade (ver PRD, seção 12).
- Manual: rodar a checklist completa da seção 12 do PRD de ponta a ponta pelo navegador (roundtrip sem alteração, entrada, saída, branco, zero explícito, SKU excluído, ID duplicado, arquivo inválido, coluna faltando, colunas reordenadas), incluindo conferir que nada aparece em Caixa.

**Complexity:** S — reaproveita toda a estrutura visual e de estado já construída na Issue 3.

---

### Issue 5 — [docs] Atualizar README com a nova funcionalidade

**Goal:** Documentar a nova funcionalidade de ajuste de estoque via importação, do mesmo jeito que o restante do sistema já é documentado no README.

**Context:** `README.md` já descreve os módulos do sistema (ver como o export de estoque em XLSX está documentado, se estiver, como referência de tom/nível de detalhe).

**Acceptance criteria:**
- [ ] README menciona a funcionalidade de ajuste de estoque via importação de XLSX, incluindo o fluxo básico (exportar → preencher → importar → conferir prévia → confirmar).
- [ ] README deixa claro que o ajuste não gera lançamento em caixa (evita confusão futura com o fluxo de compra/entrada normal).

**Out of scope:** Documentação de API (contrato dos endpoints) — não há padrão de doc de API separado no projeto hoje.

**Edge cases to handle:** N/A — issue de documentação.

**Depends on:** Issue 4

**Suggested tests:**
- Manual: revisão de leitura (a documentação bate com o comportamento real da feature já implementada).

**Complexity:** XS

---

## Risks and open questions

- [Risk] A lógica de classificação (comparar `estoqueReal` vs `skus.estoque`) precisa ser genuinamente compartilhada entre os endpoints de prévia (Issue 1) e aplicação (Issue 2) — se cada um implementar essa comparação de forma independente, os dois podem divergir silenciosamente com o tempo → mitigação: extrair numa função só, usada pelos dois endpoints, conforme já indicado no Context da Issue 1.
- [Risk] Aplicação linha por linha (não transacional pro lote inteiro) significa que uma falha no meio de um lote grande deixa o sistema em estado parcialmente aplicado → aceito no PRD (seção 6, Reliability) dado o baixo volume e o uso solo; o resultado reportado (Issue 2/4) precisa deixar isso visível pro usuário.
- [Open] Limite de tamanho de arquivo (5MB, FR-03) foi inferido do precedente de upload de imagem em `produtos.js`, não confirmado pelo dono do sistema — ver PRD, seção 15, item 1. Confirmar antes de travar o valor na Issue 1.

## Parallel tracks

Track A (backend de aplicação): 1 → 2
Track B (frontend de prévia):    1 → 3
Ambas as trilhas se encontram em: 4 → 5
