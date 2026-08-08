let cacheClientes = [];
let cacheFornecedores = [];
let cacheProdutos = [];
let cacheSkus = [];
let cacheVendas = [];

const NOMES_MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function formatarMesLabel(mes) {
  const [ano, m] = mes.split('-');
  return `${NOMES_MESES[Number(m) - 1]}/${ano}`;
}

// ---------- NAVEGAÇÃO ----------
const CARREGAR_ABA = {
  dashboard: () => carregarDashboard(),
  estoque: () => carregarEstoque(),
  vendas: () => carregarVendas(),
  pedidos: () => carregarPedidos(),
  relatorio: () => buscarRelatorio()
};

function ativarAba(chave) {
  const content = document.getElementById('tab-' + chave);
  if (!content) return false;
  document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
  content.classList.add('active');
  destacarItemNav(chave);
  history.replaceState(null, '', '#' + chave);
  CARREGAR_ABA[chave]?.();
  return true;
}

document.getElementById('nav').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab-btn');
  if (!btn || !btn.dataset.tab) return;
  if (!document.getElementById('tab-' + btn.dataset.tab)) return; // não é uma aba desta página: deixa o link navegar normalmente
  e.preventDefault();
  ativarAba(btn.dataset.tab);
});

// Ao chegar em index.html vindo de outra página (ex: clientes.html -> index.html#vendas),
// a aba a exibir vem do hash da URL; sem isso a página sempre abria no dashboard.
const abaInicial = (location.hash || '').replace('#', '');
const temAbaInicialValida = abaInicial && document.getElementById('tab-' + abaInicial);
initSidebar(temAbaInicialValida ? abaInicial : 'dashboard');

// ---------- DASHBOARD ----------
async function carregarDashboard() {
  const mes = new Date().toISOString().slice(0, 7);
  const r = await api('GET', '/relatorios/dashboard?mes=' + mes);
  document.getElementById('dash-mes-label').textContent = 'Referente a ' + formatarMesLabel(r.mes);
  document.getElementById('dash-vendas-mes').textContent = r.numeroVendasNoMes;
  document.getElementById('dash-valor-recebido').textContent = formatarMoeda(r.valorRecebidoNoMes);
  renderBarrasProdutos(document.getElementById('dash-produtos-mes'), r.produtosMaisVendidosNoMes);
  renderBarrasProdutos(document.getElementById('dash-produtos-ano'), r.produtosMaisVendidosNoAno);
}

function renderBarrasProdutos(container, produtos) {
  container.innerHTML = '';
  if (produtos.length === 0) {
    const p = document.createElement('p');
    p.className = 'dica';
    p.textContent = 'Nenhuma venda no período';
    container.appendChild(p);
    return;
  }
  const max = Math.max(...produtos.map(p => p.quantidade));
  produtos.forEach(p => {
    const linha = document.createElement('div');
    linha.className = 'barra-produto';
    linha.title = `${p.quantidade} un. · ${formatarMoeda(p.valor)}`;

    const nome = document.createElement('span');
    nome.className = 'barra-produto-nome';
    nome.textContent = p.produtoNome;

    const trilha = document.createElement('div');
    trilha.className = 'barra-produto-trilha';
    const fill = document.createElement('div');
    fill.className = 'barra-produto-fill';
    fill.style.width = `${(p.quantidade / max) * 100}%`;
    trilha.appendChild(fill);

    const valor = document.createElement('span');
    valor.className = 'barra-produto-valor';
    valor.textContent = `${p.quantidade} un.`;

    linha.append(nome, trilha, valor);
    container.appendChild(linha);
  });
}

// ---------- CLIENTES (cadastro fica em clientes.html; aqui só alimentamos os selects de Vendas) ----------
const buscaClienteVenda = criarBuscaCliente(document.getElementById('busca-cliente-venda'));
const buscaClienteFiltroVendas = criarBuscaCliente(document.getElementById('busca-cliente-filtro-vendas'), {
  placeholder: 'Todos os clientes...',
  onSelecionar: () => renderVendasFiltradas()
});

async function carregarClientesParaSelects() {
  cacheClientes = await api('GET', '/clientes');
  buscaClienteVenda.definirClientes(cacheClientes);
  buscaClienteFiltroVendas.definirClientes(cacheClientes);
}

// Cadastro rápido de cliente direto na Nova Venda, sem sair da tela
const modalNovoCliente = criarModal(document.getElementById('modal-novo-cliente'));
const formModalCliente = document.getElementById('form-modal-cliente');

