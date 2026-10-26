const formCliente = document.getElementById('form-cliente');
const idCliente = new URLSearchParams(location.search).get('id');

if (idCliente) {
  document.getElementById('titulo-pagina').textContent = 'Editar Cliente · Controle de Vendas';
  document.getElementById('titulo-formulario').textContent = 'Editar Cliente';
  carregarCliente(idCliente);
  carregarHistoricoCompras(idCliente);
}

async function carregarCliente(id) {
  try {
    const cliente = await api('GET', '/clientes/' + id);
    formCliente.id.value = cliente.id;
    formCliente.nome.value = cliente.nome;
    formCliente.telefone.value = cliente.telefone;
    formCliente.email.value = cliente.email;
    formCliente.endereco.value = cliente.endereco;
  } catch (e) {
    alert(e.message);
    location.href = 'clientes.html';
  }
}

// Histórico de compras: reaproveita a listagem de vendas (não tem endpoint filtrado por
// cliente ainda) e filtra no navegador, mesmo padrão já usado no resto do sistema.
async function carregarHistoricoCompras(id) {
  try {
    const vendas = await api('GET', '/vendas');
    const vendasDoCliente = vendas
      .filter(v => String(v.clienteId) === String(id))
      .sort((a, b) => new Date(b.data) - new Date(a.data));
    renderHistoricoCompras(vendasDoCliente);
  } catch (e) {
    // Histórico é um extra na tela de edição — se falhar, não trava o resto da página
    console.error(e);
  }
}

function formatarPagamentoHistorico(v) {
  if (v.statusPagamento === 'pendente') return '<span class="badge pendente">Pendente</span>';
  return '<span class="badge pago">Pago</span>';
}

function renderHistoricoCompras(vendas) {
  const painel = document.getElementById('painel-historico-compras');
  if (vendas.length === 0) {
    painel.hidden = true;
    return;
  }
  painel.hidden = false;

  const concluidas = vendas.filter(v => v.status === 'concluido');
  const totalComprado = concluidas.reduce((soma, v) => soma + Number(v.total), 0);
  document.getElementById('historico-qtd-compras').textContent = concluidas.length;
  document.getElementById('historico-total-comprado').textContent = formatarMoeda(totalComprado);

  const tbody = document.querySelector('#tabela-historico-compras tbody');
  tbody.innerHTML = vendas.map(v => `
    <tr>
      <td>#${v.id}</td>
      <td>${formatarData(v.data)}</td>
      <td>${formatarMoeda(v.total)}</td>
      <td><span class="badge ${v.status}">${v.status === 'concluido' ? 'Concluído' : 'Cancelado'}</span></td>
      <td>${formatarPagamentoHistorico(v)}</td>
      <td><a href="venda-detalhe.html?id=${v.id}" class="botao secundario">Ver</a></td>
    </tr>
  `).join('');
}

formCliente.addEventListener('submit', async (e) => {
  e.preventDefault();
  const dados = {
    nome: formCliente.nome.value,
    telefone: formCliente.telefone.value,
    email: formCliente.email.value,
    endereco: formCliente.endereco.value
  };
  try {
    if (formCliente.id.value) {
      await api('PUT', '/clientes/' + formCliente.id.value, dados);
    } else {
      await api('POST', '/clientes', dados);
    }
    location.href = 'clientes.html';
  } catch (e) {
    alert(e.message);
  }
});

initSidebar('clientes');
