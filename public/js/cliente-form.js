const formCliente = document.getElementById('form-cliente');
const idCliente = new URLSearchParams(location.search).get('id');

if (idCliente) {
  document.getElementById('titulo-pagina').textContent = 'Editar Cliente · Controle de Vendas';
  document.getElementById('titulo-formulario').textContent = 'Editar Cliente';
  carregarCliente(idCliente);
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
