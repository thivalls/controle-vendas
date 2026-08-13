const express = require('express');
const { pool } = require('../db');
const asyncHandler = require('../asyncHandler');

const router = express.Router();

// Situação do pedido é sempre derivada das parcelas (nunca guardada direto): 'pago' quando
// todas as parcelas foram pagas, 'pendente' quando nenhuma foi, 'parcial' no meio termo.
function statusPagamentoDeParcelas(parcelas) {
  if (parcelas.length === 0) return 'pendente';
  const pagas = parcelas.filter(p => p.statusPagamento === 'pago').length;
  if (pagas === parcelas.length) return 'pago';
  if (pagas === 0) return 'pendente';
  return 'parcial';
}

function mapPedido(row, parcelas) {
  return {
    id: row.id,
    fornecedorId: row.fornecedor_id,
    data: row.data,
    status: row.status,
    formaPagamento: row.forma_pagamento,
    atualizaEstoque: !!row.atualiza_estoque,
    numeroNotaFiscal: row.numero_nota_fiscal || undefined,
    dataNotaFiscal: row.data_nota_fiscal || undefined,
    observacoes: row.observacoes,
    total: row.total,
    fornecedorNome: row.fornecedor_nome || '(fornecedor removido)',
    parcelas,
    statusPagamento: statusPagamentoDeParcelas(parcelas)
  };
}

function mapItem(row) {
  return {
    skuId: row.sku_id,
    quantidade: row.quantidade,
    precoUnitCusto: row.preco_unit_custo,
    skuCodigo: row.sku_codigo || undefined,
    skuNome: row.sku_nome || '(SKU removido)'
  };
}

