// Reset total dos dados do sistema: apaga clientes, fornecedores, produtos, vendas,
// pedidos, movimentos de estoque, caixa e as imagens de produto enviadas — mantém o
// schema das tabelas intacto e os IDs voltam a começar do 1.
//
// Uso (com o docker no ar):
//   ./resetar-banco.sh
// ou diretamente:
//   npm run resetar-banco
//
// Pede confirmação digitada — não roda sem essa confirmação.

const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { pool, waitForDb } = require('../src/db');

const FRASE_CONFIRMACAO = 'APAGAR TUDO';

// Ordem não importa (FOREIGN_KEY_CHECKS fica desligado durante o TRUNCATE),
// mas listar tudo aqui deixa explícito o que é apagado.
const TABELAS = [
  'movimentos_estoque',
  'caixa',
  'venda_itens',
  'vendas',
  'pedido_itens',
  'pedidos',
  'produtos',
  'fornecedores',
  'clientes'
];

function perguntar(pergunta) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(pergunta, resposta => { rl.close(); resolve(resposta); }));
}

async function main() {
  console.log('\n⚠️  Isso vai apagar PERMANENTEMENTE todos os dados do sistema:');
  console.log('   clientes, fornecedores, produtos, vendas, pedidos, estoque, caixa e imagens de produto.');
  console.log('   Essa ação não pode ser desfeita.\n');

  const resposta = await perguntar(`Digite "${FRASE_CONFIRMACAO}" para confirmar: `);
  if (resposta.trim() !== FRASE_CONFIRMACAO) {
    console.log('\nCancelado. Nada foi apagado.');
    process.exit(0);
  }

  console.log('\nConectando ao banco...');
  await waitForDb();

  const conn = await pool.getConnection();
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const tabela of TABELAS) {
      await conn.query(`TRUNCATE TABLE ${tabela}`);
      console.log(`  ✔ ${tabela} limpa`);
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    conn.release();
  }

  const uploadsDir = path.join(__dirname, '..', 'public', 'uploads', 'produtos');
  if (fs.existsSync(uploadsDir)) {
    const arquivos = fs.readdirSync(uploadsDir);
    for (const arquivo of arquivos) {
      fs.unlinkSync(path.join(uploadsDir, arquivo));
    }
    console.log(`  ✔ ${arquivos.length} imagem(ns) de produto removida(s)`);
  }

  console.log('\nBanco de dados zerado. Os próximos cadastros começam do ID 1.\n');
  await pool.end();
}

main().catch(err => {
  console.error('\nErro ao resetar o banco:', err.message);
  process.exit(1);
});
