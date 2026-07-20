const tabelaFornecedores = criarTabela(document.getElementById('tabela-fornecedores'), {
  colunas: [
    { titulo: 'Nome', campo: 'nome' },
    { titulo: 'Telefone', campo: 'telefone' },
    { titulo: 'E-mail', campo: 'email' },
    { titulo: 'Endereço', campo: 'endereco' }
  ],
  campoBusca: (f) => [f.nome, f.telefone, f.email, f.endereco].join(' '),
  placeholderBusca: 'Buscar por nome, telefone, e-mail ou endereço...',
  mensagemVazio: 'Nenhum fornecedor cadastrado',
  acoes: [
    { chave: 'editar', rotulo: 'Editar', aoClicar: (f) => { location.href = 'fornecedor-form.html?id=' + f.id; } },
    { chave: 'excluir', rotulo: 'Excluir', classe: 'perigo', aoClicar: excluirFornecedor }
  ]
});

async function carregarFornecedores() {
  try {
    const fornecedores = await api('GET', '/fornecedores');
    tabelaFornecedores.definirDados(fornecedores);
  } catch (e) {
    alert(e.message);
  }
}

async function excluirFornecedor(fornecedor) {
  if (!confirm(`Excluir o fornecedor "${fornecedor.nome}"?`)) return;
  try {
    await api('DELETE', '/fornecedores/' + fornecedor.id);
    await carregarFornecedores();
  } catch (e) {
    alert(e.message);
  }
}

initSidebar('fornecedores');
carregarFornecedores();
