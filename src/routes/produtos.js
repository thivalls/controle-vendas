const express = require('express');
const { pool } = require('../db');
const asyncHandler = require('../asyncHandler');

const router = express.Router();

function mapProduto(row) {
  return {
    id: row.id,
    nome: row.nome,
    precoCusto: row.preco_custo,
    precoVenda: row.preco_venda,
    estoque: row.estoque,
    criadoEm: row.criado_em
  };
}

function mapMovimento(row) {
  return {
    id: row.id,
    produtoId: row.produto_id,
    tipo: row.tipo,
    quantidade: row.quantidade,
    motivo: row.motivo,
    data: row.data,
    vendaId: row.venda_id || undefined,
    pedidoId: row.pedido_id || undefined
  };
}

router.get('/', asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM produtos ORDER BY id');
  res.json(rows.map(mapProduto));
}));

router.post('/', asyncHandler(async (req, res) => {
  const { nome, precoCusto, precoVenda, estoqueInicial, lancarCompraNoCaixa } = req.body;
  if (!nome || !nome.trim()) {
    return res.status(400).json({ erro: 'Nome é obrigatório' });
  }
  const custo = Number(precoCusto);
  const venda = Number(precoVenda);
  const estoque = Number(estoqueInicial) || 0;
  if (isNaN(custo) || custo < 0 || isNaN(venda) || venda < 0) {
    return res.status(400).json({ erro: 'Preço de custo e preço de venda devem ser números válidos' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const data = new Date();
    const nomeTrim = nome.trim();

    const [result] = await conn.query(
      'INSERT INTO produtos (nome, preco_custo, preco_venda, estoque, criado_em) VALUES (?, ?, ?, ?, ?)',
      [nomeTrim, custo, venda, estoque, data]
    );
    const produtoId = result.insertId;

    if (estoque > 0) {
      await conn.query(
        `INSERT INTO movimentos_estoque (produto_id, tipo, quantidade, motivo, data)
         VALUES (?, 'entrada', ?, 'Estoque inicial', ?)`,
        [produtoId, estoque, data]
      );

      // Por padrão, já lança a compra desse estoque inicial no caixa (evita lançamento manual sujeito a erro)
      if (custo > 0 && lancarCompraNoCaixa !== false && lancarCompraNoCaixa !== 'false') {
        await conn.query(
          `INSERT INTO caixa (tipo, categoria, valor, descricao, data)
           VALUES ('saida', 'Compra de mercadoria', ?, ?, ?)`,
          [estoque * custo, `Estoque inicial de ${nomeTrim} (${estoque}x)`, data]
        );
      }
    }

    await conn.commit();
    const [rows] = await pool.query('SELECT * FROM produtos WHERE id = ?', [produtoId]);
    res.status(201).json(mapProduto(rows[0]));
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [rows] = await pool.query('SELECT * FROM produtos WHERE id = ?', [id]);
  if (rows.length === 0) return res.status(404).json({ erro: 'Produto não encontrado' });
  const atual = rows[0];
  const { nome, precoCusto, precoVenda } = req.body;
  await pool.query(
    'UPDATE produtos SET nome = ?, preco_custo = ?, preco_venda = ? WHERE id = ?',
    [
      nome !== undefined ? nome : atual.nome,
      precoCusto !== undefined ? Number(precoCusto) : atual.preco_custo,
      precoVenda !== undefined ? Number(precoVenda) : atual.preco_venda,
      id
    ]
  );
  const [atualizado] = await pool.query('SELECT * FROM produtos WHERE id = ?', [id]);
  res.json(mapProduto(atualizado[0]));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [itensVenda] = await pool.query('SELECT id FROM venda_itens WHERE produto_id = ? LIMIT 1', [id]);
  if (itensVenda.length > 0) {
    return res.status(400).json({ erro: 'Produto possui vendas e não pode ser excluído' });
  }
  const [itensPedido] = await pool.query('SELECT id FROM pedido_itens WHERE produto_id = ? LIMIT 1', [id]);
  if (itensPedido.length > 0) {
    return res.status(400).json({ erro: 'Produto possui pedidos e não pode ser excluído' });
  }
  await pool.query('DELETE FROM produtos WHERE id = ?', [id]);
  res.status(204).end();
}));

// Registrar entrada de estoque (ex: comprou mais produto para revender)
router.post('/:id/entrada', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const quantidade = Number(req.body.quantidade);
  const custoTotal = req.body.custoTotal !== undefined ? Number(req.body.custoTotal) : null;
  if (!quantidade || quantidade <= 0) {
    return res.status(400).json({ erro: 'Quantidade deve ser maior que zero' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM produtos WHERE id = ? FOR UPDATE', [id]);
    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ erro: 'Produto não encontrado' });
    }
    const produto = rows[0];
    const data = new Date();

    await conn.query('UPDATE produtos SET estoque = estoque + ? WHERE id = ?', [quantidade, id]);

    const motivo = req.body.motivo || 'Compra de mercadoria';
    const [movResult] = await conn.query(
      `INSERT INTO movimentos_estoque (produto_id, tipo, quantidade, motivo, data) VALUES (?, 'entrada', ?, ?, ?)`,
      [id, quantidade, motivo, data]
    );

    // Se informou o custo total pago, lança automaticamente como saída no caixa
    if (custoTotal !== null && custoTotal > 0) {
      await conn.query(
        `INSERT INTO caixa (tipo, categoria, valor, descricao, data)
         VALUES ('saida', 'Compra de mercadoria', ?, ?, ?)`,
        [custoTotal, `Compra de ${quantidade}x ${produto.nome}`, data]
      );
    }

    await conn.commit();
    const [produtoAtualizado] = await pool.query('SELECT * FROM produtos WHERE id = ?', [id]);
    const [movimentoRows] = await pool.query('SELECT * FROM movimentos_estoque WHERE id = ?', [movResult.insertId]);
    res.status(201).json({ produto: mapProduto(produtoAtualizado[0]), movimento: mapMovimento(movimentoRows[0]) });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

// Registrar saída de estoque manual (ex: perda, quebra, uso próprio)
router.post('/:id/saida', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const quantidade = Number(req.body.quantidade);
  if (!quantidade || quantidade <= 0) {
    return res.status(400).json({ erro: 'Quantidade deve ser maior que zero' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM produtos WHERE id = ? FOR UPDATE', [id]);
    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ erro: 'Produto não encontrado' });
    }
    const produto = rows[0];
    if (quantidade > produto.estoque) {
      await conn.rollback();
      return res.status(400).json({ erro: 'Estoque insuficiente' });
    }
    const data = new Date();

    await conn.query('UPDATE produtos SET estoque = estoque - ? WHERE id = ?', [quantidade, id]);

    const motivo = req.body.motivo || 'Ajuste manual';
    const [movResult] = await conn.query(
      `INSERT INTO movimentos_estoque (produto_id, tipo, quantidade, motivo, data) VALUES (?, 'saida', ?, ?, ?)`,
      [id, quantidade, motivo, data]
    );

    await conn.commit();
    const [produtoAtualizado] = await pool.query('SELECT * FROM produtos WHERE id = ?', [id]);
    const [movimentoRows] = await pool.query('SELECT * FROM movimentos_estoque WHERE id = ?', [movResult.insertId]);
    res.status(201).json({ produto: mapProduto(produtoAtualizado[0]), movimento: mapMovimento(movimentoRows[0]) });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

router.get('/:id/movimentos', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [rows] = await pool.query(
    'SELECT * FROM movimentos_estoque WHERE produto_id = ? ORDER BY data DESC, id DESC',
    [id]
  );
  res.json(rows.map(mapMovimento));
}));

module.exports = router;
