const tabelaSkus = criarTabela(document.getElementById('tabela-skus'), {
  colunas: [
    { titulo: 'Código', campo: 'codigo' },
    { titulo: 'Nome', campo: 'nome' },
    { titulo: 'Custo', render: (s) => escaparHtml(formatarMoeda(s.precoCusto)) },
    { titulo: 'Estoque', campo: 'estoque' }
  ],
  campoBusca: (s) => [s.codigo, s.nome].join(' '),
  placeholderBusca: 'Buscar por código ou nome...',
  mensagemVazio: 'Nenhum SKU cadastrado',
  acoes: [
    { chave: 'editar', rotulo: 'Editar', aoClicar: (s) => { location.href = 'sku-form.html?id=' + s.id; } },
    { chave: 'excluir', rotulo: 'Excluir', classe: 'perigo', aoClicar: excluirSku }
  ]
});

async function carregarSkus() {
  try {
    const skus = await api('GET', '/skus');
    tabelaSkus.definirDados(skus);
  } catch (e) {
    alert(e.message);
  }
}

async function excluirSku(sku) {
  if (!confirm(`Excluir o SKU "${sku.codigo}"?`)) return;
  try {
    await api('DELETE', '/skus/' + sku.id);
    await carregarSkus();
  } catch (e) {
    alert(e.message);
  }
}

initSidebar('skus');
carregarSkus();
