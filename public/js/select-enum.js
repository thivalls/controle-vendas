// Preenche um <select> nativo a partir de um enum ou array de valores (não relacionados
// a uma entidade do banco — para isso use select-busca.js). Aceita itens como string
// ('Pix') ou como { value, label } quando o valor salvo difere do texto exibido.
// Preserva a seleção atual do <select> ao repopular (útil em filtros que recarregam).
//
// Uso: preencherSelectEnum(selectEl, FORMAS_PAGAMENTO, { comOpcaoVazia: 'Todas' });
//      preencherSelectEnum(selectEl, ['x', dadosDinamicos...]);

function preencherSelectEnum(selectEl, itens, opcoes = {}) {
  const { comOpcaoVazia = null, valorSelecionado = null } = opcoes;
  const normalizar = (item) => (item && typeof item === 'object') ? item : { value: item, label: item };

  const valorAntes = valorSelecionado !== null ? valorSelecionado : selectEl.value;
  const html = [];
  if (comOpcaoVazia !== null) html.push(`<option value="">${escaparHtml(comOpcaoVazia)}</option>`);
  itens.map(normalizar).forEach(({ value, label }) => {
    html.push(`<option value="${escaparHtml(value)}">${escaparHtml(label)}</option>`);
  });
  selectEl.innerHTML = html.join('');
  if (valorAntes) selectEl.value = valorAntes;
}
