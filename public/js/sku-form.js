const formSku = document.getElementById('form-sku');
const idSku = new URLSearchParams(location.search).get('id');
const campoEstoqueInicial = document.getElementById('campo-estoque-inicial');
const campoLancarCaixa = document.getElementById('campo-lancar-caixa');
const dicaEstoqueEdicao = document.getElementById('dica-estoque-edicao');
const buscaFornecedorSku = criarBuscaFornecedor(document.getElementById('busca-fornecedor-sku'));

async function carregarFornecedores() {
  const fornecedores = await api('GET', '/fornecedores');
  buscaFornecedorSku.definirFornecedores(fornecedores);
  return fornecedores;
}

if (idSku) {
  document.getElementById('titulo-pagina').textContent = 'Editar SKU · Controle de Vendas';
  document.getElementById('titulo-formulario').textContent = 'Editar SKU';
  campoEstoqueInicial.style.display = 'none';
  campoLancarCaixa.style.display = 'none';
  carregarSku(idSku);
} else {
  carregarFornecedores();
}

async function carregarSku(id) {
  try {
    const fornecedores = await carregarFornecedores();
    const sku = await api('GET', '/skus/' + id);
    formSku.codigo.value = sku.codigo;
    formSku.nome.value = sku.nome;
    formSku.precoCusto.value = sku.precoCusto;
    document.getElementById('estoque-atual').textContent = sku.estoque;
    dicaEstoqueEdicao.style.display = '';
    if (sku.fornecedorId) {
      const fornecedor = fornecedores.find(f => f.id === sku.fornecedorId);
      if (fornecedor) buscaFornecedorSku.definirFornecedor(fornecedor);
    }
  } catch (e) {
    alert(e.message);
    location.href = 'skus.html';
  }
}

formSku.addEventListener('submit', async (e) => {
  e.preventDefault();
  const dados = {
    codigo: formSku.codigo.value,
    nome: formSku.nome.value,
    precoCusto: formSku.precoCusto.value,
    fornecedorId: buscaFornecedorSku.obterFornecedorId()
  };
  try {
    if (idSku) {
      await api('PUT', '/skus/' + idSku, dados);
    } else {
      dados.estoqueInicial = formSku.estoqueInicial.value;
      dados.lancarCompraNoCaixa = formSku.lancarCompraNoCaixa.checked;
      await api('POST', '/skus', dados);
    }
    location.href = 'skus.html';
  } catch (e) {
    alert(e.message);
  }
});

initSidebar('skus');
