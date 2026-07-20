const tabelaClientes = criarTabela(document.getElementById('tabela-clientes'), {
  colunas: [
    { titulo: 'Nome', campo: 'nome' },
    { titulo: 'Telefone', campo: 'telefone' },
    { titulo: 'E-mail', campo: 'email' },
    { titulo: 'Endereço', campo: 'endereco' }
  ],
  campoBusca: (c) => [c.nome, c.telefone, c.email, c.endereco].join(' '),
  placeholderBusca: 'Buscar por nome, telefone, e-mail ou endereço...',
  mensagemVazio: 'Nenhum cliente cadastrado',
  acoes: [
    { chave: 'editar', rotulo: 'Editar', aoClicar: (c) => { location.href = 'cliente-form.html?id=' + c.id; } },
    { chave: 'excluir', rotulo: 'Excluir', classe: 'perigo', aoClicar: excluirCliente }
  ]
});

async function carregarClientes() {
  try {
    const clientes = await api('GET', '/clientes');
    tabelaClientes.definirDados(clientes);
  } catch (e) {
    alert(e.message);
  }
}

async function excluirCliente(cliente) {
  if (!confirm(`Excluir o cliente "${cliente.nome}"?`)) return;
  try {
    await api('DELETE', '/clientes/' + cliente.id);
    await carregarClientes();
  } catch (e) {
    alert(e.message);
  }
}

initSidebar('clientes');
carregarClientes();
