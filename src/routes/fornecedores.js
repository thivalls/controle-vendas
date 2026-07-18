const express = require('express');
const { pool } = require('../db');
const asyncHandler = require('../asyncHandler');

const router = express.Router();

function mapFornecedor(row) {
  return {
    id: row.id,
    nome: row.nome,
    telefone: row.telefone,
    email: row.email,
    endereco: row.endereco,
    criadoEm: row.criado_em
  };
}

router.get('/', asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM fornecedores ORDER BY id');
  res.json(rows.map(mapFornecedor));
}));

router.post('/', asyncHandler(async (req, res) => {
  const { nome, telefone, email, endereco } = req.body;
  if (!nome || !nome.trim()) {
    return res.status(400).json({ erro: 'Nome é obrigatório' });
  }
  const [result] = await pool.query(
    'INSERT INTO fornecedores (nome, telefone, email, endereco, criado_em) VALUES (?, ?, ?, ?, ?)',
    [nome.trim(), telefone || '', email || '', endereco || '', new Date()]
  );
  const [rows] = await pool.query('SELECT * FROM fornecedores WHERE id = ?', [result.insertId]);
  res.status(201).json(mapFornecedor(rows[0]));
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [rows] = await pool.query('SELECT * FROM fornecedores WHERE id = ?', [id]);
  if (rows.length === 0) return res.status(404).json({ erro: 'Fornecedor não encontrado' });
  const atual = rows[0];
  const { nome, telefone, email, endereco } = req.body;
  await pool.query(
    'UPDATE fornecedores SET nome = ?, telefone = ?, email = ?, endereco = ? WHERE id = ?',
    [
      nome !== undefined ? nome : atual.nome,
      telefone !== undefined ? telefone : atual.telefone,
      email !== undefined ? email : atual.email,
      endereco !== undefined ? endereco : atual.endereco,
      id
    ]
  );
  const [atualizado] = await pool.query('SELECT * FROM fornecedores WHERE id = ?', [id]);
  res.json(mapFornecedor(atualizado[0]));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [pedidos] = await pool.query('SELECT id FROM pedidos WHERE fornecedor_id = ? LIMIT 1', [id]);
  if (pedidos.length > 0) {
    return res.status(400).json({ erro: 'Fornecedor possui pedidos e não pode ser excluído' });
  }
  await pool.query('DELETE FROM fornecedores WHERE id = ?', [id]);
  res.status(204).end();
}));

module.exports = router;
