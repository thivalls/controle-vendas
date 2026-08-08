const express = require('express');
const { pool } = require('../db');
const asyncHandler = require('../asyncHandler');

const router = express.Router();

function mapSku(row) {
  return {
    id: row.id,
    codigo: row.codigo,
    nome: row.nome,
    precoCusto: row.preco_custo,
    estoque: row.estoque,
    criadoEm: row.criado_em
  };
}

function mapMovimento(row) {
  return {
    id: row.id,
    skuId: row.sku_id,
    tipo: row.tipo,
    quantidade: row.quantidade,
    motivo: row.motivo,
    data: row.data,
    vendaId: row.venda_id || undefined,
    pedidoId: row.pedido_id || undefined
  };
}

router.get('/', asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM skus ORDER BY codigo');
  res.json(rows.map(mapSku));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [rows] = await pool.query('SELECT * FROM skus WHERE id = ?', [id]);
  if (rows.length === 0) return res.status(404).json({ erro: 'SKU não encontrado' });
  res.json(mapSku(rows[0]));
}));

router.post('/', asyncHandler(async (req, res) => {
  const { codigo, nome, precoCusto, estoqueInicial, lancarCompraNoCaixa } = req.body;

  if (!nome || !nome.trim()) return res.status(400).json({ erro: 'Nome é obrigatório' });
  const custo = Number(precoCusto);
  if (isNaN(custo) || custo < 0) return res.status(400).json({ erro: 'Preço de custo deve ser um número válido' });
  const estoque = Number(estoqueInicial) || 0;
  const codigoFinal = codigo && codigo.trim() ? codigo.trim() : null;
  const nomeFinal = nome.trim();

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [nomeExistente] = await conn.query('SELECT id FROM skus WHERE nome = ?', [nomeFinal]);
    if (nomeExistente.length > 0) {
      await conn.rollback();
      return res.status(400).json({ erro: `Já existe um SKU com o nome "${nomeFinal}"` });
    }
    if (codigoFinal) {
      const [codigoExistente] = await conn.query('SELECT id FROM skus WHERE codigo = ?', [codigoFinal]);
      if (codigoExistente.length > 0) {
        await conn.rollback();
        return res.status(400).json({ erro: `Já existe um SKU com o código "${codigoFinal}"` });
      }
    }

    const data = new Date();
    const [result] = await conn.query(
      'INSERT INTO skus (codigo, nome, preco_custo, estoque, criado_em) VALUES (?, ?, ?, ?, ?)',
      [codigoFinal, nomeFinal, custo, estoque, data]
    );
    const skuId = result.insertId;

    if (estoque > 0) {
      await conn.query(
        `INSERT INTO movimentos_estoque (sku_id, tipo, quantidade, motivo, data) VALUES (?, 'entrada', ?, 'Estoque inicial', ?)`,
        [skuId, estoque, data]
      );
      if (custo > 0 && lancarCompraNoCaixa !== false && lancarCompraNoCaixa !== 'false') {
        await conn.query(
          `INSERT INTO caixa (tipo, categoria, valor, descricao, data) VALUES ('saida', 'Compra de mercadoria', ?, ?, ?)`,
          [estoque * custo, `Estoque inicial de ${nomeFinal} (${estoque}x)`, data]
        );
      }
    }

    await conn.commit();
    const [skuCompleto] = await pool.query('SELECT * FROM skus WHERE id = ?', [skuId]);
    res.status(201).json(mapSku(skuCompleto[0]));
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [rows] = await pool.query('SELECT * FROM skus WHERE id = ?', [id]);
  if (rows.length === 0) return res.status(404).json({ erro: 'SKU não encontrado' });
  const atual = rows[0];
  const { codigo, nome, precoCusto } = req.body;

  let nomeFinal = atual.nome;
  if (nome !== undefined && nome.trim()) {
    nomeFinal = nome.trim();
    if (nomeFinal !== atual.nome) {
      const [nomeExistente] = await pool.query('SELECT id FROM skus WHERE nome = ? AND id != ?', [nomeFinal, id]);
      if (nomeExistente.length > 0) {
        return res.status(400).json({ erro: `Já existe um SKU com o nome "${nomeFinal}"` });
      }
    }
  }

  let codigoFinal = atual.codigo;
  if (codigo !== undefined) {
    codigoFinal = codigo.trim() ? codigo.trim() : null;
    if (codigoFinal && codigoFinal !== atual.codigo) {
      const [codigoExistente] = await pool.query('SELECT id FROM skus WHERE codigo = ? AND id != ?', [codigoFinal, id]);
      if (codigoExistente.length > 0) {
        return res.status(400).json({ erro: `Já existe um SKU com o código "${codigoFinal}"` });
      }
    }
  }

  await pool.query(
    'UPDATE skus SET codigo = ?, nome = ?, preco_custo = ? WHERE id = ?',
    [
      codigoFinal,
      nomeFinal,
      precoCusto !== undefined ? Number(precoCusto) : atual.preco_custo,
      id
    ]
  );
  const [atualizado] = await pool.query('SELECT * FROM skus WHERE id = ?', [id]);
  res.json(mapSku(atualizado[0]));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [emUso] = await pool.query('SELECT id FROM produto_skus WHERE sku_id = ? LIMIT 1', [id]);
  if (emUso.length > 0) {
    return res.status(400).json({ erro: 'SKU está vinculado a um produto e não pode ser excluído. Remova-o do produto primeiro.' });
  }
  const [comPedidos] = await pool.query('SELECT id FROM pedido_itens WHERE sku_id = ? LIMIT 1', [id]);
  if (comPedidos.length > 0) {
    return res.status(400).json({ erro: 'SKU possui pedidos de compra e não pode ser excluído' });
  }
  const [rows] = await pool.query('SELECT id FROM skus WHERE id = ?', [id]);
  if (rows.length === 0) return res.status(404).json({ erro: 'SKU não encontrado' });
  await pool.query('DELETE FROM skus WHERE id = ?', [id]);
  res.status(204).end();
}));

