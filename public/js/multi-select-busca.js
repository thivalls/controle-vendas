// Combobox de busca com seleção múltipla: digite para filtrar uma lista já carregada em
// memória e vá selecionando vários itens, que ficam como chips removíveis. Construído sobre
// o mesmo padrão do select-busca.js, mas para relacionamentos array (ex: filtrar vendas por
// vários produtos) em vez de um único valor.
//
// Uso: const busca = criarMultiSelectBusca(container, {
//        getId: (p) => p.id,
//        getTexto: (p) => p.nome,
//        getTextoPesquisavel: (p) => p.nome
//      });
//      busca.definirItens(lista); busca.obterIds(); busca.limpar(); busca.destruir();

function criarMultiSelectBusca(container, opcoes = {}) {
  const {
    placeholder = 'Buscar...',
    getId = (item) => item.id,
    getTexto = (item) => item.nome,
    getTextoPesquisavel = null,
    renderizarItem = null,
    onAlterar = null,
    mensagemVazio = 'Nenhum resultado encontrado'
  } = opcoes;

  const textoPesquisavelDe = getTextoPesquisavel || getTexto;
  const renderizarLinha = renderizarItem || ((item) => `<span class="select-busca-texto">${escaparHtml(getTexto(item))}</span>`);

  let itens = [];
  const selecionados = new Map(); // id (string) -> item
  let resultadosAtuais = [];
  let indiceAtivo = -1;

  container.classList.add('select-busca', 'select-busca-multi');
  container.innerHTML = `
    <div class="select-busca-campo">
      <span class="tag-input-chips select-busca-chips"></span>
      <input type="text" class="select-busca-input" placeholder="${escaparHtml(placeholder)}" autocomplete="off">
    </div>
    <div class="select-busca-lista" hidden></div>
  `;

  const chipsEl = container.querySelector('.select-busca-chips');
  const inputEl = container.querySelector('.select-busca-input');
  const listaEl = container.querySelector('.select-busca-lista');

  function renderizarChips() {
    chipsEl.innerHTML = Array.from(selecionados.values()).map(item => `
      <span class="tag-chip">${escaparHtml(getTexto(item))}<button type="button" class="tag-chip-remover" data-id="${escaparHtml(String(getId(item)))}" aria-label="Remover ${escaparHtml(getTexto(item))}">×</button></span>
    `).join('');
  }

  function destacar() {
    listaEl.querySelectorAll('.select-busca-item').forEach(el => {
      el.classList.toggle('ativo', Number(el.dataset.indice) === indiceAtivo);
    });
    const ativo = listaEl.querySelector('.select-busca-item.ativo');
    if (ativo) ativo.scrollIntoView({ block: 'nearest' });
  }

  function renderizarLista(query) {
    const termo = query.trim().toLowerCase();
    resultadosAtuais = itens
      .filter(item => !selecionados.has(String(getId(item))))
      .filter(item => !termo || textoPesquisavelDe(item).toLowerCase().includes(termo))
      .slice(0, 20);
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

  function obterIds() {
    return Array.from(selecionados.keys()).map(Number);
  }

  function selecionar(item) {
    selecionados.set(String(getId(item)), item);
    renderizarChips();
    inputEl.value = '';
    renderizarLista('');
    if (onAlterar) onAlterar(obterIds());
  }

  function remover(id) {
    selecionados.delete(id);
    renderizarChips();
    if (!listaEl.hidden) renderizarLista(inputEl.value);
    if (onAlterar) onAlterar(obterIds());
  }

  inputEl.addEventListener('focus', () => renderizarLista(inputEl.value));
  inputEl.addEventListener('input', () => renderizarLista(inputEl.value));

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

  chipsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.tag-chip-remover');
    if (!btn) return;
    remover(btn.dataset.id);
  });

  function aoClicarFora(e) {
    if (!container.contains(e.target)) fecharLista();
  }
  document.addEventListener('click', aoClicarFora);

  return {
    definirItens(lista) {
      itens = lista || [];
      // remove seleções que não existem mais na lista atual (ex: produto excluído)
      const idsValidos = new Set(itens.map(i => String(getId(i))));
      Array.from(selecionados.keys()).forEach(id => { if (!idsValidos.has(id)) selecionados.delete(id); });
      renderizarChips();
    },
    obterIds,
    limpar() {
      selecionados.clear();
      inputEl.value = '';
      renderizarChips();
      fecharLista();
    },
    // Remove o listener global — chamar ao destruir a instância
    destruir() {
      document.removeEventListener('click', aoClicarFora);
    }
  };
}
