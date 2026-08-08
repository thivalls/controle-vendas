# Controle de Vendas

Sistema simples para controlar clientes, fornecedores, produtos, estoque, vendas, pedidos de compra e relatório de vendas.

Os dados são armazenados num banco **MySQL**, que roda como um serviço dentro do Docker Compose junto com a aplicação. O jeito recomendado de usar é via Docker.

## Como usar (recomendado: Docker)

1. Instale o [Docker](https://docs.docker.com/get-docker/) e o Docker Compose.
2. Abra um terminal dentro desta pasta (`controle-vendas`).
3. Rode:
   ```
   ./subir.sh
   ```
   Esse script único sobe os dois containers (app + MySQL) e espera o sistema ficar pronto. Se preferir, o equivalente manual é `docker compose up -d --build`.

   Isso sobe dois containers: o app (`controle-vendas`, porta 3000) e o MySQL (`controle-vendas-db`, porta 3306). O banco fica guardado num volume Docker persistido (`controle-vendas-mysql-data`), então os dados continuam salvos mesmo depois de parar, recriar ou atualizar os containers.
4. Abra o navegador em: **http://localhost:3000**
5. Para encerrar, rode:
   ```
   docker compose down
   ```
   (os dados continuam salvos no volume, mesmo depois de `down`)

Para ver os logs: `docker compose logs -f`. Para apagar também os dados salvos: `docker compose down -v`.

### Migrando dados antigos do arquivo `data/db.json`

Versões anteriores deste sistema guardavam tudo num arquivo `data/db.json`. Se você tem esse arquivo com dados reais, pode importá-los para o MySQL uma única vez:

1. Suba o ambiente com `docker compose up -d --build` (o MySQL precisa estar no ar).
2. Instale as dependências localmente (só uma vez): `npm install`.
3. Rode: `npm run migrate`.

O script só importa os dados se as tabelas do MySQL ainda estiverem vazias, evitando duplicidade.

### Acessando o banco diretamente

A porta 3306 do MySQL fica exposta na sua máquina, então você pode conectar com qualquer cliente MySQL (DBeaver, TablePlus, `mysql` no terminal etc.) usando:
- Host: `localhost`, porta `3306`
- Usuário: `controle`, senha: `controle`
- Banco: `controle_vendas`

## Rodando sem Docker (alternativa)

Se preferir, você pode rodar o Node diretamente, desde que tenha um MySQL acessível (local ou remoto). Configure as variáveis de ambiente `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` e `DB_NAME` (veja os valores padrão em [src/db.js](src/db.js)), depois:
```
npm install
npm start
```
O schema das tabelas é criado automaticamente na primeira execução.

## O que o sistema faz

- **Clientes**: cadastro com nome, telefone, e-mail e endereço.
- **Fornecedores**: cadastro com nome, telefone, e-mail e endereço, usado nos pedidos de compra.
- **Produtos**: cadastro com preço de custo, preço de venda e estoque.
- **Estoque**: registre entradas (quando comprar mais mercadoria) e saídas manuais (perdas/ajustes). Esses lançamentos avulsos convivem com os Pedidos abaixo — use-os para ajustes pontuais que não sejam uma compra formal.
- **Vendas**: escolha o cliente e os produtos vendidos, com data da venda e data de pagamento. O sistema calcula o total e baixa o estoque automaticamente. Vendas podem ser canceladas (devolve o estoque).
- **Pedidos**: registre uma compra de mercadoria de um fornecedor, com vários produtos, quantidade e preço unitário — igual a uma nota fiscal (o número/data da nota são opcionais). O sistema dá entrada no estoque e atualiza o preço de custo dos produtos com o valor pago. Pedidos podem ser cancelados (reverte a entrada de estoque).
- **Relatório**: lista as vendas com filtros por período, cliente, status, situação de pagamento, forma de pagamento e produtos, mostrando total vendido, custo dos produtos vendidos e margem bruta do período filtrado.