// Registrar entrada de estoque (ex: comprou mais desse SKU)
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
    const [rows] = await conn.query('SELECT * FROM skus WHERE id = ? FOR UPDATE', [id]);
    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ erro: 'SKU não encontrado' });
    }
    const sku = rows[0];
    const data = new Date();

    await conn.query('UPDATE skus SET estoque = estoque + ? WHERE id = ?', [quantidade, id]);

    const motivo = req.body.motivo || 'Compra de mercadoria';
    const [movResult] = await conn.query(
      `INSERT INTO movimentos_estoque (sku_id, tipo, quantidade, motivo, data) VALUES (?, 'entrada', ?, ?, ?)`,
      [id, quantidade, motivo, data]
    );

    if (custoTotal !== null && custoTotal > 0) {
      await conn.query(
        `INSERT INTO caixa (tipo, categoria, valor, descricao, data) VALUES ('saida', 'Compra de mercadoria', ?, ?, ?)`,
        [custoTotal, `Compra de ${quantidade}x ${sku.nome}`, data]
      );
    }

    await conn.commit();
    const [skuAtualizado] = await pool.query('SELECT * FROM skus WHERE id = ?', [id]);
    const [movimentoRows] = await pool.query('SELECT * FROM movimentos_estoque WHERE id = ?', [movResult.insertId]);
    res.status(201).json({ sku: mapSku(skuAtualizado[0]), movimento: mapMovimento(movimentoRows[0]) });
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
    const [rows] = await conn.query('SELECT * FROM skus WHERE id = ? FOR UPDATE', [id]);
    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ erro: 'SKU não encontrado' });
    }
    const sku = rows[0];
    if (quantidade > sku.estoque) {
      await conn.rollback();
      return res.status(400).json({ erro: 'Estoque insuficiente' });
    }
    const data = new Date();

    await conn.query('UPDATE skus SET estoque = estoque - ? WHERE id = ?', [quantidade, id]);

    const motivo = req.body.motivo || 'Ajuste manual';
    const [movResult] = await conn.query(
      `INSERT INTO movimentos_estoque (sku_id, tipo, quantidade, motivo, data) VALUES (?, 'saida', ?, ?, ?)`,
      [id, quantidade, motivo, data]
    );

    await conn.commit();
    const [skuAtualizado] = await pool.query('SELECT * FROM skus WHERE id = ?', [id]);
    const [movimentoRows] = await pool.query('SELECT * FROM movimentos_estoque WHERE id = ?', [movResult.insertId]);
    res.status(201).json({ sku: mapSku(skuAtualizado[0]), movimento: mapMovimento(movimentoRows[0]) });
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
    'SELECT * FROM movimentos_estoque WHERE sku_id = ? ORDER BY data DESC, id DESC',
    [id]
  );
  res.json(rows.map(mapMovimento));
}));

module.exports = router;