document.getElementById('btn-novo-cliente-venda').addEventListener('click', () => {
  formModalCliente.reset();
  modalNovoCliente.abrir();
  formModalCliente.nome.focus();
});

formModalCliente.addEventListener('submit', async (e) => {
  e.preventDefault();
  const dados = {
    nome: formModalCliente.nome.value,
    telefone: formModalCliente.telefone.value,
    email: formModalCliente.email.value,
    endereco: formModalCliente.endereco.value
  };
  try {
    const cliente = await api('POST', '/clientes', dados);
    cacheClientes.push(cliente);
    buscaClienteVenda.definirClientes(cacheClientes);
    buscaClienteFiltroVendas.definirClientes(cacheClientes);
    buscaClienteVenda.definirCliente(cliente);
    modalNovoCliente.fechar();
  } catch (e) { alert(e.message); }
});

// ---------- FORNECEDORES (cadastro fica em fornecedores.html; aqui só alimentamos o select de Pedidos) ----------
const buscaFornecedorPedido = criarBuscaFornecedor(document.getElementById('busca-fornecedor-pedido'));

async function carregarFornecedoresParaSelects() {
  cacheFornecedores = await api('GET', '/fornecedores');
  buscaFornecedorPedido.definirFornecedores(cacheFornecedores);
}

// ---------- PRODUTOS (cadastro fica em produtos.html; aqui só alimentamos os selects de Vendas) ----------
const buscaProdutosFiltroVendas = criarMultiSelectBusca(document.getElementById('busca-produtos-filtro-vendas'), {
  placeholder: 'Buscar produto para filtrar...',
  getTextoPesquisavel: (p) => [p.sku, p.nome, ...(p.tags || [])].join(' '),
  onAlterar: () => renderVendasFiltradas()
});

async function carregarProdutosParaSelects() {
  cacheProdutos = await api('GET', '/produtos');
  buscaProdutosFiltroVendas.definirItens(cacheProdutos);
}

// ---------- SKUS (cadastro fica em skus.html; aqui só alimentamos os selects de Estoque/Pedidos) ----------
async function carregarSkusParaSelects() {
  cacheSkus = await api('GET', '/skus');
  buscaSkuEstoque.definirSkus(cacheSkus);
}

// ---------- ESTOQUE (sempre movimenta o SKU — a unidade física de verdade) ----------
const formEstoque = document.getElementById('form-estoque');
const buscaSkuEstoque = criarBuscaSku(document.getElementById('busca-sku-estoque'), { nomeCampo: 'skuId' });

async function carregarEstoque() {
  const movimentos = await api('GET', '/estoque');
  const tbody = document.querySelector('#tabela-estoque tbody');
  tbody.innerHTML = movimentos.map(m => `
    <tr>
      <td>${formatarData(m.data)}</td>
      <td>${m.skuCodigo ? `${m.skuCodigo} — ${m.skuNome}` : m.skuNome}</td>
      <td>${m.tipo === 'entrada' ? 'Entrada' : 'Saída'}</td>
      <td>${m.quantidade}</td>
      <td>${m.motivo || ''}</td>
    </tr>
  `).join('') || '<tr><td colspan="5">Nenhuma movimentação registrada</td></tr>';
}

formEstoque.addEventListener('submit', async (e) => {
  e.preventDefault();
  const skuId = buscaSkuEstoque.obterSkuId();
  if (!skuId) { alert('Selecione um SKU'); return; }
  const tipo = formEstoque.tipo.value;
  const dados = {
    quantidade: formEstoque.quantidade.value,
    motivo: formEstoque.motivo.value,
    custoTotal: formEstoque.custoTotal.value || undefined
  };
  try {
    await api('POST', `/skus/${skuId}/${tipo}`, dados);
    formEstoque.reset();
    buscaSkuEstoque.limpar();
    await carregarSkusParaSelects();
    await carregarProdutosParaSelects();
    await carregarEstoque();
  } catch (e) { alert(e.message); }
});

// ---------- VENDAS ----------
const formVenda = document.getElementById('form-venda');
const itensVendaDiv = document.getElementById('itens-venda');

preencherSelectEnum(document.getElementById('select-forma-pagamento-venda'), FORMAS_PAGAMENTO, { comOpcaoVazia: 'Selecione (opcional)' });

