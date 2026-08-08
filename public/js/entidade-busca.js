// Combobox de busca para cadastros relacionados simples (cliente, fornecedor):
// digite nome, telefone ou e-mail para filtrar. Construído sobre select-busca.js.

function criarBuscaCliente(container, opcoes = {}) {
  const {
    nomeCampo = 'clienteId',
    placeholder = 'Buscar cliente por nome, telefone ou e-mail...',
    onSelecionar = null
  } = opcoes;

  const base = criarSelectBusca(container, {
    nomeCampo,
    placeholder,
    onSelecionar,
    mensagemVazio: 'Nenhum cliente encontrado',
    getId: (c) => c.id,
    getTexto: (c) => c.nome,
    getTextoPesquisavel: (c) => [c.nome, c.telefone, c.email].filter(Boolean).join(' '),
    renderizarItem: (c) => `
      <span class="select-busca-item-info">
        <span class="select-busca-item-nome">${escaparHtml(c.nome)}</span>
        ${c.telefone || c.email ? `<span class="select-busca-item-sub">${[c.telefone, c.email].filter(Boolean).map(escaparHtml).join(' · ')}</span>` : ''}
      </span>
    `
  });

  return {
    definirClientes: base.definirItens,
    obterClienteId: base.obterValor,
    definirCliente: base.definirValor,
    limpar: base.limpar,
    destruir: base.destruir
  };
}

function criarBuscaFornecedor(container, opcoes = {}) {
  const {
    nomeCampo = 'fornecedorId',
    placeholder = 'Buscar fornecedor por nome, telefone ou e-mail...',
    onSelecionar = null
  } = opcoes;

  const base = criarSelectBusca(container, {
    nomeCampo,
    placeholder,
    onSelecionar,
    mensagemVazio: 'Nenhum fornecedor encontrado',
    getId: (f) => f.id,
    getTexto: (f) => f.nome,
    getTextoPesquisavel: (f) => [f.nome, f.telefone, f.email].filter(Boolean).join(' '),
    renderizarItem: (f) => `
      <span class="select-busca-item-info">
        <span class="select-busca-item-nome">${escaparHtml(f.nome)}</span>
        ${f.telefone || f.email ? `<span class="select-busca-item-sub">${[f.telefone, f.email].filter(Boolean).map(escaparHtml).join(' · ')}</span>` : ''}
      </span>
    `
  });

  return {
    definirFornecedores: base.definirItens,
    obterFornecedorId: base.obterValor,
    limpar: base.limpar,
    destruir: base.destruir
  };
}
