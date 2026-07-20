// Componente de tabela reutilizável: busca e paginação em memória.
// Uso: const tabela = criarTabela(container, { colunas, campoBusca, acoes });
//      tabela.definirDados(lista);

function criarTabela(container, opcoes) {
  const {
    colunas,
    idDoRegistro = (registro) => registro.id,
    campoBusca = null,
    placeholderBusca = 'Buscar...',
    tamanhosPagina = [10, 20, 50, 100],
    tamanhoPaginaPadrao = 10,
    mensagemVazio = 'Nenhum registro encontrado',
    acoes = []
  } = opcoes;

  let todos = [];
  let filtrados = [];
  let termoBusca = '';
  let pagina = 1;
  let tamanhoPagina = tamanhoPaginaPadrao;

  container.innerHTML = `
    ${campoBusca ? `
      <div class="tabela-toolbar">
        <input type="search" class="tabela-busca" placeholder="${escaparHtml(placeholderBusca)}">
      </div>
    ` : ''}
    <div class="table-wrap">
      <table>
        <thead><tr>${colunas.map(c => `<th>${escaparHtml(c.titulo)}</th>`).join('')}${acoes.length ? '<th></th>' : ''}</tr></thead>
        <tbody></tbody>
      </table>
    </div>
    <div class="tabela-paginacao">
      <div class="tabela-paginacao-info"></div>
      <div class="tabela-paginacao-controles">
        <label class="tabela-tamanho-pagina">Por página:
          <select>${tamanhosPagina.map(t => `<option value="${t}">${t}</option>`).join('')}</select>
        </label>
        <button type="button" data-acao="primeira" class="secundario">«</button>
        <button type="button" data-acao="anterior" class="secundario">‹</button>
        <span class="tabela-pagina-atual"></span>
        <button type="button" data-acao="proxima" class="secundario">›</button>
        <button type="button" data-acao="ultima" class="secundario">»</button>
      </div>
    </div>
  `;

  const inputBusca = container.querySelector('.tabela-busca');
  const tbody = container.querySelector('tbody');
  const selectTamanho = container.querySelector('.tabela-tamanho-pagina select');
  const infoPaginacao = container.querySelector('.tabela-paginacao-info');
  const spanPagina = container.querySelector('.tabela-pagina-atual');
  const controles = container.querySelector('.tabela-paginacao-controles');

  selectTamanho.value = String(tamanhoPaginaPadrao);

  if (inputBusca) {
    inputBusca.addEventListener('input', () => {
      termoBusca = inputBusca.value.trim().toLowerCase();
      pagina = 1;
      aplicarFiltro();
    });
  }

  selectTamanho.addEventListener('change', () => {
    tamanhoPagina = Number(selectTamanho.value);
    pagina = 1;
    renderizar();
  });

  controles.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-acao]');
    if (!btn) return;
    const totalPaginas = Math.max(1, Math.ceil(filtrados.length / tamanhoPagina));
    if (btn.dataset.acao === 'primeira') pagina = 1;
    if (btn.dataset.acao === 'anterior') pagina = Math.max(1, pagina - 1);
    if (btn.dataset.acao === 'proxima') pagina = Math.min(totalPaginas, pagina + 1);
    if (btn.dataset.acao === 'ultima') pagina = totalPaginas;
    renderizar();
  });

  tbody.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-acao-linha]');
    if (!btn) return;
    const registro = todos.find(r => String(idDoRegistro(r)) === btn.dataset.id);
    const acao = acoes.find(a => a.chave === btn.dataset.acaoLinha);
    if (acao && registro) acao.aoClicar(registro);
  });

  function aplicarFiltro() {
    filtrados = !termoBusca || !campoBusca
      ? todos
      : todos.filter(r => campoBusca(r).toLowerCase().includes(termoBusca));
    renderizar();
  }

  function renderizar() {
    const totalPaginas = Math.max(1, Math.ceil(filtrados.length / tamanhoPagina));
    if (pagina > totalPaginas) pagina = totalPaginas;
    const inicio = (pagina - 1) * tamanhoPagina;
    const linhas = filtrados.slice(inicio, inicio + tamanhoPagina);
    const totalColunas = colunas.length + (acoes.length ? 1 : 0);

    tbody.innerHTML = linhas.length === 0
      ? `<tr><td colspan="${totalColunas}" class="tabela-vazio">${escaparHtml(todos.length === 0 ? mensagemVazio : 'Nenhum resultado para a busca')}</td></tr>`
      : linhas.map(row => `
          <tr>
            ${colunas.map(c => `<td>${c.render ? c.render(row) : escaparHtml(row[c.campo])}</td>`).join('')}
            ${acoes.length ? `<td class="acoes">${acoes
              .filter(a => !a.visivel || a.visivel(row))
              .map(a => `<button type="button" class="${a.classe || ''}" data-acao-linha="${a.chave}" data-id="${idDoRegistro(row)}">${escaparHtml(a.rotulo)}</button>`)
              .join('')}</td>` : ''}
          </tr>
        `).join('');

    const totalRegistros = filtrados.length;
    const fim = Math.min(inicio + tamanhoPagina, totalRegistros);
    infoPaginacao.textContent = totalRegistros === 0
      ? '0 registros'
      : `Mostrando ${inicio + 1}–${fim} de ${totalRegistros}`;
    spanPagina.textContent = `Página ${pagina} de ${totalPaginas}`;

    controles.querySelector('[data-acao="primeira"]').disabled = pagina <= 1;
    controles.querySelector('[data-acao="anterior"]').disabled = pagina <= 1;
    controles.querySelector('[data-acao="proxima"]').disabled = pagina >= totalPaginas;
    controles.querySelector('[data-acao="ultima"]').disabled = pagina >= totalPaginas;
  }

  return {
    definirDados(dados) {
      todos = dados;
      aplicarFiltro();
    }
  };
}
