const express = require('express');
const path = require('path');

const { waitForDb, initSchema } = require('./db');

const clientesRouter = require('./routes/clientes');
const fornecedoresRouter = require('./routes/fornecedores');
const skusRouter = require('./routes/skus');
const produtosRouter = require('./routes/produtos');
const estoqueRouter = require('./routes/estoque');
const vendasRouter = require('./routes/vendas');
const pedidosRouter = require('./routes/pedidos');
const relatoriosRouter = require('./routes/relatorios');
const caixaRouter = require('./routes/caixa');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/clientes', clientesRouter);
app.use('/api/fornecedores', fornecedoresRouter);
app.use('/api/skus', skusRouter);
app.use('/api/produtos', produtosRouter);
app.use('/api/estoque', estoqueRouter);
app.use('/api/vendas', vendasRouter);
app.use('/api/pedidos', pedidosRouter);
app.use('/api/relatorios', relatoriosRouter);
app.use('/api/caixa', caixaRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ erro: 'Erro interno do servidor' });
});

async function iniciar() {
  await waitForDb();
  await initSchema();
  app.listen(PORT, () => {
    console.log(`Sistema de controle de vendas rodando em http://localhost:${PORT}`);
  });
}

iniciar().catch(err => {
  console.error('Falha ao iniciar o servidor:', err);
  process.exit(1);
});
