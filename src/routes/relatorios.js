const express = require('express');
const { pool } = require('../db');
const asyncHandler = require('../asyncHandler');

const router = express.Router();

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
