const express = require('express');
const { pool } = require('../db');
const asyncHandler = require('../asyncHandler');

const router = express.Router();

// Lista todas as movimentações de estoque (entradas e saídas), com nome/código do SKU.
// Estoque sempre se move no nível do SKU — mesmo quando disparado pela venda de um kit
// (ver routes/vendas.js), o registro aqui é sempre do SKU físico afetado.
router.get('/', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT m.*, COALESCE(s.nome, '(SKU removido)') AS sku_nome, s.codigo AS sku_codigo
     FROM movimentos_estoque m
     LEFT JOIN skus s ON s.id = m.sku_id
     ORDER BY m.data DESC, m.id DESC`
  );
  res.json(rows.map(row => ({
    id: row.id,
    skuId: row.sku_id,
    tipo: row.tipo,
    quantidade: row.quantidade,
    motivo: row.motivo,
    data: row.data,
    vendaId: row.venda_id || undefined,
    pedidoId: row.pedido_id || undefined,
    skuNome: row.sku_nome,
    skuCodigo: row.sku_codigo || undefined
  })));
}));

module.exports = router;