function novaLinhaItemVenda() {
  const div = document.createElement('div');
  div.className = 'item-linha';
  div.innerHTML = `
    <div class="item-produto"></div>
    <input type="number" class="item-quantidade" min="1" value="1">
    <input type="number" class="item-preco" min="0" step="0.01" placeholder="Preço unitário (R$)">
    <button type="button" class="secundario remover-item">Remover</button>
  `;
  const inputPreco = div.querySelector('.item-preco');
  inputPreco.value = '0.00';

  const buscaProduto = criarBuscaProduto(div.querySelector('.item-produto'), {
    placeholder: 'Buscar produto por nome, SKU ou tag...',
    onSelecionar: (p) => {
      inputPreco.value = Number(p.precoVenda).toFixed(2);
      atualizarTotalVenda();
    }
  });
  buscaProduto.definirProdutos(cacheProdutos);
  div._buscaProduto = buscaProduto;

  div.querySelector('.remover-item').addEventListener('click', () => {
    buscaProduto.destruir();
    div.remove();
    atualizarTotalVenda();
  });
  inputPreco.addEventListener('input', atualizarTotalVenda);
  div.querySelector('.item-quantidade').addEventListener('input', atualizarTotalVenda);
  itensVendaDiv.appendChild(div);
  atualizarTotalVenda();
}

function limparItensVenda() {
  itensVendaDiv.querySelectorAll('.item-linha').forEach(linha => linha._buscaProduto.destruir());
  itensVendaDiv.innerHTML = '';
}

function atualizarTotalVenda() {
  let total = 0;
  itensVendaDiv.querySelectorAll('.item-linha').forEach(linha => {
    const preco = Number(linha.querySelector('.item-preco').value) || 0;
    const qtd = Number(linha.querySelector('.item-quantidade').value) || 0;
    total += preco * qtd;
  });
  document.getElementById('total-venda').textContent = formatarMoeda(total);
}

document.getElementById('add-item-venda').addEventListener('click', () => {
  if (cacheProdutos.length === 0) {
    alert('Cadastre ao menos um produto antes de criar uma venda.');
    return;
  }
  novaLinhaItemVenda();
});

const campoPrevisaoPagamento = document.getElementById('campo-previsao-pagamento');
const campoDataPagamento = document.getElementById('campo-data-pagamento');
formVenda.statusPagamento.addEventListener('change', () => {
  const pendente = formVenda.statusPagamento.value === 'pendente';
  campoPrevisaoPagamento.style.display = pendente ? '' : 'none';
  campoDataPagamento.style.display = pendente ? 'none' : '';
});

function definirDatasVendaParaHoje() {
  const hoje = new Date().toISOString().slice(0, 10);
  formVenda.data.value = hoje;
  formVenda.dataPagamento.value = hoje;
}
definirDatasVendaParaHoje();

async function carregarVendas() {
  cacheVendas = await api('GET', '/vendas');
  preencherFiltroFormaPagamentoVenda();
  renderVendasFiltradas();
}

function preencherFiltroFormaPagamentoVenda() {
  const select = document.querySelector('#form-filtro-vendas select[name=formaPagamento]');
  const formasEmUso = cacheVendas.map(v => v.formaPagamento).filter(Boolean);
  const formas = [...new Set([...FORMAS_PAGAMENTO, ...formasEmUso])];
  preencherSelectEnum(select, formas, { comOpcaoVazia: 'Todas' });
}

function filtrarVendas() {
  const form = formFiltroVendas;
  const clienteId = buscaClienteFiltroVendas.obterClienteId();
  const status = form.status.value;
  const statusPagamento = form.statusPagamento.value;
  const formaPagamento = form.formaPagamento.value;
  const dataInicio = form.dataInicio.value;
  const dataFim = form.dataFim.value;
  const produtoIds = buscaProdutosFiltroVendas.obterIds();

  return cacheVendas.filter(v => {
    if (clienteId && String(v.clienteId) !== clienteId) return false;
    if (status && v.status !== status) return false;
    if (statusPagamento && v.statusPagamento !== statusPagamento) return false;
    if (formaPagamento && v.formaPagamento !== formaPagamento) return false;
    if (dataInicio && v.data.slice(0, 10) < dataInicio) return false;
    if (dataFim && v.data.slice(0, 10) > dataFim) return false;
    if (produtoIds.length > 0 && !v.itens.some(item => produtoIds.includes(item.produtoId))) return false;
    return true;
  });
}

