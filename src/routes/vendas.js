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
    produtoNome: row.produto_nome || '(produto removido)',
    produtoTipo: row.produto_tipo || undefined
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
    `SELECT vi.*, prod.nome AS produto_nome, prod.tipo AS produto_tipo
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
  const { clienteId, itens, formaPagamento, observacoes, statusPagamento, previsaoPagamento, data: dataVenda, dataPagamento: dataPagamentoBody } = req.body;

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
  let dataVendaValor = new Date();
  if (dataVenda) {
    const dataVendaParseada = new Date(dataVenda);
    if (Number.isNaN(dataVendaParseada.getTime())) {
      return res.status(400).json({ erro: 'Data da venda inválida' });
    }
    dataVendaValor = dataVendaParseada;
  }
  let dataPagamentoValor = dataVendaValor;
  if (statusPagamentoFinal === 'pago' && dataPagamentoBody) {
    const dataPagamentoParseada = new Date(dataPagamentoBody);
    if (Number.isNaN(dataPagamentoParseada.getTime())) {
      return res.status(400).json({ erro: 'Data de pagamento inválida' });
    }
    dataPagamentoValor = dataPagamentoParseada;
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

    // Itens vendidos diretamente (podem ser produtos 'simples' ou 'kit')
    const produtoIds = [...new Set(itens.map(i => Number(i.produtoId)))];
    const [produtoRows] = await conn.query('SELECT * FROM produtos WHERE id IN (?)', [produtoIds]);
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
        itensPorChave.set(chave, { produtoId: produto.id, quantidade, precoUnitVenda });
      }
    }
    const itensProcessados = [...itensPorChave.values()];

    // Nenhum produto (simples ou kit) tem estoque próprio: a baixa real acontece sempre nos
    // SKUs que o compõem (produto_skus) — simples tem 1 SKU, kit tem 2+. Carrega a composição
    // de todo produto vendido e trava (FOR UPDATE) o estoque dos SKUs envolvidos.
    const [composicaoRows] = await conn.query('SELECT * FROM produto_skus WHERE produto_id IN (?)', [itensProcessados.map(i => i.produtoId)]);
    const composicaoPorProduto = new Map();
    for (const row of composicaoRows) {
      if (!composicaoPorProduto.has(row.produto_id)) composicaoPorProduto.set(row.produto_id, []);
      composicaoPorProduto.get(row.produto_id).push({ skuId: row.sku_id, quantidade: row.quantidade });
    }

    for (const item of itensProcessados) {
      if (!composicaoPorProduto.has(item.produtoId)) {
        await conn.rollback();
        return res.status(400).json({ erro: `"${produtosPorId[item.produtoId].nome}" não tem nenhum SKU vinculado e não pode ser vendido` });
      }
    }

    const idsSkusNecessarios = [...new Set(composicaoRows.map(r => r.sku_id))];
    let skusPorId = {};
    if (idsSkusNecessarios.length > 0) {
      const [skuRows] = await conn.query('SELECT * FROM skus WHERE id IN (?) FOR UPDATE', [idsSkusNecessarios]);
      skusPorId = Object.fromEntries(skuRows.map(s => [s.id, s]));
    }

    // Soma a demanda real de estoque por SKU: venda direta (simples) + consumo via kit
    const demandaPorSku = new Map();
    const somarDemanda = (skuId, quantidade) => demandaPorSku.set(skuId, (demandaPorSku.get(skuId) || 0) + quantidade);
    for (const item of itensProcessados) {
      for (const c of composicaoPorProduto.get(item.produtoId) || []) {
        somarDemanda(c.skuId, c.quantidade * item.quantidade);
      }
    }

    for (const [skuId, quantidadeNecessaria] of demandaPorSku) {
      const sku = skusPorId[skuId];
      if (quantidadeNecessaria > sku.estoque) {
        await conn.rollback();
        return res.status(400).json({
          erro: `Estoque insuficiente de ${sku.nome} (disponível: ${sku.estoque}, necessário: ${quantidadeNecessaria})`
        });
      }
    }

    const total = itensProcessados.reduce((soma, i) => soma + i.quantidade * i.precoUnitVenda, 0);
    const data = dataVendaValor;
    const dataPagamento = statusPagamentoFinal === 'pago' ? dataPagamentoValor : null;

    const [vendaResult] = await conn.query(
      `INSERT INTO vendas (cliente_id, data, status, forma_pagamento, observacoes, total, status_pagamento, data_pagamento, previsao_pagamento)
       VALUES (?, ?, 'concluido', ?, ?, ?, ?, ?, ?)`,
      [Number(clienteId), data, formaPagamento || '', observacoes || '', total, statusPagamentoFinal, dataPagamento, previsaoPagamentoValor]
    );
    const vendaId = vendaResult.insertId;

    // Grava venda_itens no nível do que foi vendido comercialmente (kit ou simples) e move o
    // estoque físico real (os SKUs que compõem o produto) — são registros distintos de propósito.
    for (const item of itensProcessados) {
      const produto = produtosPorId[item.produtoId];
      const composicao = composicaoPorProduto.get(produto.id) || [];
      const precoUnitCusto = composicao.reduce((soma, c) => soma + skusPorId[c.skuId].preco_custo * c.quantidade, 0);
      const motivo = produto.tipo === 'kit'
        ? `Venda #${vendaId} (kit: ${produto.nome} x${item.quantidade})`
        : `Venda #${vendaId}`;

      for (const c of composicao) {
        const quantidadeConsumida = c.quantidade * item.quantidade;
        await conn.query('UPDATE skus SET estoque = estoque - ? WHERE id = ?', [quantidadeConsumida, c.skuId]);
        await conn.query(
          `INSERT INTO movimentos_estoque (sku_id, tipo, quantidade, motivo, data, venda_id)
           VALUES (?, 'saida', ?, ?, ?, ?)`,
          [c.skuId, quantidadeConsumida, motivo, data, vendaId]
        );
      }

      await conn.query(
        `INSERT INTO venda_itens (venda_id, produto_id, quantidade, preco_unit_venda, preco_unit_custo)
         VALUES (?, ?, ?, ?, ?)`,
        [vendaId, produto.id, item.quantidade, item.precoUnitVenda, precoUnitCusto]
      );
    }

    if (statusPagamentoFinal === 'pago') {
      await conn.query(
        `INSERT INTO caixa (tipo, categoria, valor, descricao, data, venda_id)
         VALUES ('entrada', 'Venda', ?, ?, ?, ?)`,
        [total, `Recebimento da Venda #${vendaId} - ${cliente.nome}`, dataPagamento, vendaId]
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

// Edita campos administrativos da venda (cliente, forma de pagamento, situação, datas,
// observações) — os itens/quantidades ficam fixos aqui (mudar isso exige cancelar e refazer,
// já que envolveria desfazer/refazer estoque). Quando a situação de pagamento muda, reconcilia
// o caixa: entra o recebimento se virou "pago", remove se virou "pendente" de novo.
router.put('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { clienteId, formaPagamento, observacoes, statusPagamento, previsaoPagamento, data: dataVenda, dataPagamento: dataPagamentoBody } = req.body;

  if (statusPagamento !== undefined && statusPagamento !== 'pago' && statusPagamento !== 'pendente') {
    return res.status(400).json({ erro: 'Situação do pagamento deve ser "pago" ou "pendente"' });
  }

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
      return res.status(400).json({ erro: 'Venda cancelada não pode ser editada' });
    }

    const clienteIdFinal = clienteId ? Number(clienteId) : venda.cliente_id;
    const [clienteRows] = await conn.query('SELECT * FROM clientes WHERE id = ?', [clienteIdFinal]);
    if (clienteRows.length === 0) {
      await conn.rollback();
      return res.status(400).json({ erro: 'Cliente não encontrado' });
    }
    const cliente = clienteRows[0];

    let dataVendaValor = venda.data;
    if (dataVenda) {
      const parsed = new Date(dataVenda);
      if (Number.isNaN(parsed.getTime())) {
        await conn.rollback();
        return res.status(400).json({ erro: 'Data da venda inválida' });
      }
      dataVendaValor = parsed;
    }

    let previsaoPagamentoValor = venda.previsao_pagamento;
    if (previsaoPagamento !== undefined) {
      if (previsaoPagamento) {
        const parsed = new Date(previsaoPagamento);
        if (Number.isNaN(parsed.getTime())) {
          await conn.rollback();
          return res.status(400).json({ erro: 'Previsão de recebimento inválida' });
        }
        previsaoPagamentoValor = parsed;
      } else {
        previsaoPagamentoValor = null;
      }
    }

    let dataPagamentoValor = venda.data_pagamento || dataVendaValor;
    if (dataPagamentoBody) {
      const parsed = new Date(dataPagamentoBody);
      if (Number.isNaN(parsed.getTime())) {
        await conn.rollback();
        return res.status(400).json({ erro: 'Data de pagamento inválida' });
      }
      dataPagamentoValor = parsed;
    }

    const statusPagamentoFinal = statusPagamento || venda.status_pagamento;

    if (statusPagamentoFinal !== venda.status_pagamento) {
      if (statusPagamentoFinal === 'pago') {
        await conn.query(
          `INSERT INTO caixa (tipo, categoria, valor, descricao, data, venda_id)
           VALUES ('entrada', 'Venda', ?, ?, ?, ?)`,
          [venda.total, `Recebimento da Venda #${id} - ${cliente.nome}`, dataPagamentoValor, id]
        );
      } else {
        // Voltou a "pendente": o recebimento nunca de fato aconteceu (foi marcado por engano
        // ou precisa ser desfeito), então remove o lançamento em vez de estornar.
        await conn.query(`DELETE FROM caixa WHERE venda_id = ? AND tipo = 'entrada'`, [id]);
      }
    } else if (statusPagamentoFinal === 'pago' && dataPagamentoBody) {
      // Só a data mudou: mantém o lançamento já existente em sincronia
      await conn.query(`UPDATE caixa SET data = ? WHERE venda_id = ? AND tipo = 'entrada'`, [dataPagamentoValor, id]);
    }

    await conn.query(
      `UPDATE vendas SET cliente_id = ?, forma_pagamento = ?, observacoes = ?, data = ?, status_pagamento = ?, data_pagamento = ?, previsao_pagamento = ?
       WHERE id = ?`,
      [
        clienteIdFinal,
        formaPagamento !== undefined ? formaPagamento : venda.forma_pagamento,
        observacoes !== undefined ? observacoes : venda.observacoes,
        dataVendaValor,
        statusPagamentoFinal,
        statusPagamentoFinal === 'pago' ? dataPagamentoValor : null,
        statusPagamentoFinal === 'pendente' ? previsaoPagamentoValor : null,
        id
      ]
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

    // Reverte o estoque com base no que foi de fato baixado (movimentos_estoque), não na
    // composição atual do produto (que pode ter mudado desde a venda) — assim o cancelamento
    // sempre acerta o SKU físico certo, seja venda de produto simples ou via kit.
    const [movimentosSaida] = await conn.query(
      `SELECT * FROM movimentos_estoque WHERE venda_id = ? AND tipo = 'saida'`,
      [id]
    );
    const data = new Date();

    for (const mov of movimentosSaida) {
      await conn.query('UPDATE skus SET estoque = estoque + ? WHERE id = ?', [mov.quantidade, mov.sku_id]);
      await conn.query(
        `INSERT INTO movimentos_estoque (sku_id, tipo, quantidade, motivo, data, venda_id)
         VALUES (?, 'entrada', ?, ?, ?, ?)`,
        [mov.sku_id, mov.quantidade, `Cancelamento - Venda #${id}`, data, id]
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
