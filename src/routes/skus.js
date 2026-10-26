const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
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
    fornecedorId: row.fornecedor_id || null,
    fornecedorNome: row.fornecedor_nome || null,
    criadoEm: row.criado_em
  };
}

const SELECT_SKU_COM_FORNECEDOR = `
  SELECT s.*, f.nome AS fornecedor_nome
  FROM skus s
  LEFT JOIN fornecedores f ON f.id = s.fornecedor_id
`;

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
  const [rows] = await pool.query(`${SELECT_SKU_COM_FORNECEDOR} ORDER BY s.codigo`);
  res.json(rows.map(mapSku));
}));

// Export para conferência física: gera um XLSX com o estoque do sistema e uma coluna em
// branco pra anotar o estoque real contado. É o mesmo arquivo que a página de ajuste de
// estoque espera de volta (ver TODO). Precisa vir antes de GET /:id pra não colidir com ele.
router.get('/exportar-estoque', asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM skus ORDER BY codigo, nome');

  const workbook = new ExcelJS.Workbook();
  const planilha = workbook.addWorksheet('Estoque');
  planilha.columns = [
    { header: 'ID', key: 'id', width: 10 },
    { header: 'Código', key: 'codigo', width: 18 },
    { header: 'Nome', key: 'nome', width: 40 },
    { header: 'Estoque sistema', key: 'estoqueSistema', width: 16 },
    { header: 'Estoque real', key: 'estoqueReal', width: 16 }
  ];
  planilha.getRow(1).font = { bold: true };

  for (const row of rows) {
    planilha.addRow({
      id: row.id,
      codigo: row.codigo || '',
      nome: row.nome,
      estoqueSistema: row.estoque,
      estoqueReal: null
    });
  }

  const dataHoje = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="estoque-${dataHoje}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}));

// ---------- Ajuste de estoque via importação do XLSX exportado acima ----------

const uploadEstoque = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const nomeOk = /\.xlsx$/i.test(file.originalname || '');
    const tipoOk = file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (!nomeOk && !tipoOk) return cb(new Error('Arquivo precisa ser uma planilha .xlsx'));
    cb(null, true);
  }
});

function receberArquivoEstoque(req, res, next) {
  uploadEstoque.single('arquivo')(req, res, (err) => {
    if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ erro: 'Arquivo maior que o limite de 5MB' });
    if (err) return res.status(400).json({ erro: err.message || 'Erro ao enviar arquivo' });
    next();
  });
}

// exceljs devolve formatos diferentes conforme o tipo da célula (texto simples, fórmula com
// resultado, rich text) — normaliza tudo pra um valor primitivo (string/número) ou null.
function extrairValorCelula(valor) {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'object' && !(valor instanceof Date)) {
    if ('result' in valor) return valor.result;
    if ('richText' in valor) return valor.richText.map(t => t.text).join('');
    return null;
  }
  return valor;
}

// Compara o estoque real (vindo da planilha ou já confirmado pelo usuário) com o estoque
// atual do SKU e decide o que fazer. Usada tanto na prévia (Issue 1) quanto na aplicação
// (Issue 2) — as duas etapas precisam concordar exatamente sobre o que é entrada/saída/etc.
function classificarLinha(skuAtual, estoqueRealBruto) {
  if (!skuAtual) return { classificacao: 'ignorado_sku_nao_encontrado' };

  const valor = extrairValorCelula(estoqueRealBruto);
  if (valor === null || valor === '') return { classificacao: 'ignorado_nao_contado' };

  const estoqueReal = Number(valor);
  if (!Number.isInteger(estoqueReal) || estoqueReal < 0) {
    return { classificacao: 'ignorado_valor_invalido' };
  }

  const diferenca = estoqueReal - skuAtual.estoque;
  if (diferenca === 0) return { classificacao: 'sem_alteracao', estoqueReal, diferenca: 0 };
  return { classificacao: diferenca > 0 ? 'entrada' : 'saida', estoqueReal, diferenca };
}

