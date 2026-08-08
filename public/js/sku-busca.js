// Combobox de busca de SKU por código ou nome. Construído sobre select-busca.js.
// Uso: const busca = criarBuscaSku(container, { nomeCampo: 'skuId' });
//      busca.definirSkus(lista); busca.obterSkuId(); busca.definirSku(sku); busca.limpar(); busca.destruir();

function criarBuscaSku(container, opcoes = {}) {
  const {
    nomeCampo = 'skuId',
    placeholder = 'Buscar SKU por código ou nome...',
    onSelecionar = null
  } = opcoes;

  const base = criarSelectBusca(container, {
    nomeCampo,
    placeholder,
    onSelecionar,
    mensagemVazio: 'Nenhum SKU encontrado',
    getId: (s) => s.id,
    getTexto: (s) => `${s.codigo} — ${s.nome}`,
    getTextoPesquisavel: (s) => [s.codigo, s.nome].join(' '),
    renderizarItem: (s) => `
      <span class="select-busca-item-info">
        <span class="select-busca-item-nome">${escaparHtml(s.codigo)}</span>
        <span class="select-busca-item-sub">${escaparHtml(s.nome)}</span>
      </span>
      <span class="produto-busca-item-estoque">estoque: ${s.estoque}</span>
    `
  });

  return {
    definirSkus: base.definirItens,
    obterSkuId: base.obterValor,
    definirSku: base.definirValor,
    limpar: base.limpar,
    destruir: base.destruir
  };
}
