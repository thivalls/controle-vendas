const express = require('express');
const { pool } = require('../db');
const asyncHandler = require('../asyncHandler');

const router = express.Router();

function mapVenda(row) {
  return {
    id: row.id,
    clienteId: row.cliente_id,
    data: row.data,
    status: row.status,
    formaPagamento: row.forma_pagamento,
    observacoes: row.observacoes,
    total: row.total,
    clienteNome: row.cliente_nome || '(cliente removido)',
    statusPagamento: row.status_pagamento,
    dataPagamento: row.data_pagamento,
    previsaoPagamento: row.previsao_pagamento
  };
}

function mapItem(row) {
  return {
    produtoId: row.produto_id,
    quantidade: row.quantidade,
    precoUnitVenda: row.preco_unit_venda,
    precoUnitCusto: row.preco_unit_custo,
    produtoNome: row.produto_nome || '(produto removido)'
  };
}

async function buscarVendasComItens(whereSql = '', params = []) {
  const [vendaRows] = await pool.query(
    `SELECT ven.*, cli.nome AS cliente_nome
     FROM vendas ven
     LEFT JOIN clientes cli ON cli.id = ven.cliente_id
     ${whereSql}
     ORDER BY ven.data DESC, ven.id DESC`,
    params
  );
  if (vendaRows.length === 0) return [];

  const ids = vendaRows.map(v => v.id);
  const [itemRows] = await pool.query(
    `SELECT vi.*, prod.nome AS produto_nome
     FROM venda_itens vi
     LEFT JOIN produtos prod ON prod.id = vi.produto_id
     WHERE vi.venda_id IN (?)`,
    [ids]
  );

  const itensPorVenda = new Map();
  for (const item of itemRows) {
    if (!itensPorVenda.has(item.venda_id)) itensPorVenda.set(item.venda_id, []);
    itensPorVenda.get(item.venda_id).push(mapItem(item));
  }

  return vendaRows.map(v => ({
    ...mapVenda(v),
    itens: itensPorVenda.get(v.id) || []
  }));
}

