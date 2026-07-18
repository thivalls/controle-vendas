const express = require('express');
const { pool } = require('../db');
const asyncHandler = require('../asyncHandler');

const router = express.Router();

// Relatório mensal de lucro: Vendas - Custo dos produtos vendidos - Outras despesas
// visao=previsao (padrão): considera todas as vendas concluídas no mês, mesmo com pagamento pendente.
// visao=real: considera só as vendas já pagas (dar baixa), excluindo também o custo das pendentes.
router.get('/mensal', asyncHandler(async (req, res) => {
  const mes = req.query.mes || new Date().toISOString().slice(0, 7);
  const visao = req.query.visao === 'real' ? 'real' : 'previsao';
  const filtroPagamento = visao === 'real' ? "AND status_pagamento = 'pago'" : '';
  const filtroPagamentoV = visao === 'real' ? "AND v.status_pagamento = 'pago'" : '';

  const [[resumoVendas]] = await pool.query(
    `SELECT COUNT(*) AS numeroVendas, COALESCE(SUM(total), 0) AS vendas
     FROM vendas
     WHERE status = 'concluido' AND DATE_FORMAT(data, '%Y-%m') = ? ${filtroPagamento}`,
    [mes]
  );

  const [[resumoCusto]] = await pool.query(
    `SELECT COALESCE(SUM(vi.quantidade * vi.preco_unit_custo), 0) AS custoProdutosVendidos
     FROM venda_itens vi
     JOIN vendas v ON v.id = vi.venda_id
     WHERE v.status = 'concluido' AND DATE_FORMAT(v.data, '%Y-%m') = ? ${filtroPagamentoV}`,
    [mes]
  );

  const [[resumoPendentes]] = await pool.query(
    `SELECT COUNT(*) AS numero, COALESCE(SUM(total), 0) AS total
     FROM vendas
     WHERE status = 'concluido' AND status_pagamento = 'pendente' AND DATE_FORMAT(data, '%Y-%m') = ?`,
    [mes]
  );

  const [despesasDoMesRows] = await pool.query(
    `SELECT * FROM caixa
     WHERE tipo = 'saida' AND DATE_FORMAT(data, '%Y-%m') = ?
       AND categoria NOT IN ('Compra de mercadoria', 'Cancelamento de venda')
     ORDER BY data DESC, id DESC`,
    [mes]
  );
  const despesasDetalhadas = despesasDoMesRows.map(row => ({
    id: row.id,
    tipo: row.tipo,
    categoria: row.categoria,
    valor: row.valor,
    descricao: row.descricao,
    data: row.data,
    vendaId: row.venda_id || undefined,
    pedidoId: row.pedido_id || undefined
  }));
  const outrasDespesas = despesasDetalhadas.reduce((s, l) => s + l.valor, 0);

  const [[resumoCompras]] = await pool.query(
    `SELECT COALESCE(SUM(valor), 0) AS comprasDeMercadoria
     FROM caixa
     WHERE tipo = 'saida' AND DATE_FORMAT(data, '%Y-%m') = ? AND categoria = 'Compra de mercadoria'`,
    [mes]
  );

  const vendas = resumoVendas.vendas;
  const custoProdutosVendidos = resumoCusto.custoProdutosVendidos;
  const lucro = vendas - custoProdutosVendidos - outrasDespesas;

  res.json({
    mes,
    visao,
    numeroVendas: resumoVendas.numeroVendas,
    vendas,
    custoProdutosVendidos,
    outrasDespesas,
    despesasDetalhadas,
    comprasDeMercadoria: resumoCompras.comprasDeMercadoria,
    lucro,
    vendasPendentes: {
      numero: resumoPendentes.numero,
      total: resumoPendentes.total
    }
  });
}));

// Dashboard: widgets simples para a página inicial do sistema
router.get('/dashboard', asyncHandler(async (req, res) => {
  const mes = req.query.mes || new Date().toISOString().slice(0, 7);
  const ano = mes.slice(0, 4);

  const [[resumoVendas]] = await pool.query(
    `SELECT COUNT(*) AS numeroVendas
     FROM vendas
     WHERE status = 'concluido' AND DATE_FORMAT(data, '%Y-%m') = ?`,
    [mes]
  );

  const [[resumoRecebido]] = await pool.query(
    `SELECT COALESCE(SUM(valor), 0) AS valorRecebido
     FROM caixa
     WHERE tipo = 'entrada' AND categoria = 'Venda' AND DATE_FORMAT(data, '%Y-%m') = ?`,
    [mes]
  );

  async function produtosMaisVendidos(filtroData, valorFiltro) {
    const [rows] = await pool.query(
      `SELECT vi.produto_id AS produtoId, prod.nome AS produtoNome,
              SUM(vi.quantidade) AS quantidade, SUM(vi.quantidade * vi.preco_unit_venda) AS valor
       FROM venda_itens vi
       JOIN vendas v ON v.id = vi.venda_id
       LEFT JOIN produtos prod ON prod.id = vi.produto_id
       WHERE v.status = 'concluido' AND ${filtroData} = ?
       GROUP BY vi.produto_id, prod.nome
       ORDER BY quantidade DESC
       LIMIT 5`,
      [valorFiltro]
    );
    return rows.map(r => ({
      produtoId: r.produtoId,
      produtoNome: r.produtoNome || '(produto removido)',
      quantidade: r.quantidade,
      valor: r.valor
    }));
  }

  const produtosMaisVendidosNoMes = await produtosMaisVendidos("DATE_FORMAT(v.data, '%Y-%m')", mes);
  const produtosMaisVendidosNoAno = await produtosMaisVendidos("DATE_FORMAT(v.data, '%Y')", ano);

  res.json({
    mes,
    ano,
    numeroVendasNoMes: resumoVendas.numeroVendas,
    valorRecebidoNoMes: resumoRecebido.valorRecebido,
    produtosMaisVendidosNoMes,
    produtosMaisVendidosNoAno
  });
}));

module.exports = router;