function renderVendasFiltradas() {
  const vendas = filtrarVendas();
  const tbody = document.querySelector('#tabela-vendas tbody');
  tbody.innerHTML = vendas.map(v => `
    <tr>
      <td>#${v.id}</td>
      <td>${formatarData(v.data)}</td>
      <td>${v.clienteNome}</td>
      <td>${formatarMoeda(v.total)}</td>
      <td><span class="badge ${v.status}">${v.status === 'concluido' ? 'Concluído' : 'Cancelado'}</span></td>
      <td>${formatarPagamentoVenda(v)}</td>
      <td class="acoes">
        ${v.status === 'concluido' && v.statusPagamento === 'pendente' ? `<button type="button" onclick="darBaixaVenda(${v.id})">Dar baixa</button>` : ''}
        ${v.status === 'concluido' ? `<button type="button" class="perigo" onclick="cancelarVenda(${v.id})">Cancelar</button>` : ''}
      </td>
    </tr>
  `).join('') || `<tr><td colspan="7">${cacheVendas.length === 0 ? 'Nenhuma venda registrada' : 'Nenhuma venda encontrada com os filtros selecionados'}</td></tr>`;
}

function formatarPagamentoVenda(v) {
  if (v.statusPagamento === 'pendente') {
    const previsao = v.previsaoPagamento ? ` (previsão ${new Date(v.previsaoPagamento).toLocaleDateString('pt-BR', { timeZone: 'UTC' })})` : '';
    return `<span class="badge pendente">Pendente</span>${previsao}`;
  }
  return `<span class="badge pago">Pago</span>`;
}

const formFiltroVendas = document.getElementById('form-filtro-vendas');
formFiltroVendas.addEventListener('input', renderVendasFiltradas);
formFiltroVendas.addEventListener('change', renderVendasFiltradas);
document.getElementById('limpar-filtro-vendas').addEventListener('click', () => {
  formFiltroVendas.reset();
  buscaClienteFiltroVendas.limpar();
  buscaProdutosFiltroVendas.limpar();
  renderVendasFiltradas();
});

window.cancelarVenda = async function (id) {
  if (!confirm('Cancelar esta venda? O estoque será devolvido e, se o pagamento já tiver sido recebido, o valor será estornado no caixa.')) return;
  try {
    await api('POST', `/vendas/${id}/cancelar`);
    await carregarVendas();
    await carregarSkusParaSelects();
    await carregarProdutosParaSelects();
  } catch (e) { alert(e.message); }
};

window.darBaixaVenda = async function (id) {
  if (!confirm('Confirmar o recebimento desta venda? O valor será lançado como entrada no caixa hoje.')) return;
  try {
    await api('POST', `/vendas/${id}/dar-baixa`);
    await carregarVendas();
  } catch (e) { alert(e.message); }
};

formVenda.addEventListener('submit', async (e) => {
  e.preventDefault();
  const clienteId = buscaClienteVenda.obterClienteId();
  if (!clienteId) { alert('Selecione um cliente'); return; }
  const linhas = itensVendaDiv.querySelectorAll('.item-linha');
  if (linhas.length === 0) { alert('Adicione ao menos um produto'); return; }

  if (Array.from(linhas).some(linha => !linha._buscaProduto.obterProdutoId())) {
    alert('Selecione o produto em todos os itens da venda');
    return;
  }

  const itens = Array.from(linhas).map(linha => ({
    produtoId: Number(linha._buscaProduto.obterProdutoId()),
    quantidade: Number(linha.querySelector('.item-quantidade').value),
    precoUnitVenda: Number(linha.querySelector('.item-preco').value)
  }));

  try {
    await api('POST', '/vendas', {
      clienteId,
      itens,
      formaPagamento: formVenda.formaPagamento.value,
      statusPagamento: formVenda.statusPagamento.value,
      previsaoPagamento: formVenda.previsaoPagamento.value || undefined,
      data: formVenda.data.value || undefined,
      dataPagamento: formVenda.dataPagamento.value || undefined
    });
    formVenda.reset();
    buscaClienteVenda.limpar();
    limparItensVenda();
    campoPrevisaoPagamento.style.display = 'none';
    campoDataPagamento.style.display = '';
    definirDatasVendaParaHoje();
    atualizarTotalVenda();
    await carregarVendas();
    await carregarSkusParaSelects();
    await carregarProdutosParaSelects();
  } catch (e) { alert(e.message); }
});

