const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pool } = require('../db');
const asyncHandler = require('../asyncHandler');

const router = express.Router();

function mapProduto(row) {
  return {
    id: row.id,
    nome: row.nome,
    precoCusto: row.preco_custo,
    precoVenda: row.preco_venda,
    estoque: row.estoque,
    imagem: row.imagem || null,
    tags: row.tags ? row.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
    criadoEm: row.criado_em
  };
}

function normalizarTags(tags) {
  if (!tags) return '';
  const lista = Array.isArray(tags) ? tags : String(tags).split(',');
  return lista.map(t => t.trim()).filter(Boolean).join(', ');
}

// ---------- Upload de imagem do produto ----------
const uploadsDir = path.join(__dirname, '..', '..', 'public', 'uploads', 'produtos');
fs.mkdirSync(uploadsDir, { recursive: true });

const EXTENSOES_PERMITIDAS = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${EXTENSOES_PERMITIDAS[file.mimetype] || ''}`)
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!EXTENSOES_PERMITIDAS[file.mimetype]) {
      return cb(new Error('Formato de imagem não suportado. Use JPG, PNG, WEBP ou GIF.'));
    }
    cb(null, true);
  }
});

function receberImagem(req, res, next) {
  upload.single('imagem')(req, res, (err) => {
    if (err) return res.status(400).json({ erro: err.message || 'Erro ao enviar imagem' });
    next();
  });
}

function excluirArquivoImagem(imagemUrl) {
  if (!imagemUrl) return;
  const caminho = path.join(uploadsDir, path.basename(imagemUrl));
  fs.unlink(caminho, () => {}); // ignora erro (ex: arquivo já não existe)
}

function mapMovimento(row) {
  return {
    id: row.id,
    produtoId: row.produto_id,
    tipo: row.tipo,
    quantidade: row.quantidade,
    motivo: row.motivo,
    data: row.data,
    vendaId: row.venda_id || undefined,
    pedidoId: row.pedido_id || undefined
  };
}

router.get('/', asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM produtos ORDER BY id');
  res.json(rows.map(mapProduto));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [rows] = await pool.query('SELECT * FROM produtos WHERE id = ?', [id]);
  if (rows.length === 0) return res.status(404).json({ erro: 'Produto não encontrado' });
  res.json(mapProduto(rows[0]));
}));

router.post('/', receberImagem, asyncHandler(async (req, res) => {
  const { nome, precoCusto, precoVenda, estoqueInicial, lancarCompraNoCaixa, tags } = req.body;
  const imagemUrl = req.file ? '/uploads/produtos/' + req.file.filename : null;

  if (!nome || !nome.trim()) {
    excluirArquivoImagem(imagemUrl);
    return res.status(400).json({ erro: 'Nome é obrigatório' });
  }
  const custo = Number(precoCusto);
  const venda = Number(precoVenda);
  const estoque = Number(estoqueInicial) || 0;
  if (isNaN(custo) || custo < 0 || isNaN(venda) || venda < 0) {
    excluirArquivoImagem(imagemUrl);
    return res.status(400).json({ erro: 'Preço de custo e preço de venda devem ser números válidos' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const data = new Date();
    const nomeTrim = nome.trim();

    const [result] = await conn.query(
      'INSERT INTO produtos (nome, preco_custo, preco_venda, estoque, imagem, tags, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [nomeTrim, custo, venda, estoque, imagemUrl, normalizarTags(tags), data]
    );
    const produtoId = result.insertId;

    if (estoque > 0) {
      await conn.query(
        `INSERT INTO movimentos_estoque (produto_id, tipo, quantidade, motivo, data)
         VALUES (?, 'entrada', ?, 'Estoque inicial', ?)`,
        [produtoId, estoque, data]
      );

      // Por padrão, já lança a compra desse estoque inicial no caixa (evita lançamento manual sujeito a erro)
      if (custo > 0 && lancarCompraNoCaixa !== false && lancarCompraNoCaixa !== 'false') {
        await conn.query(
          `INSERT INTO caixa (tipo, categoria, valor, descricao, data)
           VALUES ('saida', 'Compra de mercadoria', ?, ?, ?)`,
          [estoque * custo, `Estoque inicial de ${nomeTrim} (${estoque}x)`, data]
        );
      }
    }

    await conn.commit();
    const [rows] = await pool.query('SELECT * FROM produtos WHERE id = ?', [produtoId]);
    res.status(201).json(mapProduto(rows[0]));
  } catch (err) {
    await conn.rollback();
    excluirArquivoImagem(imagemUrl);
    throw err;
  } finally {
    conn.release();
  }
}));

router.put('/:id', receberImagem, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [rows] = await pool.query('SELECT * FROM produtos WHERE id = ?', [id]);
  if (rows.length === 0) {
    excluirArquivoImagem(req.file ? '/uploads/produtos/' + req.file.filename : null);
    return res.status(404).json({ erro: 'Produto não encontrado' });
  }
  const atual = rows[0];
  const { nome, precoCusto, precoVenda, tags, removerImagem } = req.body;

  let imagemUrl = atual.imagem;
  if (req.file) {
    excluirArquivoImagem(atual.imagem);
    imagemUrl = '/uploads/produtos/' + req.file.filename;
  } else if (removerImagem === 'true') {
    excluirArquivoImagem(atual.imagem);
    imagemUrl = null;
  }

  await pool.query(
    'UPDATE produtos SET nome = ?, preco_custo = ?, preco_venda = ?, imagem = ?, tags = ? WHERE id = ?',
    [
      nome !== undefined ? nome : atual.nome,
      precoCusto !== undefined ? Number(precoCusto) : atual.preco_custo,
      precoVenda !== undefined ? Number(precoVenda) : atual.preco_venda,
      imagemUrl,
      tags !== undefined ? normalizarTags(tags) : atual.tags,
      id
    ]
  );
  const [atualizado] = await pool.query('SELECT * FROM produtos WHERE id = ?', [id]);
  res.json(mapProduto(atualizado[0]));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [itensVenda] = await pool.query('SELECT id FROM venda_itens WHERE produto_id = ? LIMIT 1', [id]);
  if (itensVenda.length > 0) {
    return res.status(400).json({ erro: 'Produto possui vendas e não pode ser excluído' });
  }
  const [itensPedido] = await pool.query('SELECT id FROM pedido_itens WHERE produto_id = ? LIMIT 1', [id]);
  if (itensPedido.length > 0) {
    return res.status(400).json({ erro: 'Produto possui pedidos e não pode ser excluído' });
  }
  const [rows] = await pool.query('SELECT imagem FROM produtos WHERE id = ?', [id]);
  await pool.query('DELETE FROM produtos WHERE id = ?', [id]);
  if (rows[0]) excluirArquivoImagem(rows[0].imagem);
  res.status(204).end();
}));

// Registrar entrada de estoque (ex: comprou mais produto para revender)
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
    const [rows] = await conn.query('SELECT * FROM produtos WHERE id = ? FOR UPDATE', [id]);
    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ erro: 'Produto não encontrado' });
    }
    const produto = rows[0];
    const data = new Date();

    await conn.query('UPDATE produtos SET estoque = estoque + ? WHERE id = ?', [quantidade, id]);

    const motivo = req.body.motivo || 'Compra de mercadoria';
    const [movResult] = await conn.query(
      `INSERT INTO movimentos_estoque (produto_id, tipo, quantidade, motivo, data) VALUES (?, 'entrada', ?, ?, ?)`,
      [id, quantidade, motivo, data]
    );

    // Se informou o custo total pago, lança automaticamente como saída no caixa
    if (custoTotal !== null && custoTotal > 0) {
      await conn.query(
        `INSERT INTO caixa (tipo, categoria, valor, descricao, data)
         VALUES ('saida', 'Compra de mercadoria', ?, ?, ?)`,
        [custoTotal, `Compra de ${quantidade}x ${produto.nome}`, data]
      );
    }

    await conn.commit();
    const [produtoAtualizado] = await pool.query('SELECT * FROM produtos WHERE id = ?', [id]);
    const [movimentoRows] = await pool.query('SELECT * FROM movimentos_estoque WHERE id = ?', [movResult.insertId]);
    res.status(201).json({ produto: mapProduto(produtoAtualizado[0]), movimento: mapMovimento(movimentoRows[0]) });
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
    const [rows] = await conn.query('SELECT * FROM produtos WHERE id = ? FOR UPDATE', [id]);
    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ erro: 'Produto não encontrado' });
    }
    const produto = rows[0];
    if (quantidade > produto.estoque) {
      await conn.rollback();
      return res.status(400).json({ erro: 'Estoque insuficiente' });
    }
    const data = new Date();

    await conn.query('UPDATE produtos SET estoque = estoque - ? WHERE id = ?', [quantidade, id]);

    const motivo = req.body.motivo || 'Ajuste manual';
    const [movResult] = await conn.query(
      `INSERT INTO movimentos_estoque (produto_id, tipo, quantidade, motivo, data) VALUES (?, 'saida', ?, ?, ?)`,
      [id, quantidade, motivo, data]
    );

    await conn.commit();
    const [produtoAtualizado] = await pool.query('SELECT * FROM produtos WHERE id = ?', [id]);
    const [movimentoRows] = await pool.query('SELECT * FROM movimentos_estoque WHERE id = ?', [movResult.insertId]);
    res.status(201).json({ produto: mapProduto(produtoAtualizado[0]), movimento: mapMovimento(movimentoRows[0]) });
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
    'SELECT * FROM movimentos_estoque WHERE produto_id = ? ORDER BY data DESC, id DESC',
    [id]
  );
  res.json(rows.map(mapMovimento));
}));

module.exports = router;