function mapParcela(row) {
  return {
    id: row.id,
    numero: row.numero,
    valor: row.valor,
    dataVencimento: row.data_vencimento,
    statusPagamento: row.status_pagamento,
    dataPagamento: row.data_pagamento
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
    `SELECT pi.*, s.codigo AS sku_codigo, s.nome AS sku_nome
     FROM pedido_itens pi
     LEFT JOIN skus s ON s.id = pi.sku_id
     WHERE pi.pedido_id IN (?)`,
    [ids]
  );
  const [parcelaRows] = await pool.query(
    `SELECT * FROM pedido_parcelas WHERE pedido_id IN (?) ORDER BY numero`,
    [ids]
  );

  const itensPorPedido = new Map();
  for (const item of itemRows) {
    if (!itensPorPedido.has(item.pedido_id)) itensPorPedido.set(item.pedido_id, []);
    itensPorPedido.get(item.pedido_id).push(mapItem(item));
  }
  const parcelasPorPedido = new Map();
  for (const parcela of parcelaRows) {
    if (!parcelasPorPedido.has(parcela.pedido_id)) parcelasPorPedido.set(parcela.pedido_id, []);
    parcelasPorPedido.get(parcela.pedido_id).push(mapParcela(parcela));
  }

  return pedidoRows.map(p => ({
    ...mapPedido(p, parcelasPorPedido.get(p.id) || []),
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
  const { fornecedorId, itens, numeroNotaFiscal, dataNotaFiscal, observacoes, formaPagamento, parcelas, atualizaEstoque } = req.body;
  const atualizaEstoqueFinal = atualizaEstoque !== false;

  if (!fornecedorId) return res.status(400).json({ erro: 'Fornecedor é obrigatório' });
  if (!Array.isArray(itens) || itens.length === 0) {
    return res.status(400).json({ erro: 'O pedido precisa ter ao menos um item' });
  }
  if (!Array.isArray(parcelas) || parcelas.length === 0) {
    return res.status(400).json({ erro: 'O pedido precisa ter ao menos uma parcela' });
  }
  const parcelasProcessadas = [];
  for (const parcela of parcelas) {
    const valor = Number(parcela.valor);
    if (isNaN(valor) || valor <= 0) {
      return res.status(400).json({ erro: 'Valor de parcela inválido' });
    }
    const dataVencimento = new Date(parcela.dataVencimento);
    if (Number.isNaN(dataVencimento.getTime())) {
      return res.status(400).json({ erro: 'Vencimento de parcela inválido' });
    }
    parcelasProcessadas.push({ valor, dataVencimento, pago: !!parcela.pago });
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

    const skuIds = [...new Set(itens.map(i => Number(i.skuId)))];
    const [skuRows] = await conn.query('SELECT * FROM skus WHERE id IN (?) FOR UPDATE', [skuIds]);
    const skusPorId = Object.fromEntries(skuRows.map(s => [s.id, s]));

    // Junta linhas do mesmo SKU (com o mesmo preço unitário) em uma única, somando as quantidades
    const itensPorChave = new Map();
    for (const item of itens) {
      const sku = skusPorId[Number(item.skuId)];
      if (!sku) {
        await conn.rollback();
        return res.status(400).json({ erro: `SKU ${item.skuId} não encontrado` });
      }
      const quantidade = Number(item.quantidade);
      if (!quantidade || quantidade <= 0) {
        await conn.rollback();
        return res.status(400).json({ erro: `Quantidade inválida para ${sku.nome}` });
      }
      const precoUnitCusto = Number(item.precoUnitCusto);
      if (isNaN(precoUnitCusto) || precoUnitCusto < 0) {
        await conn.rollback();
        return res.status(400).json({ erro: `Preço unitário inválido para ${sku.nome}` });
      }
      const chave = `${sku.id}|${precoUnitCusto}`;
      if (itensPorChave.has(chave)) {
        itensPorChave.get(chave).quantidade += quantidade;
      } else {
        itensPorChave.set(chave, { skuId: sku.id, quantidade, precoUnitCusto });
      }
    }

    const itensProcessados = [...itensPorChave.values()];
    const total = itensProcessados.reduce((soma, i) => soma + i.quantidade * i.precoUnitCusto, 0);
    const data = new Date();

    const somaParcelas = parcelasProcessadas.reduce((soma, p) => soma + p.valor, 0);
    if (Math.round(somaParcelas * 100) !== Math.round(total * 100)) {
      await conn.rollback();
      return res.status(400).json({ erro: `A soma das parcelas (${somaParcelas.toFixed(2)}) precisa ser igual ao total do pedido (${total.toFixed(2)})` });
    }

    const [pedidoResult] = await conn.query(
      `INSERT INTO pedidos (fornecedor_id, data, status, numero_nota_fiscal, data_nota_fiscal, observacoes, total, forma_pagamento, atualiza_estoque)
       VALUES (?, ?, 'concluido', ?, ?, ?, ?, ?, ?)`,
      [Number(fornecedorId), data, numeroNotaFiscal || null, dataNotaFiscal || null, observacoes || '', total, formaPagamento || '', atualizaEstoqueFinal]
    );
    const pedidoId = pedidoResult.insertId;

    for (const item of itensProcessados) {
      await conn.query(
        `INSERT INTO pedido_itens (pedido_id, sku_id, quantidade, preco_unit_custo)
         VALUES (?, ?, ?, ?)`,
        [pedidoId, item.skuId, item.quantidade, item.precoUnitCusto]
      );
      // Pedido usado só pra registrar o financeiro (ex: pagamento de uma entrada já lançada
      // manualmente antes) não deve somar estoque de novo nem duplicar o histórico de entrada.
      if (atualizaEstoqueFinal) {
        await conn.query(
          'UPDATE skus SET estoque = estoque + ?, preco_custo = ? WHERE id = ?',
          [item.quantidade, item.precoUnitCusto, item.skuId]
        );
        await conn.query(
          `INSERT INTO movimentos_estoque (sku_id, tipo, quantidade, motivo, data, pedido_id)
           VALUES (?, 'entrada', ?, ?, ?, ?)`,
          [item.skuId, item.quantidade, `Compra - Pedido #${pedidoId}`, data, pedidoId]
        );
      }
    }

    // Só entra no caixa o que já foi de fato pago — parcelas pendentes ficam registradas
    // (com vencimento) mas só derrubam o caixa quando alguém der baixa nelas.
    for (const [indice, parcela] of parcelasProcessadas.entries()) {
      const numero = indice + 1;
      const dataPagamento = parcela.pago ? parcela.dataVencimento : null;
      await conn.query(
        `INSERT INTO pedido_parcelas (pedido_id, numero, valor, data_vencimento, status_pagamento, data_pagamento)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [pedidoId, numero, parcela.valor, parcela.dataVencimento, parcela.pago ? 'pago' : 'pendente', dataPagamento]
      );
      if (parcela.pago) {
        const descricaoParcela = parcelasProcessadas.length > 1
          ? `Pagamento da parcela ${numero}/${parcelasProcessadas.length} do Pedido #${pedidoId} - ${fornecedor.nome}`
          : `Pagamento do Pedido #${pedidoId} - ${fornecedor.nome}`;
        await conn.query(
          `INSERT INTO caixa (tipo, categoria, valor, descricao, data, pedido_id)
           VALUES ('saida', 'Compra de mercadoria', ?, ?, ?, ?)`,
          [parcela.valor, descricaoParcela, dataPagamento, pedidoId]
        );
      }
    }

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

    const data = new Date();

    // Só reverte estoque se este pedido de fato deu entrada nele (ver flag atualiza_estoque) —
    // senão estaria tirando estoque que não foi somado por causa deste pedido.
    if (pedido.atualiza_estoque) {
      const [itens] = await conn.query('SELECT * FROM pedido_itens WHERE pedido_id = ?', [id]);
      for (const item of itens) {
        await conn.query('UPDATE skus SET estoque = estoque - ? WHERE id = ?', [item.quantidade, item.sku_id]);
        await conn.query(
          `INSERT INTO movimentos_estoque (sku_id, tipo, quantidade, motivo, data, pedido_id)
           VALUES (?, 'saida', ?, ?, ?, ?)`,
          [item.sku_id, item.quantidade, `Cancelamento - Pedido #${id}`, data, id]
        );
      }
    }

    // Estorna só o que de fato saiu do caixa (parcelas já pagas) — parcelas pendentes nunca
    // chegaram a sair, então não há o que devolver por elas.
    const [parcelasPagas] = await conn.query(
      `SELECT valor FROM pedido_parcelas WHERE pedido_id = ? AND status_pagamento = 'pago'`,
      [id]
    );
    const totalPago = parcelasPagas.reduce((soma, p) => soma + Number(p.valor), 0);
    if (totalPago > 0) {
      await conn.query(
        `INSERT INTO caixa (tipo, categoria, valor, descricao, data, pedido_id)
         VALUES ('entrada', 'Cancelamento de compra', ?, ?, ?, ?)`,
        [totalPago, `Estorno do Pedido #${id}`, data, id]
      );
    }

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

// Dar baixa numa parcela: registra no caixa a saída referente a essa parcela específica
router.post('/:id/parcelas/:parcelaId/dar-baixa', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const parcelaId = Number(req.params.parcelaId);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [pedidoRows] = await conn.query(
      'SELECT ped.*, forn.nome AS fornecedor_nome FROM pedidos ped LEFT JOIN fornecedores forn ON forn.id = ped.fornecedor_id WHERE ped.id = ? FOR UPDATE',
      [id]
    );
    if (pedidoRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ erro: 'Pedido não encontrado' });
    }
    const pedido = pedidoRows[0];
    if (pedido.status === 'cancelado') {
      await conn.rollback();
      return res.status(400).json({ erro: 'Pedido está cancelado' });
    }

    const [parcelaRows] = await conn.query(
      'SELECT * FROM pedido_parcelas WHERE id = ? AND pedido_id = ? FOR UPDATE',
      [parcelaId, id]
    );
    if (parcelaRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ erro: 'Parcela não encontrada' });
    }
    const parcela = parcelaRows[0];
    if (parcela.status_pagamento === 'pago') {
      await conn.rollback();
      return res.status(400).json({ erro: 'Esta parcela já está paga' });
    }

    let dataPagamento = new Date();
    if (req.body && req.body.data) {
      dataPagamento = new Date(req.body.data);
      if (Number.isNaN(dataPagamento.getTime())) {
        await conn.rollback();
        return res.status(400).json({ erro: 'Data de pagamento inválida' });
      }
    }

    const [totalParcelasRows] = await conn.query(
      'SELECT COUNT(*) AS total FROM pedido_parcelas WHERE pedido_id = ?',
      [id]
    );
    const totalParcelas = totalParcelasRows[0].total;
    const descricaoParcela = totalParcelas > 1
      ? `Pagamento da parcela ${parcela.numero}/${totalParcelas} do Pedido #${id} - ${pedido.fornecedor_nome || '(fornecedor removido)'}`
      : `Pagamento do Pedido #${id} - ${pedido.fornecedor_nome || '(fornecedor removido)'}`;

    await conn.query(
      `INSERT INTO caixa (tipo, categoria, valor, descricao, data, pedido_id)
       VALUES ('saida', 'Compra de mercadoria', ?, ?, ?, ?)`,
      [parcela.valor, descricaoParcela, dataPagamento, id]
    );

    await conn.query(
      `UPDATE pedido_parcelas SET status_pagamento = 'pago', data_pagamento = ? WHERE id = ?`,
      [dataPagamento, parcelaId]
    );

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
