const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'controle',
  password: process.env.DB_PASSWORD || 'controle',
  database: process.env.DB_NAME || 'controle_vendas',
  decimalNumbers: true,
  timezone: 'Z'
};

const pool = mysql.createPool({
  ...dbConfig,
  waitForConnections: true,
  connectionLimit: 10
});

async function waitForDb(retries = 30, delayMs = 2000) {
  for (let tentativa = 1; tentativa <= retries; tentativa++) {
    try {
      const conn = await pool.getConnection();
      conn.release();
      return;
    } catch (err) {
      console.log(`Aguardando banco de dados MySQL... (${tentativa}/${retries})`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  throw new Error('Não foi possível conectar ao banco de dados MySQL depois de várias tentativas.');
}

async function initSchema() {
  const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  const conn = await mysql.createConnection({ ...dbConfig, multipleStatements: true });
  try {
    await conn.query(schemaSql);
    await migrarColunas(conn);
  } finally {
    await conn.end();
  }
}

// MySQL não suporta "ADD COLUMN IF NOT EXISTS", então checamos o information_schema
// antes de alterar tabelas já existentes (evita erro ao reiniciar com dados reais).
async function colunaExiste(conn, tabela, coluna) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS existe FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [dbConfig.database, tabela, coluna]
  );
  return rows[0].existe > 0;
}

async function tabelaExiste(conn, tabela) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS existe FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [dbConfig.database, tabela]
  );
  return rows[0].existe > 0;
}

async function adicionarColunaSeNaoExistir(conn, tabela, coluna, definicaoSql) {
  if (await colunaExiste(conn, tabela, coluna)) return;
  await conn.query(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${definicaoSql}`);
}

async function removerIndiceSeExistir(conn, tabela, indice) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS existe FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [dbConfig.database, tabela, indice]
  );
  if (rows[0].existe > 0) {
    await conn.query(`ALTER TABLE ${tabela} DROP INDEX ${indice}`);
  }
}

async function removerForeignKeySeExistir(conn, tabela, coluna) {
  const [rows] = await conn.query(
    `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
    [dbConfig.database, tabela, coluna]
  );
  for (const row of rows) {
    await conn.query(`ALTER TABLE ${tabela} DROP FOREIGN KEY ${row.CONSTRAINT_NAME}`);
  }
}

// Pagamento pendente: permite registrar a venda (e a receita/estoque) no ato,
// mesmo quando o dinheiro só cai no caixa depois (ex: cartão com prazo de 30/45 dias).
async function migrarColunas(conn) {
  await adicionarColunaSeNaoExistir(conn, 'vendas', 'status_pagamento', "ENUM('pago', 'pendente') NOT NULL DEFAULT 'pago'");
  await adicionarColunaSeNaoExistir(conn, 'vendas', 'data_pagamento', 'DATETIME NULL');
  await adicionarColunaSeNaoExistir(conn, 'vendas', 'previsao_pagamento', 'DATE NULL');
  await conn.query(
    `UPDATE vendas SET data_pagamento = data WHERE status_pagamento = 'pago' AND data_pagamento IS NULL`
  );

  // Imagem e tags do produto (ex: "clareador de virilha") para achar o produto certo na hora de dar baixa
  await adicionarColunaSeNaoExistir(conn, 'produtos', 'imagem', 'VARCHAR(255) NULL');
  await adicionarColunaSeNaoExistir(conn, 'produtos', 'tags', "VARCHAR(500) NOT NULL DEFAULT ''");

  await adicionarColunaSeNaoExistir(conn, 'pedidos', 'forma_pagamento', "VARCHAR(100) NOT NULL DEFAULT ''");
  // Default 1 preserva o comportamento de todo pedido já existente (sempre deu entrada no estoque).
  await adicionarColunaSeNaoExistir(conn, 'pedidos', 'atualiza_estoque', 'TINYINT(1) NOT NULL DEFAULT 1');
  await migrarParcelasPedidosAntigos(conn);

  // tipo (simples/kit) precisa existir antes da migração de SKU abaixo, que filtra por ele
  await adicionarColunaSeNaoExistir(conn, 'produtos', 'tipo', "ENUM('simples', 'kit') NOT NULL DEFAULT 'simples'");

  await migrarParaSkuIndependente(conn);
}

