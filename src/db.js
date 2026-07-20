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
async function adicionarColunaSeNaoExistir(conn, tabela, coluna, definicaoSql) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS existe FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [dbConfig.database, tabela, coluna]
  );
  if (rows[0].existe > 0) return;
  await conn.query(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${definicaoSql}`);
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
}

module.exports = { pool, waitForDb, initSchema };
