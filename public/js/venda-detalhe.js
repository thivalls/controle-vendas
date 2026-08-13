const formVendaDetalhe = document.getElementById('form-venda-detalhe');
const idVenda = new URLSearchParams(location.search).get('id');

if (!idVenda) {
  location.href = 'index.html#vendas';
}

preencherSelectEnum(document.getElementById('select-forma-pagamento-venda-detalhe'), FORMAS_PAGAMENTO, { comOpcaoVazia: 'Selecione (opcional)' });

const buscaClienteVendaDetalhe = criarBuscaCliente(document.getElementById('busca-cliente-venda-detalhe'));

const campoPrevisaoPagamentoDetalhe = document.getElementById('campo-previsao-pagamento-detalhe');
const campoDataPagamentoDetalhe = document.getElementById('campo-data-pagamento-detalhe');
formVendaDetalhe.statusPagamento.addEventListener('change', () => {
  const pendente = formVendaDetalhe.statusPagamento.value === 'pendente';
  campoPrevisaoPagamentoDetalhe.style.display = pendente ? '' : 'none';
  campoDataPagamentoDetalhe.style.display = pendente ? 'none' : '';
});

let vendaAtual = null;

async function carregarVendaDetalhe() {
  try {
    const [clientes, venda] = await Promise.all([
      api('GET', '/clientes'),
      api('GET', '/vendas/' + idVenda)
    ]);
    buscaClienteVendaDetalhe.definirClientes(clientes);
    vendaAtual = venda;
    preencherFormulario(venda);
    renderItensVenda(venda);
    renderAcoesVenda(venda);
  } catch (e) {
    alert(e.message);
    location.href = 'index.html#vendas';
  }
}

function preencherFormulario(venda) {
  document.getElementById('titulo-pagina').textContent = `Venda #${venda.id} · Controle de Vendas`;
  document.getElementById('titulo-formulario').textContent = `Venda #${venda.id} — ${venda.clienteNome}`;

  formVendaDetalhe.id.value = venda.id;
  buscaClienteVendaDetalhe.definirCliente({ id: venda.clienteId, nome: venda.clienteNome });
  formVendaDetalhe.formaPagamento.value = venda.formaPagamento || '';
  formVendaDetalhe.statusPagamento.value = venda.statusPagamento;
  formVendaDetalhe.data.value = venda.data.slice(0, 10);
  formVendaDetalhe.dataPagamento.value = venda.dataPagamento ? venda.dataPagamento.slice(0, 10) : venda.data.slice(0, 10);
  formVendaDetalhe.previsaoPagamento.value = venda.previsaoPagamento ? venda.previsaoPagamento.slice(0, 10) : '';
  formVendaDetalhe.observacoes.value = venda.observacoes || '';

  const pendente = venda.statusPagamento === 'pendente';
  campoPrevisaoPagamentoDetalhe.style.display = pendente ? '' : 'none';
  campoDataPagamentoDetalhe.style.display = pendente ? 'none' : '';

  const bloqueado = venda.status === 'cancelado';
  Array.from(formVendaDetalhe.elements).forEach(el => { el.disabled = bloqueado; });
  if (bloqueado) document.getElementById('busca-cliente-venda-detalhe').querySelectorAll('input, button').forEach(el => { el.disabled = true; });
}

function renderItensVenda(venda) {
  const tbody = document.querySelector('#tabela-itens-venda tbody');
  tbody.innerHTML = venda.itens.map(item => `
    <tr>
      <td>${escaparHtml(item.produtoNome)}</td>
      <td>${item.quantidade}</td>
      <td>${formatarMoeda(item.precoUnitVenda)}</td>
      <td>${formatarMoeda(item.quantidade * item.precoUnitVenda)}</td>
    </tr>
  `).join('') || '<tr><td colspan="4">Nenhum produto nesta venda</td></tr>';
  document.getElementById('total-itens-venda').textContent = formatarMoeda(venda.total);
}

function renderAcoesVenda(venda) {
  const painel = document.getElementById('painel-acoes-venda');
  const btnDarBaixa = document.getElementById('btn-dar-baixa-venda-detalhe');
  const btnCancelar = document.getElementById('btn-cancelar-venda-detalhe');

  if (venda.status === 'cancelado') {
    painel.hidden = true;
    return;
  }
  painel.hidden = false;
  btnDarBaixa.hidden = venda.statusPagamento !== 'pendente';
}

document.getElementById('btn-dar-baixa-venda-detalhe').addEventListener('click', async () => {
  if (!confirm('Confirmar o recebimento desta venda? Ela passará a contar como paga hoje.')) return;
  try {
    await api('POST', `/vendas/${idVenda}/dar-baixa`);
    await carregarVendaDetalhe();
  } catch (e) { alert(e.message); }
});

document.getElementById('btn-cancelar-venda-detalhe').addEventListener('click', async () => {
  if (!confirm('Cancelar esta venda? O estoque será devolvido e, se o pagamento já tiver sido recebido, o valor deixará de contar no relatório.')) return;
  try {
    await api('POST', `/vendas/${idVenda}/cancelar`);
    await carregarVendaDetalhe();
  } catch (e) { alert(e.message); }
});

formVendaDetalhe.addEventListener('submit', async (e) => {
  e.preventDefault();
  const clienteId = buscaClienteVendaDetalhe.obterClienteId();
  if (!clienteId) { alert('Selecione um cliente'); return; }

  try {
    await api('PUT', '/vendas/' + idVenda, {
      clienteId,
      formaPagamento: formVendaDetalhe.formaPagamento.value,
      statusPagamento: formVendaDetalhe.statusPagamento.value,
      previsaoPagamento: formVendaDetalhe.previsaoPagamento.value || undefined,
      data: formVendaDetalhe.data.value || undefined,
      dataPagamento: formVendaDetalhe.dataPagamento.value || undefined,
      observacoes: formVendaDetalhe.observacoes.value
    });
    await carregarVendaDetalhe();
    alert('Venda atualizada com sucesso.');
  } catch (e) { alert(e.message); }
});

initSidebar('vendas');
carregarVendaDetalhe();
