const formProduto = document.getElementById('form-produto');
const idProduto = new URLSearchParams(location.search).get('id');
const campoEstoqueInicial = document.getElementById('campo-estoque-inicial');
const campoLancarCaixa = document.getElementById('campo-lancar-caixa');
const dicaEstoqueEdicao = document.getElementById('dica-estoque-edicao');
const inputImagem = document.querySelector('input[name=imagem]');
const previewImagem = document.getElementById('produto-imagem-preview');
const campoRemoverImagem = document.getElementById('campo-remover-imagem');
const checkboxRemoverImagem = document.querySelector('input[name=removerImagem]');
const campoTags = criarCampoTags(document.getElementById('campo-tags'));

let imagemAtualUrl = null;

function mostrarPreview(url) {
  if (url) {
    previewImagem.innerHTML = `<img src="${url}" alt="">`;
    previewImagem.classList.remove('produto-imagem-preview-vazio');
  } else {
    previewImagem.textContent = 'Sem imagem';
    previewImagem.classList.add('produto-imagem-preview-vazio');
  }
}

if (idProduto) {
  document.getElementById('titulo-pagina').textContent = 'Editar Produto · Controle de Vendas';
  document.getElementById('titulo-formulario').textContent = 'Editar Produto';
  campoEstoqueInicial.style.display = 'none';
  campoLancarCaixa.style.display = 'none';
  carregarProduto(idProduto);
}

async function carregarProduto(id) {
  try {
    const produto = await api('GET', '/produtos/' + id);
    formProduto.nome.value = produto.nome;
    formProduto.precoCusto.value = produto.precoCusto;
    formProduto.precoVenda.value = produto.precoVenda;
    document.getElementById('estoque-atual').textContent = produto.estoque;
    dicaEstoqueEdicao.style.display = '';
    campoTags.definirTags(produto.tags);
    imagemAtualUrl = produto.imagem;
    if (imagemAtualUrl) {
      mostrarPreview(imagemAtualUrl);
      campoRemoverImagem.style.display = '';
    }
  } catch (e) {
    alert(e.message);
    location.href = 'produtos.html';
  }
}

inputImagem.addEventListener('change', () => {
  const arquivo = inputImagem.files[0];
  if (arquivo) {
    checkboxRemoverImagem.checked = false;
    mostrarPreview(URL.createObjectURL(arquivo));
  } else {
    mostrarPreview(imagemAtualUrl);
  }
});

checkboxRemoverImagem.addEventListener('change', () => {
  if (checkboxRemoverImagem.checked) {
    inputImagem.value = '';
    mostrarPreview(null);
  } else {
    mostrarPreview(imagemAtualUrl);
  }
});

formProduto.addEventListener('submit', async (e) => {
  e.preventDefault();
  const dados = new FormData();
  dados.append('nome', formProduto.nome.value);
  dados.append('precoCusto', formProduto.precoCusto.value);
  dados.append('precoVenda', formProduto.precoVenda.value);
  dados.append('tags', campoTags.obterTags().join(','));
  if (inputImagem.files[0]) dados.append('imagem', inputImagem.files[0]);

  try {
    if (idProduto) {
      if (checkboxRemoverImagem.checked) dados.append('removerImagem', 'true');
      await api('PUT', '/produtos/' + idProduto, dados);
    } else {
      dados.append('estoqueInicial', formProduto.estoqueInicial.value);
      dados.append('lancarCompraNoCaixa', formProduto.lancarCompraNoCaixa.checked);
      await api('POST', '/produtos', dados);
    }
    location.href = 'produtos.html';
  } catch (e) {
    alert(e.message);
  }
});

initSidebar('produtos');