// ---------- PEDIDOS (compras) ----------
const formPedido = document.getElementById('form-pedido');
const itensPedidoDiv = document.getElementById('itens-pedido');

// Cadastro rápido de SKU direto num item do pedido, sem sair da tela.
// Preço de custo e estoque desse SKU ficam por conta do próprio item do pedido ao ser finalizado.
const modalNovoSku = criarModal(document.getElementById('modal-novo-sku'));
const formModalSku = document.getElementById('form-modal-sku');
let buscaSkuAlvoModal = null;

function abrirModalNovoSku(buscaSku) {
  buscaSkuAlvoModal = buscaSku;
  formModalSku.reset();
  modalNovoSku.abrir();
  formModalSku.nome.focus();
}

formModalSku.addEventListener('submit', async (e) => {
  e.preventDefault();
  const dados = {
    codigo: formModalSku.codigo.value,
    nome: formModalSku.nome.value,
    precoCusto: 0
  };
  try {
    const sku = await api('POST', '/skus', dados);
    cacheSkus.push(sku);
    buscaSkuEstoque.definirSkus(cacheSkus);
    itensPedidoDiv.querySelectorAll('.item-linha').forEach(linha => linha._buscaSku.definirSkus(cacheSkus));
    if (buscaSkuAlvoModal) buscaSkuAlvoModal.definirSku(sku);
    modalNovoSku.fechar();
  } catch (e) { alert(e.message); }
});

function novaLinhaItemPedido() {
  const div = document.createElement('div');
  div.className = 'item-linha';
  div.innerHTML = `
    <div class="item-produto campo-com-botao">
      <div class="item-produto-campo"></div>
      <button type="button" class="secundario btn-novo-sku">+ SKU</button>
    </div>
    <input type="number" class="item-quantidade" min="1" value="1">
    <input type="number" class="item-preco" min="0" step="0.01" placeholder="Preço unitário (R$)">
    <button type="button" class="secundario remover-item">Remover</button>
  `;
  const inputPreco = div.querySelector('.item-preco');
  inputPreco.value = '0.00';

  const buscaSku = criarBuscaSku(div.querySelector('.item-produto-campo'), {
    placeholder: 'Buscar SKU por código ou nome...',
    onSelecionar: (s) => {
      inputPreco.value = Number(s.precoCusto).toFixed(2);
      atualizarTotalPedido();
    }
  });
  buscaSku.definirSkus(cacheSkus);
  div._buscaSku = buscaSku;

  div.querySelector('.btn-novo-sku').addEventListener('click', () => abrirModalNovoSku(buscaSku));

  div.querySelector('.remover-item').addEventListener('click', () => {
    buscaSku.destruir();
    div.remove();
    atualizarTotalPedido();
  });
  inputPreco.addEventListener('input', atualizarTotalPedido);
  div.querySelector('.item-quantidade').addEventListener('input', atualizarTotalPedido);
  itensPedidoDiv.appendChild(div);
  atualizarTotalPedido();
}

function limparItensPedido() {
  itensPedidoDiv.querySelectorAll('.item-linha').forEach(linha => linha._buscaSku.destruir());
  itensPedidoDiv.innerHTML = '';
}

function atualizarTotalPedido() {
  let total = 0;
  itensPedidoDiv.querySelectorAll('.item-linha').forEach(linha => {
    const preco = Number(linha.querySelector('.item-preco').value) || 0;
    const qtd = Number(linha.querySelector('.item-quantidade').value) || 0;
    total += preco * qtd;
  });
  document.getElementById('total-pedido').textContent = formatarMoeda(total);
}

document.getElementById('add-item-pedido').addEventListener('click', () => {
  if (cacheSkus.length === 0) {
    alert('Cadastre ao menos um SKU antes de criar um pedido.');
    return;
  }
  novaLinhaItemPedido();
});

async function carregarPedidos() {
  const pedidos = await api('GET', '/pedidos');
  const tbody = document.querySelector('#tabela-pedidos tbody');
  tbody.innerHTML = pedidos.map(p => `
    <tr>
      <td>#${p.id}</td>
      <td>${formatarData(p.data)}</td>
      <td>${p.fornecedorNome}</td>
      <td>${p.numeroNotaFiscal || ''}</td>
      <td>${formatarMoeda(p.total)}</td>
      <td><span class="badge ${p.status}">${p.status === 'concluido' ? 'Concluído' : 'Cancelado'}</span></td>
      <td class="acoes">
        ${p.status === 'concluido' ? `<button type="button" class="perigo" onclick="cancelarPedido(${p.id})">Cancelar</button>` : ''}
      </td>
    </tr>
  `).join('') || '<tr><td colspan="7">Nenhum pedido registrado</td></tr>';
}

