const formCaixa = document.getElementById('form-caixa');
const idLancamento = new URLSearchParams(location.search).get('id');

if (idLancamento) {
  document.getElementById('titulo-pagina').textContent = 'Editar Lançamento · Controle de Vendas';
  document.getElementById('titulo-formulario').textContent = 'Editar Lançamento';
  carregarLancamento(idLancamento);
}

async function carregarLancamento(id) {
  try {
    const lancamento = await api('GET', '/caixa/' + id);
    if (lancamento.vendaId || lancamento.pedidoId) {
      alert('Este lançamento é gerado automaticamente por uma venda ou pedido e não pode ser editado diretamente.');
      location.href = 'caixa.html';
      return;
    }
    formCaixa.tipo.value = lancamento.tipo;
    formCaixa.categoria.value = lancamento.categoria;
    formCaixa.valor.value = lancamento.valor;
    formCaixa.descricao.value = lancamento.descricao;
  } catch (e) {
    alert(e.message);
    location.href = 'caixa.html';
  }
}

formCaixa.addEventListener('submit', async (e) => {
  e.preventDefault();
  const dados = {
    tipo: formCaixa.tipo.value,
    categoria: formCaixa.categoria.value,
    valor: formCaixa.valor.value,
    descricao: formCaixa.descricao.value
  };
  try {
    if (idLancamento) {
      await api('PUT', '/caixa/' + idLancamento, dados);
    } else {
      await api('POST', '/caixa', dados);
    }
    location.href = 'caixa.html';
  } catch (e) {
    alert(e.message);
  }
});

initSidebar('caixa');
