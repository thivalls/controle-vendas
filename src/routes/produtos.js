const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pool } = require('../db');
const asyncHandler = require('../asyncHandler');

const router = express.Router();

function normalizarTags(tags) {
  if (!tags) return '';
  const lista = Array.isArray(tags) ? tags : String(tags).split(',');
  return lista.map(t => t.trim()).filter(Boolean).join(', ');
}

// Produto (simples ou kit) nunca guarda custo/estoque direto — sempre calculado a partir
// dos SKUs vinculados (produto_skus). Simples tem exatamente 1 SKU (quantidade 1), então
// o cálculo já "vira" o valor direto do SKU nesse caso — não precisa de caso especial.
function mapProduto(row, skusVinculados) {
  const lista = skusVinculados || [];
  const precoCusto = lista.reduce((soma, s) => soma + s.precoCusto * s.quantidade, 0);
  const estoque = lista.length === 0 ? 0 : Math.min(...lista.map(s => Math.floor(s.estoque / s.quantidade)));
  return {
    id: row.id,
    tipo: row.tipo,
    nome: row.nome,
    precoCusto,
    precoVenda: row.preco_venda,
    estoque,
    imagem: row.imagem || null,
    tags: row.tags ? row.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
    criadoEm: row.criado_em,
    sku: row.tipo === 'simples' && lista[0] ? lista[0].codigo : null,
    skus: lista
  };
}

async function buscarSkusPorProduto(idsProdutos) {
  const porProduto = new Map();
  if (idsProdutos.length === 0) return porProduto;
  const [rows] = await pool.query(
    `SELECT pks.produto_id, pks.sku_id, pks.quantidade,
            s.codigo AS sku_codigo, s.nome AS sku_nome, s.preco_custo AS sku_preco_custo, s.estoque AS sku_estoque
     FROM produto_skus pks
     JOIN skus s ON s.id = pks.sku_id
     WHERE pks.produto_id IN (?)
     ORDER BY pks.id`,
    [idsProdutos]
  );
  for (const row of rows) {
    if (!porProduto.has(row.produto_id)) porProduto.set(row.produto_id, []);
    porProduto.get(row.produto_id).push({
      skuId: row.sku_id,
      codigo: row.sku_codigo,
      nome: row.sku_nome,
      quantidade: row.quantidade,
      precoCusto: row.sku_preco_custo,
      estoque: row.sku_estoque
    });
  }
  return porProduto;
}

async function buscarProdutosCompletos(whereSql = '', params = []) {
  const [rows] = await pool.query(`SELECT * FROM produtos ${whereSql} ORDER BY id`, params);
  if (rows.length === 0) return [];
  const skusPorProduto = await buscarSkusPorProduto(rows.map(r => r.id));
  return rows.map(row => mapProduto(row, skusPorProduto.get(row.id)));
}

// Lê e valida a lista de SKUs de um kit vinda do formulário (JSON em string, por causa do
// multipart). Retorna { erro } ou { skus: Map<skuId, quantidade> }.
function lerSkusDoBody(skusBrutos) {
  let lista;
  try {
    lista = typeof skusBrutos === 'string' ? JSON.parse(skusBrutos) : skusBrutos;
  } catch {
    return { erro: 'Lista de SKUs do kit inválida' };
  }
  if (!Array.isArray(lista)) return { erro: 'Lista de SKUs do kit inválida' };

  const porSku = new Map();
  for (const item of lista) {
    const skuId = Number(item.skuId);
    const quantidade = Number(item.quantidade);
    if (!skuId || !quantidade || quantidade <= 0) {
      return { erro: 'Todos os componentes do kit precisam de um SKU e quantidade válidos' };
    }
    porSku.set(skuId, (porSku.get(skuId) || 0) + quantidade);
  }
  if (porSku.size < 2) return { erro: 'Um kit precisa de pelo menos 2 SKUs diferentes' };
  return { skus: porSku };
}