// Pedidos antigos sempre foram pagos à vista na hora (o caixa já recebeu a saída na criação),
// só não existia o conceito de parcela ainda. Aqui cada pedido sem nenhuma parcela ganha uma
// parcela única já marcada como paga, refletindo o que já aconteceu de fato — não mexe no
// caixa (que já está correto), só preenche o histórico de parcelas pra a tela funcionar.
async function migrarParcelasPedidosAntigos(conn) {
  if (!(await tabelaExiste(conn, 'pedido_parcelas'))) return;
  const [pedidosSemParcela] = await conn.query(
    `SELECT p.id, p.data, p.total FROM pedidos p
     LEFT JOIN pedido_parcelas pp ON pp.pedido_id = p.id
     WHERE pp.id IS NULL`
  );
  for (const pedido of pedidosSemParcela) {
    await conn.query(
      `INSERT INTO pedido_parcelas (pedido_id, numero, valor, data_vencimento, status_pagamento, data_pagamento)
       VALUES (?, 1, ?, ?, 'pago', ?)`,
      [pedido.id, pedido.total, pedido.data, pedido.data]
    );
  }
}

// SKU passou a ser uma entidade própria (tabela `skus`), independente de produto — permite
// cadastrar um SKU que só será usado como componente de kit, sem precisar de um produto
// vendável 1:1. Esta migração move bases antigas (onde SKU/custo/estoque viviam direto em
// `produtos`, e kits usavam `produto_kit_itens` apontando pra outro produto) para o novo
// modelo (`skus` + `produto_skus`), preservando os dados reais existentes. Cada passo checa
// o que já foi feito antes de agir, então é seguro rodar em todo start do servidor.
async function migrarParaSkuIndependente(conn) {
  // 1) Produtos 'simples' que ainda guardam custo/estoque direto na própria linha (modelo
  //    antigo) ganham um registro correspondente em `skus` + vínculo em `produto_skus`.
  if (await colunaExiste(conn, 'produtos', 'preco_custo')) {
    const temColunaSkuAntiga = await colunaExiste(conn, 'produtos', 'sku');
    const campos = temColunaSkuAntiga
      ? 'id, sku, nome, preco_custo, estoque, criado_em'
      : 'id, NULL AS sku, nome, preco_custo, estoque, criado_em';
    const [produtosSimples] = await conn.query(`SELECT ${campos} FROM produtos WHERE tipo = 'simples'`);

    for (const produto of produtosSimples) {
      const codigoDesejado = (produto.sku && String(produto.sku).trim()) || `SKU-${String(produto.id).padStart(4, '0')}`;
      const [skuExistente] = await conn.query('SELECT id FROM skus WHERE codigo = ?', [codigoDesejado]);
      let skuId;
      if (skuExistente.length > 0) {
        skuId = skuExistente[0].id;
      } else {
        const [resultado] = await conn.query(
          'INSERT INTO skus (codigo, nome, preco_custo, estoque, criado_em) VALUES (?, ?, ?, ?, ?)',
          [codigoDesejado, produto.nome, produto.preco_custo, produto.estoque, produto.criado_em]
        );
        skuId = resultado.insertId;
      }
      const [vinculo] = await conn.query('SELECT id FROM produto_skus WHERE produto_id = ? AND sku_id = ?', [produto.id, skuId]);
      if (vinculo.length === 0) {
        await conn.query('INSERT INTO produto_skus (produto_id, sku_id, quantidade) VALUES (?, ?, 1)', [produto.id, skuId]);
      }
    }
  }

  // 2) Composição de kits antigos (produto_kit_itens: kit_id -> componente_id, um produto
  //    'simples' já migrado no passo 1 e portanto já tem exatamente 1 SKU vinculado).
  if (await tabelaExiste(conn, 'produto_kit_itens')) {
    const [itensAntigos] = await conn.query(
      `SELECT pki.kit_id, pki.quantidade, ps.sku_id
       FROM produto_kit_itens pki
       JOIN produto_skus ps ON ps.produto_id = pki.componente_id`
    );
    for (const item of itensAntigos) {
      const [vinculo] = await conn.query('SELECT id FROM produto_skus WHERE produto_id = ? AND sku_id = ?', [item.kit_id, item.sku_id]);
      if (vinculo.length === 0) {
        await conn.query('INSERT INTO produto_skus (produto_id, sku_id, quantidade) VALUES (?, ?, ?)', [item.kit_id, item.sku_id, item.quantidade]);
      }
    }
    await conn.query('DROP TABLE produto_kit_itens');
  }

  // 3) pedido_itens.produto_id -> sku_id (todo pedido antigo comprava produto 'simples',
  //    já com exatamente 1 SKU vinculado a essa altura da migração).
  if (await colunaExiste(conn, 'pedido_itens', 'produto_id')) {
    await adicionarColunaSeNaoExistir(conn, 'pedido_itens', 'sku_id', 'INT NULL');
    await conn.query(
      `UPDATE pedido_itens pi JOIN produto_skus ps ON ps.produto_id = pi.produto_id
       SET pi.sku_id = ps.sku_id WHERE pi.sku_id IS NULL`
    );
    await removerForeignKeySeExistir(conn, 'pedido_itens', 'produto_id');
    await conn.query('ALTER TABLE pedido_itens DROP COLUMN produto_id');
    await conn.query('ALTER TABLE pedido_itens MODIFY sku_id INT NOT NULL');
    await removerForeignKeySeExistir(conn, 'pedido_itens', 'sku_id');
    await conn.query('ALTER TABLE pedido_itens ADD CONSTRAINT fk_pedido_itens_sku FOREIGN KEY (sku_id) REFERENCES skus(id)');
  }

  // 4) movimentos_estoque.produto_id -> sku_id (mesma lógica do passo 3).
  if (await colunaExiste(conn, 'movimentos_estoque', 'produto_id')) {
    await adicionarColunaSeNaoExistir(conn, 'movimentos_estoque', 'sku_id', 'INT NULL');
    await conn.query(
      `UPDATE movimentos_estoque me JOIN produto_skus ps ON ps.produto_id = me.produto_id
       SET me.sku_id = ps.sku_id WHERE me.sku_id IS NULL`
    );
    await removerForeignKeySeExistir(conn, 'movimentos_estoque', 'produto_id');
    await conn.query('ALTER TABLE movimentos_estoque DROP COLUMN produto_id');
    await conn.query('ALTER TABLE movimentos_estoque MODIFY sku_id INT NOT NULL');
    await removerForeignKeySeExistir(conn, 'movimentos_estoque', 'sku_id');
    await conn.query('ALTER TABLE movimentos_estoque ADD CONSTRAINT fk_movimentos_sku FOREIGN KEY (sku_id) REFERENCES skus(id) ON DELETE CASCADE');
  }

  // 5.1) SKU.nome virou a chave de deduplicação prática (código agora é opcional) — bases
  //      já migradas antes dessa regra existir ainda não têm esse índice único.
  const [indiceNome] = await conn.query(
    `SELECT COUNT(*) AS existe FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'skus' AND INDEX_NAME = 'uq_skus_nome'`,
    [dbConfig.database]
  );
  if (indiceNome[0].existe === 0) {
    await conn.query('ALTER TABLE skus ADD UNIQUE KEY uq_skus_nome (nome)');
  }
  const [colunaCodigo] = await conn.query(
    `SELECT IS_NULLABLE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'skus' AND COLUMN_NAME = 'codigo'`,
    [dbConfig.database]
  );
  if (colunaCodigo.length > 0 && colunaCodigo[0].IS_NULLABLE === 'NO') {
    await conn.query('ALTER TABLE skus MODIFY codigo VARCHAR(50) NULL');
  }

  // 5) Só agora remove de `produtos` o que virou responsabilidade de `skus`.
  if (await colunaExiste(conn, 'produtos', 'sku')) {
    await removerIndiceSeExistir(conn, 'produtos', 'uq_produtos_sku');
    await conn.query('ALTER TABLE produtos DROP COLUMN sku');
  }
  if (await colunaExiste(conn, 'produtos', 'preco_custo')) {
    await conn.query('ALTER TABLE produtos DROP COLUMN preco_custo');
  }
  if (await colunaExiste(conn, 'produtos', 'estoque')) {
    await conn.query('ALTER TABLE produtos DROP COLUMN estoque');
  }
}

module.exports = { pool, waitForDb, initSchema };
