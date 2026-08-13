const express = require('express');
const { pool } = require('../db');
const asyncHandler = require('../asyncHandler');

const router = express.Router();

function mapCaixa(row) {
  return {
    id: row.id,
    tipo: row.tipo,
    categoria: row.categoria,
    valor: row.valor,
    descricao: row.descricao,
    data: row.data,
    vendaId: row.venda_id || undefined,
    pedidoId: row.pedido_id || undefined,
    manual: row.venda_id === null && row.pedido_id === null
  };
}

// Lista todo o caixa: lançamentos automáticos (de vendas/pedidos) e manuais (lançados aqui
// direto, ex: rendimento de banco, taxa, saída avulsa) — visão única pra bater com o extrato.
router.get('/', asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM caixa ORDER BY data DESC, id DESC');
  res.json(rows.map(mapCaixa));
}));

// Lançamento manual: sempre sem venda_id/pedido_id — o que vem de uma venda ou pedido é
// gerado automaticamente pelas próprias rotas de vendas/pedidos, nunca por aqui.
router.post('/', asyncHandler(async (req, res) => {
  const { tipo, categoria, valor, descricao, data } = req.body;

  if (tipo !== 'entrada' && tipo !== 'saida') {
    return res.status(400).json({ erro: 'Tipo deve ser "entrada" ou "saida"' });
  }
  const valorNum = Number(valor);
  if (isNaN(valorNum) || valorNum <= 0) {
    return res.status(400).json({ erro: 'Valor inválido' });
  }
  let dataValor = new Date();
  if (data) {
    dataValor = new Date(data);
    if (Number.isNaN(dataValor.getTime())) {
      return res.status(400).json({ erro: 'Data inválida' });
    }
  }

  const [result] = await pool.query(
    `INSERT INTO caixa (tipo, categoria, valor, descricao, data) VALUES (?, ?, ?, ?, ?)`,
    [tipo, (categoria || '').trim() || 'Outros', valorNum, descricao || '', dataValor]
  );
  const [rows] = await pool.query('SELECT * FROM caixa WHERE id = ?', [result.insertId]);
  res.status(201).json(mapCaixa(rows[0]));
}));

// Exclui um lançamento — só permite os manuais. Os automáticos (venda_id/pedido_id) são
// histórico de uma venda/pedido de verdade e só devem ser desfeitos cancelando o registro
// de origem, senão o caixa fica dessincronizado do que realmente aconteceu lá.
router.delete('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [rows] = await pool.query('SELECT * FROM caixa WHERE id = ?', [id]);
  if (rows.length === 0) {
    return res.status(404).json({ erro: 'Lançamento não encontrado' });
  }
  const lancamento = rows[0];
  if (lancamento.venda_id || lancamento.pedido_id) {
    return res.status(400).json({ erro: 'Este lançamento pertence a uma venda ou pedido — cancele o registro de origem em vez de excluir aqui' });
  }
  await pool.query('DELETE FROM caixa WHERE id = ?', [id]);
  res.status(204).send();
}));

module.exports = router;
