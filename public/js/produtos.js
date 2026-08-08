function miniaturaProduto(p) {
  return p.imagem
    ? `<img src="${escaparHtml(p.imagem)}" class="produto-thumb" alt="">`
    : `<span class="produto-thumb produto-thumb-vazio">${escaparHtml((p.nome || '?').charAt(0).toUpperCase())}</span>`;
}

function tagsProduto(p) {
  if (!p.tags || p.tags.length === 0) return '';
  return p.tags.map(t => `<span class="tag-chip tag-chip-leitura">${escaparHtml(t)}</span>`).join('');
}

function badgeTipoProduto(p) {
  return p.tipo === 'kit'
    ? '<span class="badge kit">Kit</span>'
    : '<span class="badge simples">Simples</span>';
}

function estoqueProduto(p) {
  return p.tipo === 'kit'
    ? `<span title="Calculado a partir do estoque dos componentes">${p.estoque} (calc.)</span>`
    : String(p.estoque);
}

const tabelaProdutos = criarTabela(document.getElementById('tabela-produtos'), {
  colunas: [
    { titulo: '', render: miniaturaProduto },
    { titulo: 'Nome', campo: 'nome' },
    { titulo: 'Tipo', render: badgeTipoProduto },
    { titulo: 'Tags', render: tagsProduto },
    { titulo: 'Custo', render: (p) => escaparHtml(formatarMoeda(p.precoCusto)) },
    { titulo: 'Venda', render: (p) => escaparHtml(formatarMoeda(p.precoVenda)) },
    { titulo: 'Estoque', render: estoqueProduto }
  ],
  campoBusca: (p) => [p.sku, p.nome, ...(p.tags || [])].join(' '),
  placeholderBusca: 'Buscar por nome, SKU ou tag (ex: virilha)...',
  mensagemVazio: 'Nenhum produto cadastrado',
  acoes: [
    { chave: 'editar', rotulo: 'Editar', aoClicar: (p) => { location.href = 'produto-form.html?id=' + p.id; } },
    { chave: 'excluir', rotulo: 'Excluir', classe: 'perigo', aoClicar: excluirProduto }
  ]
});

async function carregarProdutos() {
  try {
    const produtos = await api('GET', '/produtos');
    tabelaProdutos.definirDados(produtos);
  } catch (e) {
    alert(e.message);
  }
}

async function excluirProduto(produto) {
  if (!confirm(`Excluir o produto "${produto.nome}"?`)) return;
  try {
    await api('DELETE', '/produtos/' + produto.id);
    await carregarProdutos();
  } catch (e) {
    alert(e.message);
  }
}

initSidebar('produtos');
carregarProdutos();