async function validarSkusExistem(conn, idsSkus) {
  const [rows] = await conn.query('SELECT id FROM skus WHERE id IN (?)', [idsSkus]);
  if (rows.length !== idsSkus.length) return 'Um ou mais SKUs do kit não foram encontrados';
  return null;
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

router.get('/', asyncHandler(async (req, res) => {
  res.json(await buscarProdutosCompletos());
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [produto] = await buscarProdutosCompletos('WHERE id = ?', [id]);
  if (!produto) return res.status(404).json({ erro: 'Produto não encontrado' });
  res.json(produto);
}));

router.post('/', receberImagem, asyncHandler(async (req, res) => {
  const { codigo, precoCusto, tipo, nome, precoVenda, estoqueInicial, lancarCompraNoCaixa, tags, componentes, skuExistenteId } = req.body;
  const imagemUrl = req.file ? '/uploads/produtos/' + req.file.filename : null;
  const tipoFinal = tipo === 'kit' ? 'kit' : 'simples';
  const skuExistenteIdNum = tipoFinal === 'simples' && skuExistenteId ? Number(skuExistenteId) : null;

  function recusar(status, mensagem) {
    excluirArquivoImagem(imagemUrl);
    res.status(status).json({ erro: mensagem });
    return null;
  }

  if (!nome || !nome.trim()) return recusar(400, 'Nome é obrigatório');
  const venda = Number(precoVenda);
  if (isNaN(venda) || venda < 0) return recusar(400, 'Preço de venda deve ser um número válido');
  const nomeTrim = nome.trim();

  let componentesValidados = null;
  let custo, codigoFinal, estoqueInicialNum;
  if (tipoFinal === 'kit') {
    const { erro, skus: mapaSkus } = lerSkusDoBody(componentes);
    if (erro) return recusar(400, erro);
    componentesValidados = mapaSkus;
  } else if (!skuExistenteIdNum) {
    custo = Number(precoCusto);
    if (isNaN(custo) || custo < 0) return recusar(400, 'Preço de custo deve ser um número válido');
    codigoFinal = codigo && codigo.trim() ? codigo.trim() : null;
    estoqueInicialNum = Number(estoqueInicial) || 0;
  }

  const conn = await pool.getConnection();
  let produtoId;
  try {
    await conn.beginTransaction();
    const data = new Date();

    // Produto simples sempre cria (ou reaproveita, se o nome bater) um SKU com o mesmo
    // nome do produto — o conceito de SKU fica escondido do usuário nesse fluxo. O nome
    // do SKU precisa ser único, então essa checagem também é o que evita produto duplicado.
    // Quando vincula a um SKU já existente (skuExistenteId), nada disso se aplica: o SKU
    // mantém seu próprio nome/código, só ganha um vínculo em produto_skus.
    let skuIdFinal = null;
    if (tipoFinal === 'simples' && !skuExistenteIdNum) {
      const [nomeExistente] = await conn.query('SELECT id FROM skus WHERE nome = ?', [nomeTrim]);
      if (nomeExistente.length > 0) {
        await conn.rollback();
        return recusar(400, `Já existe um produto ou SKU com o nome "${nomeTrim}"`);
      }
      if (codigoFinal) {
        const [codigoExistente] = await conn.query('SELECT id FROM skus WHERE codigo = ?', [codigoFinal]);
        if (codigoExistente.length > 0) {
          await conn.rollback();
          return recusar(400, `Já existe um SKU com o código "${codigoFinal}"`);
        }
      }
    }
    if (skuExistenteIdNum) {
      const [skuRows] = await conn.query('SELECT id FROM skus WHERE id = ?', [skuExistenteIdNum]);
      if (skuRows.length === 0) {
        await conn.rollback();
        return recusar(400, 'SKU selecionado não foi encontrado');
      }
    }

    const [result] = await conn.query(
      `INSERT INTO produtos (tipo, nome, preco_venda, imagem, tags, criado_em) VALUES (?, ?, ?, ?, ?, ?)`,
      [tipoFinal, nomeTrim, venda, imagemUrl, normalizarTags(tags), data]
    );
    produtoId = result.insertId;

    if (tipoFinal === 'kit') {
      const idsSkus = [...componentesValidados.keys()];
      const erroSkus = await validarSkusExistem(conn, idsSkus);
      if (erroSkus) {
        await conn.rollback();
        return recusar(400, erroSkus);
      }
      for (const [skuIdComponente, quantidade] of componentesValidados) {
        await conn.query('INSERT INTO produto_skus (produto_id, sku_id, quantidade) VALUES (?, ?, ?)', [produtoId, skuIdComponente, quantidade]);
      }
    } else if (skuExistenteIdNum) {
      await conn.query('INSERT INTO produto_skus (produto_id, sku_id, quantidade) VALUES (?, ?, 1)', [produtoId, skuExistenteIdNum]);
    } else {
      const [resultSku] = await conn.query(
        'INSERT INTO skus (codigo, nome, preco_custo, estoque, criado_em) VALUES (?, ?, ?, ?, ?)',
        [codigoFinal, nomeTrim, custo, estoqueInicialNum, data]
      );
      skuIdFinal = resultSku.insertId;

      if (estoqueInicialNum > 0) {
        await conn.query(
          `INSERT INTO movimentos_estoque (sku_id, tipo, quantidade, motivo, data) VALUES (?, 'entrada', ?, 'Estoque inicial', ?)`,
          [skuIdFinal, estoqueInicialNum, data]
        );
        if (custo > 0 && lancarCompraNoCaixa !== false && lancarCompraNoCaixa !== 'false') {
          await conn.query(
            `INSERT INTO caixa (tipo, categoria, valor, descricao, data) VALUES ('saida', 'Compra de mercadoria', ?, ?, ?)`,
            [estoqueInicialNum * custo, `Estoque inicial de ${nomeTrim} (${estoqueInicialNum}x)`, data]
          );
        }
      }
      await conn.query('INSERT INTO produto_skus (produto_id, sku_id, quantidade) VALUES (?, ?, 1)', [produtoId, skuIdFinal]);
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    excluirArquivoImagem(imagemUrl);
    throw err;
  } finally {
    conn.release();
  }

  const [produtoCompleto] = await buscarProdutosCompletos('WHERE id = ?', [produtoId]);
  res.status(201).json(produtoCompleto);
}));

router.put('/:id', receberImagem, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [rows] = await pool.query('SELECT * FROM produtos WHERE id = ?', [id]);
  if (rows.length === 0) {
    excluirArquivoImagem(req.file ? '/uploads/produtos/' + req.file.filename : null);
    return res.status(404).json({ erro: 'Produto não encontrado' });
  }
  const atual = rows[0];
  const { codigo, precoCusto, nome, precoVenda, tags, removerImagem, componentes, skuExistenteId } = req.body;
  const nomeFinal = nome !== undefined && nome.trim() ? nome.trim() : atual.nome;
  const skuExistenteIdNum = atual.tipo === 'simples' && skuExistenteId ? Number(skuExistenteId) : null;

  // Valida antes de mexer em qualquer arquivo: se a atualização for rejeitada, a imagem
  // atual do produto não pode ter sido apagada no meio do caminho. Produto simples tem
  // exatamente 1 SKU vinculado (nome sincronizado com o do produto) — atualiza ele direto.
  // Quando troca para vincular um SKU diferente (skuExistenteId), nenhum desses campos de
  // criação (nome/código/preço de custo do SKU atual) é usado — só troca o vínculo.
  let skuAtualId = null;
  if (atual.tipo === 'simples') {
    const [skuVinculado] = await pool.query('SELECT sku_id FROM produto_skus WHERE produto_id = ?', [id]);
    skuAtualId = skuVinculado[0].sku_id;

    if (!skuExistenteIdNum) {
      if (nomeFinal !== atual.nome) {
        const [nomeExistente] = await pool.query('SELECT id FROM skus WHERE nome = ? AND id != ?', [nomeFinal, skuAtualId]);
        if (nomeExistente.length > 0) {
          excluirArquivoImagem(req.file ? '/uploads/produtos/' + req.file.filename : null);
          return res.status(400).json({ erro: `Já existe um produto ou SKU com o nome "${nomeFinal}"` });
        }
      }
      if (codigo !== undefined && codigo.trim()) {
        const [codigoExistente] = await pool.query('SELECT id FROM skus WHERE codigo = ? AND id != ?', [codigo.trim(), skuAtualId]);
        if (codigoExistente.length > 0) {
          excluirArquivoImagem(req.file ? '/uploads/produtos/' + req.file.filename : null);
          return res.status(400).json({ erro: `Já existe um SKU com o código "${codigo.trim()}"` });
        }
      }
      if (precoCusto !== undefined) {
        const custo = Number(precoCusto);
        if (isNaN(custo) || custo < 0) {
          excluirArquivoImagem(req.file ? '/uploads/produtos/' + req.file.filename : null);
          return res.status(400).json({ erro: 'Preço de custo deve ser um número válido' });
        }
      }
    } else {
      const [skuRows] = await pool.query('SELECT id FROM skus WHERE id = ?', [skuExistenteIdNum]);
      if (skuRows.length === 0) {
        excluirArquivoImagem(req.file ? '/uploads/produtos/' + req.file.filename : null);
        return res.status(400).json({ erro: 'SKU selecionado não foi encontrado' });
      }
    }
  }

  let mapaComponentes = null;
  if (atual.tipo === 'kit' && componentes !== undefined) {
    const resultado = lerSkusDoBody(componentes);
    if (resultado.erro) {
      excluirArquivoImagem(req.file ? '/uploads/produtos/' + req.file.filename : null);
      return res.status(400).json({ erro: resultado.erro });
    }
    const erroSkus = await validarSkusExistem(pool, [...resultado.skus.keys()]);
    if (erroSkus) {
      excluirArquivoImagem(req.file ? '/uploads/produtos/' + req.file.filename : null);
      return res.status(400).json({ erro: erroSkus });
    }
    mapaComponentes = resultado.skus;
  }

  let imagemUrl = atual.imagem;
  if (req.file) {
    excluirArquivoImagem(atual.imagem);
    imagemUrl = '/uploads/produtos/' + req.file.filename;
  } else if (removerImagem === 'true') {
    excluirArquivoImagem(atual.imagem);
    imagemUrl = null;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (skuExistenteIdNum) {
      await conn.query('DELETE FROM produto_skus WHERE produto_id = ?', [id]);
      await conn.query('INSERT INTO produto_skus (produto_id, sku_id, quantidade) VALUES (?, ?, 1)', [id, skuExistenteIdNum]);
    } else if (skuAtualId) {
      const [skuAtual] = await conn.query('SELECT * FROM skus WHERE id = ?', [skuAtualId]);
      await conn.query(
        'UPDATE skus SET nome = ?, codigo = ?, preco_custo = ? WHERE id = ?',
        [
          nomeFinal,
          codigo !== undefined ? (codigo.trim() ? codigo.trim() : null) : skuAtual[0].codigo,
          precoCusto !== undefined ? Number(precoCusto) : skuAtual[0].preco_custo,
          skuAtualId
        ]
      );
    }
    if (mapaComponentes) {
      await conn.query('DELETE FROM produto_skus WHERE produto_id = ?', [id]);
      for (const [skuIdComponente, quantidade] of mapaComponentes) {
        await conn.query('INSERT INTO produto_skus (produto_id, sku_id, quantidade) VALUES (?, ?, ?)', [id, skuIdComponente, quantidade]);
      }
    }

    await conn.query(
      'UPDATE produtos SET nome = ?, preco_venda = ?, imagem = ?, tags = ? WHERE id = ?',
      [
        nomeFinal,
        precoVenda !== undefined ? Number(precoVenda) : atual.preco_venda,
        imagemUrl,
        tags !== undefined ? normalizarTags(tags) : atual.tags,
        id
      ]
    );

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  const [produtoCompleto] = await buscarProdutosCompletos('WHERE id = ?', [id]);
  res.json(produtoCompleto);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [itensVenda] = await pool.query('SELECT id FROM venda_itens WHERE produto_id = ? LIMIT 1', [id]);
  if (itensVenda.length > 0) {
    return res.status(400).json({ erro: 'Produto possui vendas e não pode ser excluído' });
  }
  const [rows] = await pool.query('SELECT imagem FROM produtos WHERE id = ?', [id]);
  if (rows.length === 0) return res.status(404).json({ erro: 'Produto não encontrado' });
  await pool.query('DELETE FROM produtos WHERE id = ?', [id]);
  excluirArquivoImagem(rows[0].imagem);
  res.status(204).end();
}));

module.exports = router;
