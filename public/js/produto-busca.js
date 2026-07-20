// Combobox de busca de produto por nome ou tag (ex: digitar "virilha" encontra "Xpto").
// Construído sobre o motor genérico select-busca.js, com miniatura + tags + estoque na linha.
// Uso: const busca = criarBuscaProduto(container, { nomeCampo: 'produtoId' });
//      busca.definirProdutos(cacheProdutos); busca.obterProdutoId(); busca.limpar(); busca.destruir();

function criarBuscaProduto(container, opcoes = {}) {
  const {
    nomeCampo = 'produtoId',
    placeholder = 'Buscar produto por nome ou tag (ex: virilha)...',
    onSelecionar = null
  } = opcoes;

  function miniatura(p) {
    return p.imagem
      ? `<img src="${escaparHtml(p.imagem)}" class="produto-busca-thumb" alt="">`
      : `<span class="produto-busca-thumb produto-busca-thumb-vazio">${escaparHtml((p.nome || '?').charAt(0).toUpperCase())}</span>`;
  }

  container.classList.add('produto-busca');

  const base = criarSelectBusca(container, {
    nomeCampo,
    placeholder,
    onSelecionar,
    mensagemVazio: 'Nenhum produto encontrado',
    getId: (p) => p.id,
    getTexto: (p) => p.nome,
    getTextoPesquisavel: (p) => [p.nome, ...(p.tags || [])].join(' '),
    renderizarItem: (p) => `
      ${miniatura(p)}
      <span class="select-busca-item-info">
        <span class="select-busca-item-nome">${escaparHtml(p.nome)}</span>
        ${p.tags && p.tags.length ? `<span class="select-busca-item-sub">${p.tags.map(t => escaparHtml(t)).join(' · ')}</span>` : ''}
      </span>
      <span class="produto-busca-item-estoque">estoque: ${p.estoque}</span>
    `
  });

  return {
    definirProdutos: base.definirItens,
    obterProdutoId: base.obterValor,
    limpar: base.limpar,
    destruir: base.destruir
  };
}
