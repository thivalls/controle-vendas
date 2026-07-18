const express = require('express');
const { pool } = require('../db');
const asyncHandler = require('../asyncHandler');

const router = express.Router();

// Lista todas as movimentações de estoque (entradas e saídas), com nome do produto
router.get('/', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT m.*, COALESCE(p.nome, '(produto removido)') AS produto_nome
     FROM movimentos_estoque m
     LEFT JOIN produtos p ON p.id = m.produto_id
     ORDER BY m.data DESC, m.id DESC`
  );
  res.json(rows.map(row => ({
    id: row.id,
    produtoId: row.produto_id,
    tipo: row.tipo,
    quantidade: row.quantidade,
    motivo: row.motivo,
    data: row.data,
    vendaId: row.venda_id || undefined,
    pedidoId: row.pedido_id || undefined,
    produtoNome: row.produto_nome
  })));
}));

module.exports = router;
