const tabelaCaixa = criarTabela(document.getElementById('tabela-caixa'), {
  colunas: [
    { titulo: 'Data', render: (l) => escaparHtml(formatarData(l.data)) },
    { titulo: 'Tipo', render: (l) => escaparHtml(l.tipo === 'entrada' ? 'Entrada' : 'Saída') },
    { titulo: 'Categoria', campo: 'categoria' },
    { titulo: 'Descrição', campo: 'descricao' },
    { titulo: 'Valor', render: (l) => escaparHtml(formatarMoeda(l.valor)) }
  ],
  campoBusca: (l) => [l.categoria, l.descricao, l.tipo === 'entrada' ? 'entrada' : 'saída'].join(' '),
  placeholderBusca: 'Buscar por categoria ou descrição...',
  mensagemVazio: 'Nenhum lançamento registrado',
  acoes: [
    { chave: 'editar', rotulo: 'Editar', visivel: (l) => !l.vendaId && !l.pedidoId, aoClicar: (l) => { location.href = 'caixa-form.html?id=' + l.id; } },
    { chave: 'excluir', rotulo: 'Excluir', classe: 'perigo', visivel: (l) => !l.vendaId && !l.pedidoId, aoClicar: excluirLancamento }
  ]
});

async function carregarCaixa() {
  try {
    const dados = await api('GET', '/caixa');
    document.getElementById('total-entradas').textContent = formatarMoeda(dados.totalEntradas);
    document.getElementById('total-saidas').textContent = formatarMoeda(dados.totalSaidas);
    document.getElementById('saldo-caixa').textContent = formatarMoeda(dados.saldo);
    tabelaCaixa.definirDados(dados.lancamentos);
  } catch (e) {
    alert(e.message);
  }
}

async function excluirLancamento(lancamento) {
  if (!confirm('Excluir este lançamento?')) return;
  try {
    await api('DELETE', '/caixa/' + lancamento.id);
    await carregarCaixa();
  } catch (e) {
    alert(e.message);
  }
}

initSidebar('caixa');
carregarCaixa();
