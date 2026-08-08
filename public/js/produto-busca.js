// Combobox de busca de produto por nome, SKU ou tag (ex: digitar "virilha" encontra "Xpto").
// Construído sobre o motor genérico select-busca.js, com miniatura + SKU + tags + estoque na linha.
// Uso: const busca = criarBuscaProduto(container, { nomeCampo: 'produtoId' });
//      busca.definirProdutos(cacheProdutos); busca.obterProdutoId(); busca.limpar(); busca.destruir();

function criarBuscaProduto(container, opcoes = {}) {
  const {
    nomeCampo = 'produtoId',
    placeholder = 'Buscar produto por nome, SKU ou tag...',
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
    getTextoPesquisavel: (p) => [p.sku, p.nome, ...(p.tags || [])].join(' '),
    renderizarItem: (p) => {
      const subpartes = [p.sku, ...(p.tags || [])].filter(Boolean);
      return `
        ${miniatura(p)}
        <span class="select-busca-item-info">
          <span class="select-busca-item-nome">${escaparHtml(p.nome)}${p.tipo === 'kit' ? ' <span class="badge kit">Kit</span>' : ''}</span>
          ${subpartes.length ? `<span class="select-busca-item-sub">${subpartes.map(t => escaparHtml(t)).join(' · ')}</span>` : ''}
        </span>
        <span class="produto-busca-item-estoque">estoque: ${p.estoque}</span>
      `;
    }
  });

  return {
    definirProdutos: base.definirItens,
    obterProdutoId: base.obterValor,
    definirProduto: base.definirValor,
    limpar: base.limpar,
    destruir: base.destruir
  };
}
