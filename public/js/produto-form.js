const formProduto = document.getElementById('form-produto');
const idProduto = new URLSearchParams(location.search).get('id');

const campoTipoProduto = document.getElementById('campo-tipo-produto');
const tipoProdutoFixo = document.getElementById('tipo-produto-fixo');
const tipoProdutoFixoTexto = document.getElementById('tipo-produto-fixo-texto');
const camposSimples = document.getElementById('campos-simples');
const campoEstoqueInicial = document.getElementById('campo-estoque-inicial');
const campoLancarCaixa = document.getElementById('campo-lancar-caixa');
const dicaEstoqueEdicao = document.getElementById('dica-estoque-edicao');
const camposKit = document.getElementById('campos-kit');
const itensKitDiv = document.getElementById('itens-kit');
const kitCustoEstimado = document.getElementById('kit-custo-estimado');
const inputImagem = document.querySelector('input[name=imagem]');
const previewImagem = document.getElementById('produto-imagem-preview');
const campoRemoverImagem = document.getElementById('campo-remover-imagem');
const checkboxRemoverImagem = document.querySelector('input[name=removerImagem]');
const campoTags = criarCampoTags(document.getElementById('campo-tags'));

let imagemAtualUrl = null;
let skusDisponiveis = [];
let tipoAtual = 'simples';

function mostrarPreview(url) {
  if (url) {
    previewImagem.innerHTML = `<img src="${url}" alt="">`;
    previewImagem.classList.remove('produto-imagem-preview-vazio');
  } else {
    previewImagem.textContent = 'Sem imagem';
    previewImagem.classList.add('produto-imagem-preview-vazio');
  }
}

function aplicarVisibilidadeTipo(tipo) {
  tipoAtual = tipo;
  const ehKit = tipo === 'kit';
  camposSimples.style.display = ehKit ? 'none' : '';
  camposKit.style.display = ehKit ? '' : 'none';
  if (ehKit) atualizarCustoEstimadoKit();
}

// Tipo só é uma decisão de criação — depois de criado, fica fixo.
if (!idProduto) {
  formProduto.querySelectorAll('input[name=tipo]').forEach(radio => {
    radio.addEventListener('change', () => aplicarVisibilidadeTipo(radio.value));
  });
}

// ---------- Componentes do kit (SKUs) ----------
function novaLinhaComponenteKit(componenteExistente) {
  const div = document.createElement('div');
  div.className = 'item-linha';
  div.innerHTML = `
    <div class="item-produto"></div>
    <input type="number" class="item-quantidade" min="1" value="${componenteExistente ? componenteExistente.quantidade : 1}">
    <button type="button" class="secundario remover-item">Remover</button>
  `;

  const buscaComponente = criarBuscaSku(div.querySelector('.item-produto'), {
    onSelecionar: atualizarCustoEstimadoKit
  });
  buscaComponente.definirSkus(skusDisponiveis);
  if (componenteExistente) {
    buscaComponente.definirSku({
      id: componenteExistente.skuId,
      codigo: componenteExistente.codigo,
      nome: componenteExistente.nome,
      estoque: componenteExistente.estoque
    });
  }
  div._buscaSku = buscaComponente;

  div.querySelector('.item-quantidade').addEventListener('input', atualizarCustoEstimadoKit);
  div.querySelector('.remover-item').addEventListener('click', () => {
    buscaComponente.destruir();
    div.remove();
    atualizarCustoEstimadoKit();
  });

  itensKitDiv.appendChild(div);
}

function atualizarCustoEstimadoKit() {
  let custo = 0;
  let linhasValidas = 0;
  itensKitDiv.querySelectorAll('.item-linha').forEach(linha => {
    const skuId = linha._buscaSku.obterSkuId();
    const quantidade = Number(linha.querySelector('.item-quantidade').value) || 0;
    if (!skuId || quantidade <= 0) return;
    const sku = skusDisponiveis.find(s => String(s.id) === String(skuId));
    if (!sku) return;
    custo += sku.precoCusto * quantidade;
    linhasValidas++;
  });
  kitCustoEstimado.textContent = linhasValidas > 0 ? `Custo estimado do kit: ${formatarMoeda(custo)}` : '';
}