router.get('/', asyncHandler(async (req, res) => {
  const vendas = await buscarVendasComItens();
  res.json(vendas);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [venda] = await buscarVendasComItens('WHERE ven.id = ?', [id]);
  if (!venda) return res.status(404).json({ erro: 'Venda não encontrada' });
  res.json(venda);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { clienteId, itens, formaPagamento, observacoes, statusPagamento, previsaoPagamento } = req.body;

  if (!clienteId) return res.status(400).json({ erro: 'Cliente é obrigatório' });
  if (!Array.isArray(itens) || itens.length === 0) {
    return res.status(400).json({ erro: 'A venda precisa ter ao menos um item' });
  }
  const statusPagamentoFinal = statusPagamento === 'pendente' ? 'pendente' : 'pago';
  if (statusPagamento !== undefined && statusPagamento !== 'pago' && statusPagamento !== 'pendente') {
    return res.status(400).json({ erro: 'Situação do pagamento deve ser "pago" ou "pendente"' });
  }
  let previsaoPagamentoValor = null;
  if (previsaoPagamento) {
    const previsaoData = new Date(previsaoPagamento);
    if (Number.isNaN(previsaoData.getTime())) {
      return res.status(400).json({ erro: 'Previsão de recebimento inválida' });
    }
    previsaoPagamentoValor = previsaoData;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [clienteRows] = await conn.query('SELECT * FROM clientes WHERE id = ?', [Number(clienteId)]);
    if (clienteRows.length === 0) {
      await conn.rollback();
      return res.status(400).json({ erro: 'Cliente não encontrado' });
    }
    const cliente = clienteRows[0];

    const produtoIds = [...new Set(itens.map(i => Number(i.produtoId)))];
    const [produtoRows] = await conn.query('SELECT * FROM produtos WHERE id IN (?) FOR UPDATE', [produtoIds]);
    const produtosPorId = Object.fromEntries(produtoRows.map(p => [p.id, p]));

    // Junta linhas do mesmo produto (com o mesmo preço de venda) em uma única, somando as quantidades
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
      const precoUnitVenda = item.precoUnitVenda !== undefined ? Number(item.precoUnitVenda) : produto.preco_venda;
      const chave = `${produto.id}|${precoUnitVenda}`;
      if (itensPorChave.has(chave)) {
        itensPorChave.get(chave).quantidade += quantidade;
      } else {
        itensPorChave.set(chave, {
          produtoId: produto.id,
          quantidade,
          precoUnitVenda,
          precoUnitCusto: produto.preco_custo
        });
      }
    }

    const itensProcessados = [...itensPorChave.values()];
    for (const item of itensProcessados) {
      const produto = produtosPorId[item.produtoId];
      if (item.quantidade > produto.estoque) {
        await conn.rollback();
        return res.status(400).json({ erro: `Estoque insuficiente de ${produto.nome} (disponível: ${produto.estoque})` });
      }
    }

    const total = itensProcessados.reduce((soma, i) => soma + i.quantidade * i.precoUnitVenda, 0);
    const data = new Date();
    const dataPagamento = statusPagamentoFinal === 'pago' ? data : null;

    const [vendaResult] = await conn.query(
      `INSERT INTO vendas (cliente_id, data, status, forma_pagamento, observacoes, total, status_pagamento, data_pagamento, previsao_pagamento)
       VALUES (?, ?, 'concluido', ?, ?, ?, ?, ?, ?)`,
      [Number(clienteId), data, formaPagamento || '', observacoes || '', total, statusPagamentoFinal, dataPagamento, previsaoPagamentoValor]
    );
    const vendaId = vendaResult.insertId;

    for (const item of itensProcessados) {
      const produto = produtosPorId[item.produtoId];
      await conn.query(
        `INSERT INTO venda_itens (venda_id, produto_id, quantidade, preco_unit_venda, preco_unit_custo)
         VALUES (?, ?, ?, ?, ?)`,
        [vendaId, item.produtoId, item.quantidade, item.precoUnitVenda, item.precoUnitCusto]
      );
      await conn.query('UPDATE produtos SET estoque = estoque - ? WHERE id = ?', [item.quantidade, item.produtoId]);
      await conn.query(
        `INSERT INTO movimentos_estoque (produto_id, tipo, quantidade, motivo, data, venda_id)
         VALUES (?, 'saida', ?, ?, ?, ?)`,
        [item.produtoId, item.quantidade, `Venda #${vendaId}`, data, vendaId]
      );
    }

    if (statusPagamentoFinal === 'pago') {
      await conn.query(
        `INSERT INTO caixa (tipo, categoria, valor, descricao, data, venda_id)
         VALUES ('entrada', 'Venda', ?, ?, ?, ?)`,
        [total, `Recebimento da Venda #${vendaId} - ${cliente.nome}`, data, vendaId]
      );
    }

    await conn.commit();
    const [vendaCompleta] = await buscarVendasComItens('WHERE ven.id = ?', [vendaId]);
    res.status(201).json(vendaCompleta);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

// Cancelar venda: devolve o estoque e estorna o valor no caixa, mantendo o histórico
router.post('/:id/cancelar', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [vendaRows] = await conn.query('SELECT * FROM vendas WHERE id = ? FOR UPDATE', [id]);
    if (vendaRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ erro: 'Venda não encontrada' });
    }
    const venda = vendaRows[0];
    if (venda.status === 'cancelado') {
      await conn.rollback();
      return res.status(400).json({ erro: 'Venda já está cancelada' });
    }

    const [itens] = await conn.query('SELECT * FROM venda_itens WHERE venda_id = ?', [id]);
    const data = new Date();

    for (const item of itens) {
      await conn.query('UPDATE produtos SET estoque = estoque + ? WHERE id = ?', [item.quantidade, item.produto_id]);
      await conn.query(
        `INSERT INTO movimentos_estoque (produto_id, tipo, quantidade, motivo, data, venda_id)
         VALUES (?, 'entrada', ?, ?, ?, ?)`,
        [item.produto_id, item.quantidade, `Cancelamento - Venda #${id}`, data, id]
      );
    }

    if (venda.status_pagamento === 'pago') {
      await conn.query(
        `INSERT INTO caixa (tipo, categoria, valor, descricao, data, venda_id)
         VALUES ('saida', 'Cancelamento de venda', ?, ?, ?, ?)`,
        [venda.total, `Estorno da Venda #${id}`, data, id]
      );
    }

    await conn.query('UPDATE vendas SET status = ? WHERE id = ?', ['cancelado', id]);

    await conn.commit();
    const [vendaCompleta] = await buscarVendasComItens('WHERE ven.id = ?', [id]);
    res.json(vendaCompleta);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

// Dar baixa: registra no caixa o recebimento de uma venda que estava com pagamento pendente
router.post('/:id/dar-baixa', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [vendaRows] = await conn.query(
      'SELECT ven.*, cli.nome AS cliente_nome FROM vendas ven LEFT JOIN clientes cli ON cli.id = ven.cliente_id WHERE ven.id = ? FOR UPDATE',
      [id]
    );
    if (vendaRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ erro: 'Venda não encontrada' });
    }
    const venda = vendaRows[0];
    if (venda.status === 'cancelado') {
      await conn.rollback();
      return res.status(400).json({ erro: 'Venda está cancelada' });
    }
    if (venda.status_pagamento === 'pago') {
      await conn.rollback();
      return res.status(400).json({ erro: 'Esta venda já está paga' });
    }

    let dataPagamento = new Date();
    if (req.body && req.body.data) {
      dataPagamento = new Date(req.body.data);
      if (Number.isNaN(dataPagamento.getTime())) {
        await conn.rollback();
        return res.status(400).json({ erro: 'Data de pagamento inválida' });
      }
    }

    await conn.query(
      `INSERT INTO caixa (tipo, categoria, valor, descricao, data, venda_id)
       VALUES ('entrada', 'Venda', ?, ?, ?, ?)`,
      [venda.total, `Recebimento da Venda #${id} - ${venda.cliente_nome || '(cliente removido)'}`, dataPagamento, id]
    );

    await conn.query(
      `UPDATE vendas SET status_pagamento = 'pago', data_pagamento = ? WHERE id = ?`,
      [dataPagamento, id]
    );

    await conn.commit();
    const [vendaCompleta] = await buscarVendasComItens('WHERE ven.id = ?', [id]);
    res.json(vendaCompleta);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

module.exports = router;
