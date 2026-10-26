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
    { titulo: 'ID', campo: 'id' },
    { titulo: 'Nome', campo: 'nome' },
    { titulo: 'Cód. SKU', render: (p) => escaparHtml(p.sku || '') },
    { titulo: 'Tipo', render: badgeTipoProduto },
    { titulo: 'Tags', render: tagsProduto },
    { titulo: 'Custo', render: (p) => escaparHtml(formatarMoeda(p.precoCusto)) },
    { titulo: 'Venda', render: (p) => escaparHtml(formatarMoeda(p.precoVenda)) },
    { titulo: 'Estoque', render: estoqueProduto }
  ],
  campoBusca: (p) => [p.sku, p.nome, ...(p.tags || [])].join(' '),
  placeholderBusca: 'Buscar por nome, SKU ou tag (ex: virilha)...',
  mensagemVazio: 'Nenhum produto cadastrado',
  chaveArmazenamentoTamanhoPagina: 'tamanho-pagina-tabela-produtos',
  acoes: [
    { chave: 'editar', rotulo: 'Editar', aoClicar: (p) => { location.href = 'produto-form.html?id=' + p.id; } },
    { chave: 'excluir', rotulo: 'Excluir', classe: 'perigo', aoClicar: excluirProduto }
  ]
});

// O filtro de fornecedor mora ao lado da busca por texto, dentro da mesma toolbar da tabela —
// mas essa toolbar só existe depois que criarTabela roda (ela monta o próprio HTML). Por isso
// o filtro começa fora de #tabela-produtos no HTML e é movido para dentro aqui.
document.querySelector('#tabela-produtos .tabela-toolbar').appendChild(document.getElementById('filtro-fornecedor-produtos'));

let cacheProdutos = [];

const buscaFornecedorFiltroProdutos = criarMultiSelectBusca(document.getElementById('busca-fornecedor-filtro-produtos'), {
  placeholder: 'Buscar fornecedor para filtrar...',
  getTextoPesquisavel: (f) => [f.nome, f.telefone, f.email].filter(Boolean).join(' '),
  onAlterar: () => renderProdutosFiltrados()
});

function renderProdutosFiltrados() {
  const fornecedorIds = buscaFornecedorFiltroProdutos.obterIds();
  const produtosFiltrados = fornecedorIds.length === 0
    ? cacheProdutos
    : cacheProdutos.filter(p => (p.fornecedorIds || []).some(id => fornecedorIds.includes(id)));
  tabelaProdutos.definirDados(produtosFiltrados);
}

async function carregarProdutos() {
  try {
    const [produtos, fornecedores] = await Promise.all([api('GET', '/produtos'), api('GET', '/fornecedores')]);
    cacheProdutos = produtos;
    buscaFornecedorFiltroProdutos.definirItens(fornecedores);
    renderProdutosFiltrados();
  } catch (e) {
    alert(e.message);
  }
}

document.getElementById('limpar-filtro-produtos').addEventListener('click', () => {
  buscaFornecedorFiltroProdutos.limpar();
  renderProdutosFiltrados();
});

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