router.post('/importar-estoque', receberArquivoEstoque, asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado' });

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(req.file.buffer);
  } catch {
    return res.status(400).json({ erro: 'Arquivo inválido ou corrompido' });
  }

  const planilha = workbook.worksheets[0];
  if (!planilha) return res.status(400).json({ erro: 'Planilha vazia' });

  // Colunas são achadas pelo texto do cabeçalho, não pela posição — sobrevive a reordenação
  // manual de colunas no Excel.
  let colId = null;
  let colEstoqueReal = null;
  planilha.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const texto = String(extrairValorCelula(cell.value) || '').trim().toLowerCase();
    if (texto === 'id') colId = colNumber;
    if (texto === 'estoque real') colEstoqueReal = colNumber;
  });

  const colunasFaltando = [];
  if (!colId) colunasFaltando.push('ID');
  if (!colEstoqueReal) colunasFaltando.push('Estoque real');
  if (colunasFaltando.length > 0) {
    return res.status(400).json({ erro: `A planilha precisa ter as colunas: ${colunasFaltando.join(', ')}` });
  }

  const linhasBrutas = [];
  for (let numeroLinha = 2; numeroLinha <= planilha.rowCount; numeroLinha++) {
    const linha = planilha.getRow(numeroLinha);
    const idBruto = extrairValorCelula(linha.getCell(colId).value);
    const estoqueRealBruto = extrairValorCelula(linha.getCell(colEstoqueReal).value);
    const linhaEmBranco = (idBruto === null || idBruto === '') && (estoqueRealBruto === null || estoqueRealBruto === '');
    if (linhaEmBranco) continue;
    linhasBrutas.push({ idBruto, estoqueRealBruto });
  }

  const contagemPorId = new Map();
  for (const { idBruto } of linhasBrutas) {
    const id = Number(idBruto);
    if (!Number.isFinite(id)) continue;
    contagemPorId.set(id, (contagemPorId.get(id) || 0) + 1);
  }
  const duplicados = [...contagemPorId.entries()].filter(([, contagem]) => contagem > 1).map(([id]) => id);
  if (duplicados.length > 0) {
    return res.status(400).json({ erro: `ID duplicado na planilha: ${duplicados.join(', ')}` });
  }

  const [skusRows] = await pool.query('SELECT id, codigo, nome, estoque FROM skus');
  const skusPorId = new Map(skusRows.map(s => [s.id, s]));

  const linhas = linhasBrutas.map(({ idBruto, estoqueRealBruto }) => {
    const skuId = Number(idBruto);
    const skuAtual = skusPorId.get(skuId);
    const { classificacao, estoqueReal, diferenca } = classificarLinha(skuAtual, estoqueRealBruto);
    return {
      skuId: Number.isFinite(skuId) ? skuId : null,
      codigo: skuAtual ? skuAtual.codigo : null,
      nome: skuAtual ? skuAtual.nome : null,
      estoqueSistema: skuAtual ? skuAtual.estoque : null,
      estoqueReal: estoqueReal === undefined ? null : estoqueReal,
      diferenca: diferenca === undefined ? null : diferenca,
      classificacao
    };
  });

  const resumo = { totalLinhas: linhas.length, aAjustar: 0, semAlteracao: 0, ignorados: 0 };
  for (const l of linhas) {
    if (l.classificacao === 'entrada' || l.classificacao === 'saida') resumo.aAjustar++;
    else if (l.classificacao === 'sem_alteracao') resumo.semAlteracao++;
    else resumo.ignorados++;
  }

  res.json({ linhas, resumo });
}));

const MOTIVOS_NAO_APLICADO = {
  sem_alteracao: 'Estoque já estava correto no momento da aplicação',
  ignorado_nao_contado: 'Valor de estoque real não informado',
  ignorado_valor_invalido: 'Valor de estoque real inválido',
  ignorado_sku_nao_encontrado: 'SKU não encontrado'
};

