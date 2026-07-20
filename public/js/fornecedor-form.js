const formFornecedor = document.getElementById('form-fornecedor');
const idFornecedor = new URLSearchParams(location.search).get('id');

if (idFornecedor) {
  document.getElementById('titulo-pagina').textContent = 'Editar Fornecedor · Controle de Vendas';
  document.getElementById('titulo-formulario').textContent = 'Editar Fornecedor';
  carregarFornecedor(idFornecedor);
}

async function carregarFornecedor(id) {
  try {
    const fornecedor = await api('GET', '/fornecedores/' + id);
    formFornecedor.id.value = fornecedor.id;
    formFornecedor.nome.value = fornecedor.nome;
    formFornecedor.telefone.value = fornecedor.telefone;
    formFornecedor.email.value = fornecedor.email;
    formFornecedor.endereco.value = fornecedor.endereco;
  } catch (e) {
    alert(e.message);
    location.href = 'fornecedores.html';
  }
}

formFornecedor.addEventListener('submit', async (e) => {
  e.preventDefault();
  const dados = {
    nome: formFornecedor.nome.value,
    telefone: formFornecedor.telefone.value,
    email: formFornecedor.email.value,
    endereco: formFornecedor.endereco.value
  };
  try {
    if (formFornecedor.id.value) {
      await api('PUT', '/fornecedores/' + formFornecedor.id.value, dados);
    } else {
      await api('POST', '/fornecedores', dados);
    }
    location.href = 'fornecedores.html';
  } catch (e) {
    alert(e.message);
  }
});

initSidebar('fornecedores');
