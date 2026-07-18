const express = require('express');
const { pool } = require('../db');
const asyncHandler = require('../asyncHandler');

const router = express.Router();

function mapPedido(row) {
  return {
    id: row.id,
    fornecedorId: row.fornecedor_id,
    data: row.data,
    status: row.status,
    numeroNotaFiscal: row.numero_nota_fiscal || undefined,
    dataNotaFiscal: row.data_nota_fiscal || undefined,
    observacoes: row.observacoes,
    total: row.total,
    fornecedorNome: row.fornecedor_nome || '(fornecedor removido)'
  };
}

function mapItem(row) {
  return {
    produtoId: row.produto_id,
    quantidade: row.quantidade,
    precoUnitCusto: row.preco_unit_custo,
    produtoNome: row.produto_nome || '(produto removido)'
  };
}

async function buscarPedidosComItens(whereSql = '', params = []) {
  const [pedidoRows] = await pool.query(
    `SELECT ped.*, forn.nome AS fornecedor_nome
     FROM pedidos ped
     LEFT JOIN fornecedores forn ON forn.id = ped.fornecedor_id
     ${whereSql}
     ORDER BY ped.data DESC, ped.id DESC`,
    params
  );
  if (pedidoRows.length === 0) return [];

  const ids = pedidoRows.map(p => p.id);
  const [itemRows] = await pool.query(
    `SELECT pi.*, prod.nome AS produto_nome
     FROM pedido_itens pi
     LEFT JOIN produtos prod ON prod.id = pi.produto_id
     WHERE pi.pedido_id IN (?)`,
    [ids]
  );

  const itensPorPedido = new Map();
  for (const item of itemRows) {
    if (!itensPorPedido.has(item.pedido_id)) itensPorPedido.set(item.pedido_id, []);
    itensPorPedido.get(item.pedido_id).push(mapItem(item));
  }

  return pedidoRows.map(p => ({
    ...mapPedido(p),
    itens: itensPorPedido.get(p.id) || []
  }));
}