router.post('/importar-estoque/aplicar', asyncHandler(async (req, res) => {
  const { linhas } = req.body;
  if (!Array.isArray(linhas) || linhas.length === 0) {
    return res.status(400).json({ erro: 'Nenhuma linha para aplicar' });
  }

  const aplicados = [];
  const ignorados = [];

  for (const linha of linhas) {
    const skuId = Number(linha.skuId);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query('SELECT * FROM skus WHERE id = ? FOR UPDATE', [skuId]);
      if (rows.length === 0) {
        await conn.rollback();
        ignorados.push({ skuId, motivo: MOTIVOS_NAO_APLICADO.ignorado_sku_nao_encontrado });
        continue;
      }

      const skuAtual = rows[0];
      // Recalcula com o estoque ATUAL do banco — nunca confia na diferença computada na
      // prévia, que pode estar desatualizada se algo mudou o estoque nesse meio-tempo.
      const { classificacao, estoqueReal, diferenca } = classificarLinha(skuAtual, linha.estoqueReal);

      if (classificacao !== 'entrada' && classificacao !== 'saida') {
        await conn.rollback();
        ignorados.push({ skuId, motivo: MOTIVOS_NAO_APLICADO[classificacao] || 'Ignorado' });
        continue;
      }

      await conn.query('UPDATE skus SET estoque = ? WHERE id = ?', [estoqueReal, skuId]);
      await conn.query(
        `INSERT INTO movimentos_estoque (sku_id, tipo, quantidade, motivo, data) VALUES (?, ?, ?, 'Ajuste de estoque (inventário)', ?)`,
        [skuId, classificacao, Math.abs(diferenca), new Date()]
      );
      await conn.commit();

      aplicados.push({
        skuId,
        nome: skuAtual.nome,
        estoqueAntes: skuAtual.estoque,
        estoqueDepois: estoqueReal,
        tipo: classificacao,
        quantidade: Math.abs(diferenca)
      });
    } catch (err) {
      await conn.rollback();
      ignorados.push({ skuId, motivo: 'Erro inesperado ao aplicar este SKU' });
    } finally {
      conn.release();
    }
  }

  res.json({ aplicados, ignorados });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [rows] = await pool.query(`${SELECT_SKU_COM_FORNECEDOR} WHERE s.id = ?`, [id]);
  if (rows.length === 0) return res.status(404).json({ erro: 'SKU não encontrado' });
  res.json(mapSku(rows[0]));
}));

// Valida e normaliza um fornecedorId opcional vindo do formulário ('' ou undefined = sem fornecedor).
async function normalizarFornecedorId(conn, fornecedorId) {
  if (fornecedorId === undefined || fornecedorId === null || fornecedorId === '') return { fornecedorId: null };
  const id = Number(fornecedorId);
  const [rows] = await conn.query('SELECT id FROM fornecedores WHERE id = ?', [id]);
  if (rows.length === 0) return { erro: 'Fornecedor selecionado não foi encontrado' };
  return { fornecedorId: id };
}

router.post('/', asyncHandler(async (req, res) => {
  const { codigo, nome, precoCusto, estoqueInicial, lancarCompraNoCaixa, fornecedorId } = req.body;

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
    const { erro: erroFornecedor, fornecedorId: fornecedorIdFinal } = await normalizarFornecedorId(conn, fornecedorId);
    if (erroFornecedor) {
      await conn.rollback();
      return res.status(400).json({ erro: erroFornecedor });
    }

    const data = new Date();
    const [result] = await conn.query(
      'INSERT INTO skus (codigo, nome, preco_custo, estoque, fornecedor_id, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
      [codigoFinal, nomeFinal, custo, estoque, fornecedorIdFinal, data]
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
    const [skuCompleto] = await pool.query(`${SELECT_SKU_COM_FORNECEDOR} WHERE s.id = ?`, [skuId]);
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
  const { codigo, nome, precoCusto, fornecedorId } = req.body;

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

  let fornecedorIdFinal = atual.fornecedor_id;
  if (fornecedorId !== undefined) {
    const { erro: erroFornecedor, fornecedorId: normalizado } = await normalizarFornecedorId(pool, fornecedorId);
    if (erroFornecedor) return res.status(400).json({ erro: erroFornecedor });
    fornecedorIdFinal = normalizado;
  }

  await pool.query(
    'UPDATE skus SET codigo = ?, nome = ?, preco_custo = ?, fornecedor_id = ? WHERE id = ?',
    [
      codigoFinal,
      nomeFinal,
      precoCusto !== undefined ? Number(precoCusto) : atual.preco_custo,
      fornecedorIdFinal,
      id
    ]
  );
  const [atualizado] = await pool.query(`${SELECT_SKU_COM_FORNECEDOR} WHERE s.id = ?`, [id]);
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