function limparComponentesKit() {
  itensKitDiv.querySelectorAll('.item-linha').forEach(linha => linha._buscaSku.destruir());
  itensKitDiv.innerHTML = '';
}

function obterComponentesKit() {
  return Array.from(itensKitDiv.querySelectorAll('.item-linha')).map(linha => ({
    skuId: linha._buscaSku.obterSkuId(),
    quantidade: Number(linha.querySelector('.item-quantidade').value)
  }));
}

document.getElementById('add-item-kit').addEventListener('click', () => {
  if (skusDisponiveis.length === 0) {
    alert('Cadastre ao menos um SKU antes de montar um kit.');
    return;
  }
  novaLinhaComponenteKit();
});

// ---------- Carregamento ----------
async function carregarSkusDisponiveis() {
  skusDisponiveis = await api('GET', '/skus');
}

if (idProduto) {
  document.getElementById('titulo-pagina').textContent = 'Editar Produto · Controle de Vendas';
  document.getElementById('titulo-formulario').textContent = 'Editar Produto';
  campoTipoProduto.style.display = 'none';
  campoEstoqueInicial.style.display = 'none';
  campoLancarCaixa.style.display = 'none';
  carregarProduto(idProduto);
} else {
  carregarSkusDisponiveis();
}

async function carregarProduto(id) {
  try {
    await carregarSkusDisponiveis();
    const produto = await api('GET', '/produtos/' + id);

    formProduto.nome.value = produto.nome;
    formProduto.precoVenda.value = produto.precoVenda;
    campoTags.definirTags(produto.tags);

    tipoProdutoFixo.style.display = '';
    tipoProdutoFixoTexto.textContent = produto.tipo === 'kit' ? 'Kit' : 'Simples';
    aplicarVisibilidadeTipo(produto.tipo);

    if (produto.tipo === 'simples') {
      const skuAtual = (produto.skus || [])[0];
      if (skuAtual) {
        formProduto.codigo.value = skuAtual.codigo || '';
        formProduto.precoCusto.value = skuAtual.precoCusto;
        document.getElementById('estoque-atual').textContent = skuAtual.estoque;
      }
      dicaEstoqueEdicao.style.display = '';
    } else {
      (produto.skus || []).forEach(componente => novaLinhaComponenteKit(componente));
      atualizarCustoEstimadoKit();
    }

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

  let componentesKit = null;
  if (tipoAtual === 'kit') {
    componentesKit = obterComponentesKit();
    if (componentesKit.some(c => !c.skuId)) {
      alert('Selecione o SKU em todos os componentes do kit');
      return;
    }
    const idsUnicos = new Set(componentesKit.map(c => c.skuId));
    if (idsUnicos.size < 2) {
      alert('Um kit precisa de pelo menos 2 SKUs diferentes');
      return;
    }
  }

  const dados = new FormData();
  dados.append('nome', formProduto.nome.value);
  dados.append('precoVenda', formProduto.precoVenda.value);
  dados.append('tags', campoTags.obterTags().join(','));
  if (inputImagem.files[0]) dados.append('imagem', inputImagem.files[0]);

  if (tipoAtual === 'kit') {
    dados.append('componentes', JSON.stringify(componentesKit));
  } else {
    dados.append('codigo', formProduto.codigo.value);
    dados.append('precoCusto', formProduto.precoCusto.value);
    if (!idProduto) {
      dados.append('estoqueInicial', formProduto.estoqueInicial.value);
      dados.append('lancarCompraNoCaixa', formProduto.lancarCompraNoCaixa.checked);
    }
  }

  try {
    if (idProduto) {
      if (checkboxRemoverImagem.checked) dados.append('removerImagem', 'true');
      await api('PUT', '/produtos/' + idProduto, dados);
    } else {
      dados.append('tipo', tipoAtual);
      await api('POST', '/produtos', dados);
    }
    location.href = 'produtos.html';
  } catch (e) {
    alert(e.message);
  }
});

initSidebar('produtos');