router.get('/', asyncHandler(async (req, res) => {
  const pedidos = await buscarPedidosComItens();
  res.json(pedidos);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [pedido] = await buscarPedidosComItens('WHERE ped.id = ?', [id]);
  if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado' });
  res.json(pedido);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { fornecedorId, itens, numeroNotaFiscal, dataNotaFiscal, observacoes } = req.body;

  if (!fornecedorId) return res.status(400).json({ erro: 'Fornecedor é obrigatório' });
  if (!Array.isArray(itens) || itens.length === 0) {
    return res.status(400).json({ erro: 'O pedido precisa ter ao menos um item' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [fornecedorRows] = await conn.query('SELECT * FROM fornecedores WHERE id = ?', [Number(fornecedorId)]);
    if (fornecedorRows.length === 0) {
      await conn.rollback();
      return res.status(400).json({ erro: 'Fornecedor não encontrado' });
    }
    const fornecedor = fornecedorRows[0];

    const produtoIds = [...new Set(itens.map(i => Number(i.produtoId)))];
    const [produtoRows] = await conn.query('SELECT * FROM produtos WHERE id IN (?) FOR UPDATE', [produtoIds]);
    const produtosPorId = Object.fromEntries(produtoRows.map(p => [p.id, p]));

    // Junta linhas do mesmo produto (com o mesmo preço unitário) em uma única, somando as quantidades
    const itensPorChave = new Map();
    for (const item of itens) {
      const produto = produtosPorId[Number(item.produtoId)];
      if (!produto) {
        await conn.rollback();
        return res.status(400).json({ erro: `Produto ${item.produtoId} não encontrado` });
      }
      const quantidade = Number(item.quantidade);
      if (!quantidade || quantidade <= 0) {
        await conn.rollback();
        return res.status(400).json({ erro: `Quantidade inválida para ${produto.nome}` });
      }
      const precoUnitCusto = Number(item.precoUnitCusto);
      if (isNaN(precoUnitCusto) || precoUnitCusto < 0) {
        await conn.rollback();
        return res.status(400).json({ erro: `Preço unitário inválido para ${produto.nome}` });
      }
      const chave = `${produto.id}|${precoUnitCusto}`;
      if (itensPorChave.has(chave)) {
        itensPorChave.get(chave).quantidade += quantidade;
      } else {
        itensPorChave.set(chave, {
          produtoId: produto.id,
          quantidade,
          precoUnitCusto
        });
      }
    }

    const itensProcessados = [...itensPorChave.values()];
    const total = itensProcessados.reduce((soma, i) => soma + i.quantidade * i.precoUnitCusto, 0);
    const data = new Date();

    const [pedidoResult] = await conn.query(
      `INSERT INTO pedidos (fornecedor_id, data, status, numero_nota_fiscal, data_nota_fiscal, observacoes, total)
       VALUES (?, ?, 'concluido', ?, ?, ?, ?)`,
      [Number(fornecedorId), data, numeroNotaFiscal || null, dataNotaFiscal || null, observacoes || '', total]
    );
    const pedidoId = pedidoResult.insertId;

    for (const item of itensProcessados) {
      const produto = produtosPorId[item.produtoId];
      await conn.query(
        `INSERT INTO pedido_itens (pedido_id, produto_id, quantidade, preco_unit_custo)
         VALUES (?, ?, ?, ?)`,
        [pedidoId, item.produtoId, item.quantidade, item.precoUnitCusto]
      );
      await conn.query(
        'UPDATE produtos SET estoque = estoque + ?, preco_custo = ? WHERE id = ?',
        [item.quantidade, item.precoUnitCusto, item.produtoId]
      );
      await conn.query(
        `INSERT INTO movimentos_estoque (produto_id, tipo, quantidade, motivo, data, pedido_id)
         VALUES (?, 'entrada', ?, ?, ?, ?)`,
        [item.produtoId, item.quantidade, `Compra - Pedido #${pedidoId}`, data, pedidoId]
      );
    }

    await conn.query(
      `INSERT INTO caixa (tipo, categoria, valor, descricao, data, pedido_id)
       VALUES ('saida', 'Compra de mercadoria', ?, ?, ?, ?)`,
      [total, `Pagamento do Pedido #${pedidoId} - ${fornecedor.nome}`, data, pedidoId]
    );

    await conn.commit();
    const [pedidoCompleto] = await buscarPedidosComItens('WHERE ped.id = ?', [pedidoId]);
    res.status(201).json(pedidoCompleto);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

// Cancelar pedido de compra: reverte a entrada de estoque e estorna o valor no caixa, mantendo o histórico
router.post('/:id/cancelar', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [pedidoRows] = await conn.query('SELECT * FROM pedidos WHERE id = ? FOR UPDATE', [id]);
    if (pedidoRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ erro: 'Pedido não encontrado' });
    }
    const pedido = pedidoRows[0];
    if (pedido.status === 'cancelado') {
      await conn.rollback();
      return res.status(400).json({ erro: 'Pedido já está cancelado' });
    }

    const [itens] = await conn.query('SELECT * FROM pedido_itens WHERE pedido_id = ?', [id]);
    const data = new Date();

    for (const item of itens) {
      await conn.query('UPDATE produtos SET estoque = estoque - ? WHERE id = ?', [item.quantidade, item.produto_id]);
      await conn.query(
        `INSERT INTO movimentos_estoque (produto_id, tipo, quantidade, motivo, data, pedido_id)
         VALUES (?, 'saida', ?, ?, ?, ?)`,
        [item.produto_id, item.quantidade, `Cancelamento - Pedido #${id}`, data, id]
      );
    }

    await conn.query(
      `INSERT INTO caixa (tipo, categoria, valor, descricao, data, pedido_id)
       VALUES ('entrada', 'Cancelamento de compra', ?, ?, ?, ?)`,
      [pedido.total, `Estorno do Pedido #${id}`, data, id]
    );

    await conn.query('UPDATE pedidos SET status = ? WHERE id = ?', ['cancelado', id]);

    await conn.commit();
    const [pedidoCompleto] = await buscarPedidosComItens('WHERE ped.id = ?', [id]);
    res.json(pedidoCompleto);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

module.exports = router;
