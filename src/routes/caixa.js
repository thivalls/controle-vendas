const express = require('express');
const { pool } = require('../db');
const asyncHandler = require('../asyncHandler');

const router = express.Router();

function mapLancamento(row) {
  return {
    id: row.id,
    tipo: row.tipo,
    categoria: row.categoria,
    valor: row.valor,
    descricao: row.descricao,
    data: row.data,
    vendaId: row.venda_id || undefined,
    pedidoId: row.pedido_id || undefined
  };
}

router.get('/', asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM caixa ORDER BY data DESC, id DESC');
  const lancamentos = rows.map(mapLancamento);

  const saldo = lancamentos.reduce((s, l) => s + (l.tipo === 'entrada' ? l.valor : -l.valor), 0);
  const totalEntradas = lancamentos.filter(l => l.tipo === 'entrada').reduce((s, l) => s + l.valor, 0);
  const totalSaidas = lancamentos.filter(l => l.tipo === 'saida').reduce((s, l) => s + l.valor, 0);

  res.json({ lancamentos, saldo, totalEntradas, totalSaidas });
}));

// Lançamento manual (ex: aluguel, embalagens, transporte, aporte de capital)
router.post('/', asyncHandler(async (req, res) => {
  const { tipo, categoria, valor, descricao, data } = req.body;
  if (tipo !== 'entrada' && tipo !== 'saida') {
    return res.status(400).json({ erro: 'Tipo deve ser "entrada" ou "saida"' });
  }
  const valorNum = Number(valor);
  if (!valorNum || valorNum <= 0) {
    return res.status(400).json({ erro: 'Valor deve ser maior que zero' });
  }
  const dataValor = data ? new Date(data) : new Date();
  const [result] = await pool.query(
    'INSERT INTO caixa (tipo, categoria, valor, descricao, data) VALUES (?, ?, ?, ?, ?)',
    [tipo, categoria || 'Outros', valorNum, descricao || '', dataValor]
  );
  const [rows] = await pool.query('SELECT * FROM caixa WHERE id = ?', [result.insertId]);
  res.status(201).json(mapLancamento(rows[0]));
}));

// Só permite editar lançamentos manuais (não vinculados a vendas ou pedidos)
router.put('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [rows] = await pool.query('SELECT * FROM caixa WHERE id = ?', [id]);
  if (rows.length === 0) return res.status(404).json({ erro: 'Lançamento não encontrado' });
  const atual = rows[0];
  if (atual.venda_id) {
    return res.status(400).json({ erro: 'Este lançamento é gerado automaticamente por uma venda e não pode ser editado diretamente. Cancele a venda em vez disso.' });
  }
  if (atual.pedido_id) {
    return res.status(400).json({ erro: 'Este lançamento é gerado automaticamente por um pedido e não pode ser editado diretamente. Cancele o pedido em vez disso.' });
  }
  const { tipo, categoria, valor, descricao } = req.body;
  if (tipo !== undefined && tipo !== 'entrada' && tipo !== 'saida') {
    return res.status(400).json({ erro: 'Tipo deve ser "entrada" ou "saida"' });
  }
  let valorNum = atual.valor;
  if (valor !== undefined) {
    valorNum = Number(valor);
    if (!valorNum || valorNum <= 0) {
      return res.status(400).json({ erro: 'Valor deve ser maior que zero' });
    }
  }
  await pool.query(
    'UPDATE caixa SET tipo = ?, categoria = ?, valor = ?, descricao = ? WHERE id = ?',
    [
      tipo !== undefined ? tipo : atual.tipo,
      categoria !== undefined ? (categoria || 'Outros') : atual.categoria,
      valorNum,
      descricao !== undefined ? descricao : atual.descricao,
      id
    ]
  );
  const [atualizado] = await pool.query('SELECT * FROM caixa WHERE id = ?', [id]);
  res.json(mapLancamento(atualizado[0]));
}));

// Só permite excluir lançamentos manuais (não vinculados a vendas ou pedidos)
router.delete('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [rows] = await pool.query('SELECT * FROM caixa WHERE id = ?', [id]);
  if (rows.length === 0) return res.status(404).json({ erro: 'Lançamento não encontrado' });
  if (rows[0].venda_id) {
    return res.status(400).json({ erro: 'Este lançamento é gerado automaticamente por uma venda e não pode ser excluído diretamente. Cancele a venda em vez disso.' });
  }
  if (rows[0].pedido_id) {
    return res.status(400).json({ erro: 'Este lançamento é gerado automaticamente por um pedido e não pode ser excluído diretamente. Cancele o pedido em vez disso.' });
  }
  await pool.query('DELETE FROM caixa WHERE id = ?', [id]);
  res.status(204).end();
}));

module.exports = router;
