// Motor genérico de "searchable select": digite para filtrar uma lista já carregada em memória.
// Componentes específicos (produto, cliente, fornecedor...) usam isso por baixo, cada um
// definindo como buscar o texto pesquisável e como desenhar a linha do resultado.
//
// Uso: const busca = criarSelectBusca(container, {
//        nomeCampo: 'clienteId',
//        getId: (c) => c.id,
//        getTexto: (c) => c.nome,
//        getTextoPesquisavel: (c) => `${c.nome} ${c.telefone}`,
//        renderizarItem: (c) => `...html da linha...` // opcional
//      });
//      busca.definirItens(lista); busca.obterValor(); busca.limpar(); busca.destruir();

function criarSelectBusca(container, opcoes = {}) {
  const {
    nomeCampo = 'valor',
    placeholder = 'Buscar...',
    getId = (item) => item.id,
    getTexto = (item) => item.nome,
    getTextoPesquisavel = null,
    renderizarItem = null,
    onSelecionar = null,
    mensagemVazio = 'Nenhum resultado encontrado'
  } = opcoes;

  const textoPesquisavelDe = getTextoPesquisavel || getTexto;
  const renderizarLinha = renderizarItem || ((item) => `<span class="select-busca-texto">${escaparHtml(getTexto(item))}</span>`);

  let itens = [];
  let resultadosAtuais = [];
  let indiceAtivo = -1;

  container.classList.add('select-busca');
  container.innerHTML = `
    <div class="select-busca-campo">
      <input type="text" class="select-busca-input" placeholder="${escaparHtml(placeholder)}" autocomplete="off">
      <button type="button" class="select-busca-limpar" hidden aria-label="Limpar seleção">×</button>
    </div>
    <input type="hidden" name="${escaparHtml(nomeCampo)}">
    <div class="select-busca-lista" hidden></div>
  `;

  const inputEl = container.querySelector('.select-busca-input');
  const btnLimpar = container.querySelector('.select-busca-limpar');
  const hiddenEl = container.querySelector(`input[name="${nomeCampo}"]`);
  const listaEl = container.querySelector('.select-busca-lista');

  function destacar() {
    listaEl.querySelectorAll('.select-busca-item').forEach(el => {
      el.classList.toggle('ativo', Number(el.dataset.indice) === indiceAtivo);
    });
    const ativo = listaEl.querySelector('.select-busca-item.ativo');
    if (ativo) ativo.scrollIntoView({ block: 'nearest' });
  }

  function renderizarLista(query) {
    const termo = query.trim().toLowerCase();
    resultadosAtuais = (!termo ? itens : itens.filter(item => textoPesquisavelDe(item).toLowerCase().includes(termo))).slice(0, 20);
    indiceAtivo = -1;

    listaEl.innerHTML = resultadosAtuais.length === 0
      ? `<div class="select-busca-vazio">${escaparHtml(mensagemVazio)}</div>`
      : resultadosAtuais.map((item, i) => `<div class="select-busca-item" data-indice="${i}">${renderizarLinha(item)}</div>`).join('');
    listaEl.hidden = false;
  }

  function fecharLista() {
    listaEl.hidden = true;
    indiceAtivo = -1;
  }

  function limparSelecao() {
    hiddenEl.value = '';
    btnLimpar.hidden = true;
  }

  function selecionar(item) {
    hiddenEl.value = getId(item);
    inputEl.value = getTexto(item);
    btnLimpar.hidden = false;
    fecharLista();
    if (onSelecionar) onSelecionar(item);
  }

  inputEl.addEventListener('focus', () => renderizarLista(inputEl.value));
  inputEl.addEventListener('input', () => {
    limparSelecao();
    renderizarLista(inputEl.value);
  });

  btnLimpar.addEventListener('click', () => {
    inputEl.value = '';
    limparSelecao();
    fecharLista();
    inputEl.focus();
    if (onSelecionar) onSelecionar(null);
  });

  inputEl.addEventListener('keydown', (e) => {
    if (listaEl.hidden) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      indiceAtivo = Math.min(indiceAtivo + 1, resultadosAtuais.length - 1);
      destacar();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      indiceAtivo = Math.max(indiceAtivo - 1, 0);
      destacar();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (indiceAtivo >= 0 && resultadosAtuais[indiceAtivo]) selecionar(resultadosAtuais[indiceAtivo]);
    } else if (e.key === 'Escape') {
      fecharLista();
    }
  });

  listaEl.addEventListener('mousedown', (e) => {
    // mousedown (não click) dispara antes do blur do input
    const item = e.target.closest('.select-busca-item');
    if (!item) return;
    e.preventDefault();
    const registro = resultadosAtuais[Number(item.dataset.indice)];
    if (registro) selecionar(registro);
  });

  function aoClicarFora(e) {
    if (!container.contains(e.target)) fecharLista();
  }
  document.addEventListener('click', aoClicarFora);

  return {
    definirItens(lista) {
      itens = lista || [];
    },
    obterValor: () => hiddenEl.value,
    limpar() {
      inputEl.value = '';
      limparSelecao();
      fecharLista();
    },
    // Remove o listener global — chamar ao destruir a instância (ex: linha de item removida)
    destruir() {
      document.removeEventListener('click', aoClicarFora);
    }
  };
}