window.cancelarPedido = async function (id) {
  if (!confirm('Cancelar este pedido? A entrada de estoque será revertida e o valor estornado no caixa.')) return;
  try {
    await api('POST', `/pedidos/${id}/cancelar`);
    await carregarPedidos();
    await carregarSkusParaSelects();
    await carregarProdutosParaSelects();
  } catch (e) { alert(e.message); }
};

formPedido.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fornecedorId = buscaFornecedorPedido.obterFornecedorId();
  if (!fornecedorId) { alert('Selecione um fornecedor'); return; }
  const linhas = itensPedidoDiv.querySelectorAll('.item-linha');
  if (linhas.length === 0) { alert('Adicione ao menos um SKU'); return; }

  if (Array.from(linhas).some(linha => !linha._buscaSku.obterSkuId())) {
    alert('Selecione o SKU em todos os itens do pedido');
    return;
  }

  const itens = Array.from(linhas).map(linha => ({
    skuId: Number(linha._buscaSku.obterSkuId()),
    quantidade: Number(linha.querySelector('.item-quantidade').value),
    precoUnitCusto: Number(linha.querySelector('.item-preco').value)
  }));

  try {
    await api('POST', '/pedidos', {
      fornecedorId,
      itens,
      numeroNotaFiscal: formPedido.numeroNotaFiscal.value || undefined,
      dataNotaFiscal: formPedido.dataNotaFiscal.value || undefined
    });
    formPedido.reset();
    buscaFornecedorPedido.limpar();
    limparItensPedido();
    atualizarTotalPedido();
    await carregarPedidos();
    await carregarSkusParaSelects();
    await carregarProdutosParaSelects();
  } catch (e) { alert(e.message); }
});

// ---------- RELATÓRIO ----------
const inputMes = document.getElementById('input-mes');
inputMes.value = new Date().toISOString().slice(0, 7);

const selectVisaoRelatorio = document.getElementById('select-visao-relatorio');

async function buscarRelatorio() {
  const mes = inputMes.value || new Date().toISOString().slice(0, 7);
  const visao = selectVisaoRelatorio.value;
  const r = await api('GET', `/relatorios/mensal?mes=${mes}&visao=${visao}`);
  const div = document.getElementById('relatorio-resultado');
  div.innerHTML = `
    <div class="linha"><span>Vendas concluídas no mês${visao === 'real' ? ' (já pagas)' : ''}</span><span>${r.numeroVendas}</span></div>
    <div class="linha"><span>Vendas (receita)</span><span>${formatarMoeda(r.vendas)}</span></div>
    <div class="linha"><span>(-) Custo dos produtos vendidos</span><span>${formatarMoeda(r.custoProdutosVendidos)}</span></div>
    <div class="linha"><span>(-) Outras despesas</span><span>${formatarMoeda(r.outrasDespesas)}</span></div>
    <div class="linha lucro ${r.lucro >= 0 ? 'positivo' : 'negativo'}"><span>Lucro do mês</span><span>${formatarMoeda(r.lucro)}</span></div>
    <p class="dica">Compras de mercadoria no mês (não entram no lucro, viram custo só quando vendidas): ${formatarMoeda(r.comprasDeMercadoria)}</p>
    ${r.vendasPendentes.numero > 0 ? `<p class="dica">Recebimentos pendentes no mês (aguardando baixa): ${formatarMoeda(r.vendasPendentes.total)} em ${r.vendasPendentes.numero} venda(s)</p>` : ''}
  `;
}

document.getElementById('buscar-relatorio').addEventListener('click', buscarRelatorio);
selectVisaoRelatorio.addEventListener('change', buscarRelatorio);

// ---------- INICIALIZAÇÃO ----------
(async function init() {
  await carregarClientesParaSelects();
  await carregarFornecedoresParaSelects();
  await carregarSkusParaSelects();
  await carregarProdutosParaSelects();
  if (temAbaInicialValida) {
    ativarAba(abaInicial);
  } else {
    await carregarDashboard();
  }
})();
