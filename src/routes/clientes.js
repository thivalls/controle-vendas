const express = require('express');
const { pool } = require('../db');
const asyncHandler = require('../asyncHandler');

const router = express.Router();

function mapCliente(row) {
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
  const [rows] = await pool.query('SELECT * FROM clientes ORDER BY id');
  res.json(rows.map(mapCliente));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [rows] = await pool.query('SELECT * FROM clientes WHERE id = ?', [id]);
  if (rows.length === 0) return res.status(404).json({ erro: 'Cliente não encontrado' });
  res.json(mapCliente(rows[0]));
}));

router.post('/', asyncHandler(async (req, res) => {
  const { nome, telefone, email, endereco } = req.body;
  if (!nome || !nome.trim()) {
    return res.status(400).json({ erro: 'Nome é obrigatório' });
  }
  const [result] = await pool.query(
    'INSERT INTO clientes (nome, telefone, email, endereco, criado_em) VALUES (?, ?, ?, ?, ?)',
    [nome.trim(), telefone || '', email || '', endereco || '', new Date()]
  );
  const [rows] = await pool.query('SELECT * FROM clientes WHERE id = ?', [result.insertId]);
  res.status(201).json(mapCliente(rows[0]));
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [rows] = await pool.query('SELECT * FROM clientes WHERE id = ?', [id]);
  if (rows.length === 0) return res.status(404).json({ erro: 'Cliente não encontrado' });
  const atual = rows[0];
  const { nome, telefone, email, endereco } = req.body;
  await pool.query(
    'UPDATE clientes SET nome = ?, telefone = ?, email = ?, endereco = ? WHERE id = ?',
    [
      nome !== undefined ? nome : atual.nome,
      telefone !== undefined ? telefone : atual.telefone,
      email !== undefined ? email : atual.email,
      endereco !== undefined ? endereco : atual.endereco,
      id
    ]
  );
  const [atualizado] = await pool.query('SELECT * FROM clientes WHERE id = ?', [id]);
  res.json(mapCliente(atualizado[0]));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [vendas] = await pool.query('SELECT id FROM vendas WHERE cliente_id = ? LIMIT 1', [id]);
  if (vendas.length > 0) {
    return res.status(400).json({ erro: 'Cliente possui vendas e não pode ser excluído' });
  }
  await pool.query('DELETE FROM clientes WHERE id = ?', [id]);
  res.status(204).end();
}));

module.exports = router;
