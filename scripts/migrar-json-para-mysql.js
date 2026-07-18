// Migração única dos dados antigos de data/db.json (armazenamento em arquivo)
// para o MySQL. Rode manualmente com o MySQL do docker-compose no ar:
//   npm run migrate
// Só insere dados se as tabelas do MySQL ainda estiverem vazias.

const fs = require('fs');
const path = require('path');
const { pool, waitForDb, initSchema } = require('../src/db');

const ARQUIVO_LEGADO = path.join(__dirname, '..', 'data', 'db.json');

async function migrar() {
  if (!fs.existsSync(ARQUIVO_LEGADO)) {
    console.log('Nenhum arquivo data/db.json encontrado. Nada para migrar.');
    return;
  }

  await waitForDb();
  await initSchema();

  const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM clientes');
  if (total > 0) {
    console.log('O banco já possui dados. Migração cancelada para evitar duplicidade.');
    return;
  }

  const dados = JSON.parse(fs.readFileSync(ARQUIVO_LEGADO, 'utf-8'));

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');

    for (const c of dados.clientes || []) {
      await conn.query(
        'INSERT INTO clientes (id, nome, telefone, email, endereco, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
        [c.id, c.nome, c.telefone || '', c.email || '', c.endereco || '', new Date(c.criadoEm)]
      );
    }

    for (const p of dados.produtos || []) {
      await conn.query(
        'INSERT INTO produtos (id, nome, preco_custo, preco_venda, estoque, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
        [p.id, p.nome, p.precoCusto, p.precoVenda, p.estoque, new Date(p.criadoEm)]
      );
    }

    // O db.json legado só continha vendas ao cliente (nunca teve pedidos de compra/fornecedores),
    // por isso grava direto nas tabelas de venda já renomeadas.
    for (const v of dados.pedidos || []) {
      await conn.query(
        'INSERT INTO vendas (id, cliente_id, data, status, forma_pagamento, observacoes, total) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [v.id, v.clienteId, new Date(v.data), v.status, v.formaPagamento || '', v.observacoes || '', v.total]
      );
      for (const item of v.itens || []) {
        await conn.query(
          'INSERT INTO venda_itens (venda_id, produto_id, quantidade, preco_unit_venda, preco_unit_custo) VALUES (?, ?, ?, ?, ?)',
          [v.id, item.produtoId, item.quantidade, item.precoUnitVenda, item.precoUnitCusto]
        );
      }
    }

    for (const m of dados.movimentosEstoque || []) {
      await conn.query(
        'INSERT INTO movimentos_estoque (id, produto_id, tipo, quantidade, motivo, data, venda_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [m.id, m.produtoId, m.tipo, m.quantidade, m.motivo || '', new Date(m.data), m.pedidoId || null]
      );
    }

    for (const l of dados.caixa || []) {
      await conn.query(
        'INSERT INTO caixa (id, tipo, categoria, valor, descricao, data, venda_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [l.id, l.tipo, l.categoria || 'Outros', l.valor, l.descricao || '', new Date(l.data), l.pedidoId || null]
      );
    }

    // Ajusta os contadores AUTO_INCREMENT para continuar a partir do maior id migrado
    const tabelas = ['clientes', 'produtos', 'vendas', 'venda_itens', 'movimentos_estoque', 'caixa'];
    for (const tabela of tabelas) {
      const [[{ maxId }]] = await conn.query(`SELECT COALESCE(MAX(id), 0) AS maxId FROM ${tabela}`);
      if (maxId > 0) {
        await conn.query(`ALTER TABLE ${tabela} AUTO_INCREMENT = ?`, [maxId + 1]);
      }
    }

    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    await conn.commit();
    console.log('Migração concluída com sucesso.');
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

migrar()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Falha na migração:', err);
    process.exit(1);
  });
