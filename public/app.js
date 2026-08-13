let cacheClientes = [];
let cacheFornecedores = [];
let cacheProdutos = [];
let cacheSkus = [];
let cacheVendas = [];
let cachePedidos = [];

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
  relatorio: () => carregarRelatorio(),
  transacoes: () => carregarTransacoes()
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
const buscaClienteRelatorio = criarBuscaCliente(document.getElementById('busca-cliente-relatorio'), {
  placeholder: 'Todos os clientes...',
  onSelecionar: () => renderRelatorio()
});

async function carregarClientesParaSelects() {
  cacheClientes = await api('GET', '/clientes');
  buscaClienteVenda.definirClientes(cacheClientes);
  buscaClienteFiltroVendas.definirClientes(cacheClientes);
  buscaClienteRelatorio.definirClientes(cacheClientes);
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
const buscaProdutosRelatorio = criarMultiSelectBusca(document.getElementById('busca-produtos-relatorio'), {
  placeholder: 'Buscar produto para filtrar...',
  getTextoPesquisavel: (p) => [p.sku, p.nome, ...(p.tags || [])].join(' '),
  onAlterar: () => renderRelatorio()
});

async function carregarProdutosParaSelects() {
  cacheProdutos = await api('GET', '/produtos');
  buscaProdutosFiltroVendas.definirItens(cacheProdutos);
  buscaProdutosRelatorio.definirItens(cacheProdutos);
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

// Motor de filtro compartilhado por Vendas realizadas e Relatório — cada tela lê seus
// próprios campos e passa os critérios aqui, mas a lógica de filtragem é a mesma.
function filtrarVendasComCriterios({ clienteId, status, statusPagamento, formaPagamento, dataInicio, dataFim, produtoIds }) {
  return cacheVendas.filter(v => {
    if (clienteId && String(v.clienteId) !== clienteId) return false;
    if (status && v.status !== status) return false;
    if (statusPagamento && v.statusPagamento !== statusPagamento) return false;
    if (formaPagamento && v.formaPagamento !== formaPagamento) return false;
    if (dataInicio && v.data.slice(0, 10) < dataInicio) return false;
    if (dataFim && v.data.slice(0, 10) > dataFim) return false;
    if (produtoIds && produtoIds.length > 0 && !v.itens.some(item => produtoIds.includes(item.produtoId))) return false;
    return true;
  });
}

function filtrarVendas() {
  const form = formFiltroVendas;
  return filtrarVendasComCriterios({
    clienteId: buscaClienteFiltroVendas.obterClienteId(),
    status: form.status.value,
    statusPagamento: form.statusPagamento.value,
    formaPagamento: form.formaPagamento.value,
    dataInicio: form.dataInicio.value,
    dataFim: form.dataFim.value,
    produtoIds: buscaProdutosFiltroVendas.obterIds()
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
        <button type="button" class="secundario" onclick="location.href='venda-detalhe.html?id=${v.id}'">Ver / Editar</button>
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
  if (!confirm('Cancelar esta venda? O estoque será devolvido e, se o pagamento já tiver sido recebido, o valor deixará de contar no relatório.')) return;
  try {
    await api('POST', `/vendas/${id}/cancelar`);
    await carregarVendas();
    await carregarSkusParaSelects();
    await carregarProdutosParaSelects();
  } catch (e) { alert(e.message); }
};

window.darBaixaVenda = async function (id) {
  if (!confirm('Confirmar o recebimento desta venda? Ela passará a contar como paga hoje.')) return;
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

function calcularTotalPedido() {
  let total = 0;
  itensPedidoDiv.querySelectorAll('.item-linha').forEach(linha => {
    const preco = Number(linha.querySelector('.item-preco').value) || 0;
    const qtd = Number(linha.querySelector('.item-quantidade').value) || 0;
    total += preco * qtd;
  });
  return total;
}

function atualizarTotalPedido() {
  document.getElementById('total-pedido').textContent = formatarMoeda(calcularTotalPedido());
  renderParcelasPedido();
}

// ---------- PARCELAS DO PEDIDO ----------
// Gera automaticamente N parcelas mensais a partir da data do 1º vencimento, dividindo o
// total (ajustando centavos na última pra não perder/sobrar por arredondamento). O vencimento
// e a marcação "já paga" de cada parcela continuam editáveis depois de gerados.
preencherSelectEnum(document.getElementById('select-forma-pagamento-pedido'), FORMAS_PAGAMENTO, { comOpcaoVazia: 'Selecione (opcional)' });

function lerParcelasAtuaisPedido() {
  return Array.from(document.querySelectorAll('#parcelas-pedido .parcela-linha')).map(linha => ({
    vencimento: linha.querySelector('.parcela-vencimento').value,
    paga: linha.querySelector('.parcela-paga').checked
  }));
}

function somarMeses(dataBase, meses) {
  const d = new Date(dataBase + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + meses);
  return d.toISOString().slice(0, 10);
}

function renderParcelasPedido() {
  const total = calcularTotalPedido();
  const n = Math.max(1, Math.min(60, Number(formPedido.qtdParcelas.value) || 1));
  const primeiraData = formPedido.primeiroVencimento.value || new Date().toISOString().slice(0, 10);
  const anteriores = lerParcelasAtuaisPedido();

  const valorBase = Math.floor((total / n) * 100) / 100;
  const valores = Array.from({ length: n }, (_, i) => i < n - 1 ? valorBase : Number((total - valorBase * (n - 1)).toFixed(2)));

  document.getElementById('parcelas-pedido').innerHTML = Array.from({ length: n }, (_, i) => {
    const vencimento = anteriores[i]?.vencimento || somarMeses(primeiraData, i);
    const pagaPadrao = i === 0 && n === 1 ? (anteriores[0]?.paga ?? true) : (anteriores[i]?.paga ?? false);
    return `
      <div class="parcela-linha">
        <span class="parcela-numero">${i + 1}/${n}</span>
        <input type="date" class="parcela-vencimento" value="${vencimento}">
        <span class="parcela-valor" data-valor="${valores[i]}">${formatarMoeda(valores[i])}</span>
        <label class="parcela-paga-label"><input type="checkbox" class="parcela-paga" ${pagaPadrao ? 'checked' : ''}> Já paga</label>
      </div>
    `;
  }).join('');
}

formPedido.qtdParcelas.addEventListener('input', renderParcelasPedido);
formPedido.primeiroVencimento.addEventListener('change', renderParcelasPedido);

function definirDataPedidoParaHoje() {
  formPedido.primeiroVencimento.value = new Date().toISOString().slice(0, 10);
}
definirDataPedidoParaHoje();
renderParcelasPedido();

document.getElementById('add-item-pedido').addEventListener('click', () => {
  if (cacheSkus.length === 0) {
    alert('Cadastre ao menos um SKU antes de criar um pedido.');
    return;
  }
  novaLinhaItemPedido();
});

async function carregarPedidos() {
  cachePedidos = await api('GET', '/pedidos');
  renderPedidos();
}

function formatarPagamentoPedido(p) {
  if (p.statusPagamento === 'pago') return '<span class="badge pago">Pago</span>';
  if (p.statusPagamento === 'parcial') {
    const pagas = p.parcelas.filter(pc => pc.statusPagamento === 'pago').length;
    return `<span class="badge parcial">Parcial (${pagas}/${p.parcelas.length})</span>`;
  }
  return '<span class="badge pendente">Pendente</span>';
}

function renderPedidos() {
  const tbody = document.querySelector('#tabela-pedidos tbody');
  tbody.innerHTML = cachePedidos.map(p => `
    <tr>
      <td>#${p.id}</td>
      <td>${formatarData(p.data)}</td>
      <td>${p.fornecedorNome}</td>
      <td>${p.numeroNotaFiscal || ''}</td>
      <td>${p.formaPagamento || ''}</td>
      <td>${formatarMoeda(p.total)}</td>
      <td>${formatarPagamentoPedido(p)}</td>
      <td>${p.atualizaEstoque ? '' : '<span class="badge pendente" title="Este pedido não somou estoque">Não somado</span>'}</td>
      <td><span class="badge ${p.status}">${p.status === 'concluido' ? 'Concluído' : 'Cancelado'}</span></td>
      <td class="acoes">
        <button type="button" class="secundario" onclick="verParcelasPedido(${p.id})">Parcelas</button>
        ${p.status === 'concluido' ? `<button type="button" class="perigo" onclick="cancelarPedido(${p.id})">Cancelar</button>` : ''}
      </td>
    </tr>
  `).join('') || '<tr><td colspan="10">Nenhum pedido registrado</td></tr>';
}

window.cancelarPedido = async function (id) {
  if (!confirm('Cancelar este pedido? A entrada de estoque será revertida e as parcelas já pagas serão estornadas no caixa.')) return;
  try {
    await api('POST', `/pedidos/${id}/cancelar`);
    await carregarPedidos();
    await carregarSkusParaSelects();
    await carregarProdutosParaSelects();
  } catch (e) { alert(e.message); }
};

// ---------- MODAL DE PARCELAS DO PEDIDO ----------
const modalParcelasPedido = criarModal(document.getElementById('modal-parcelas-pedido'));
let pedidoParcelasAtualId = null;

window.verParcelasPedido = function (id) {
  pedidoParcelasAtualId = id;
  renderModalParcelasPedido();
  modalParcelasPedido.abrir();
};

function renderModalParcelasPedido() {
  const pedido = cachePedidos.find(p => p.id === pedidoParcelasAtualId);
  if (!pedido) return;
  document.getElementById('modal-parcelas-titulo').textContent = `Parcelas do Pedido #${pedido.id} — ${pedido.fornecedorNome}`;
  const tbody = document.querySelector('#tabela-modal-parcelas tbody');
  tbody.innerHTML = pedido.parcelas.map(pc => `
    <tr>
      <td>${pc.numero}/${pedido.parcelas.length}</td>
      <td>${new Date(pc.dataVencimento).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</td>
      <td>${formatarMoeda(pc.valor)}</td>
      <td>${pc.statusPagamento === 'pago'
        ? `<span class="badge pago">Pago em ${new Date(pc.dataPagamento).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</span>`
        : '<span class="badge pendente">Pendente</span>'}</td>
      <td>${pc.statusPagamento === 'pendente' && pedido.status === 'concluido'
        ? `<button type="button" onclick="darBaixaParcelaPedido(${pedido.id}, ${pc.id})">Dar baixa</button>`
        : ''}</td>
    </tr>
  `).join('');
}

window.darBaixaParcelaPedido = async function (pedidoId, parcelaId) {
  if (!confirm('Confirmar o pagamento desta parcela? Ela passará a contar como saída no caixa hoje.')) return;
  try {
    const pedidoAtualizado = await api('POST', `/pedidos/${pedidoId}/parcelas/${parcelaId}/dar-baixa`);
    const idx = cachePedidos.findIndex(p => p.id === pedidoId);
    if (idx !== -1) cachePedidos[idx] = pedidoAtualizado;
    renderModalParcelasPedido();
    renderPedidos();
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

  const linhasParcelas = document.querySelectorAll('#parcelas-pedido .parcela-linha');
  if (linhasParcelas.length === 0) { alert('Defina ao menos uma parcela'); return; }
  const parcelas = Array.from(linhasParcelas).map(linha => ({
    valor: Number(linha.querySelector('.parcela-valor').dataset.valor),
    dataVencimento: linha.querySelector('.parcela-vencimento').value,
    pago: linha.querySelector('.parcela-paga').checked
  }));
  if (parcelas.some(p => !p.dataVencimento)) { alert('Preencha o vencimento de todas as parcelas'); return; }

  try {
    await api('POST', '/pedidos', {
      fornecedorId,
      itens,
      numeroNotaFiscal: formPedido.numeroNotaFiscal.value || undefined,
      dataNotaFiscal: formPedido.dataNotaFiscal.value || undefined,
      formaPagamento: formPedido.formaPagamento.value,
      parcelas,
      atualizaEstoque: !formPedido.naoAtualizaEstoque.checked
    });
    formPedido.reset();
    buscaFornecedorPedido.limpar();
    limparItensPedido();
    definirDataPedidoParaHoje();
    atualizarTotalPedido();
    await carregarPedidos();
    await carregarSkusParaSelects();
    await carregarProdutosParaSelects();
  } catch (e) { alert(e.message); }
});

// ---------- RELATÓRIO ----------
const formFiltroRelatorio = document.getElementById('form-filtro-relatorio');

// Início do mês atual até hoje: ponto de partida útil, mas "Limpar filtros" zera pra tudo.
function definirPeriodoRelatorioPadrao() {
  const hoje = new Date();
  formFiltroRelatorio.dataInicio.value = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0, 10);
  formFiltroRelatorio.dataFim.value = hoje.toISOString().slice(0, 10);
}
definirPeriodoRelatorioPadrao();

function preencherFiltroFormaPagamentoRelatorio() {
  const select = document.querySelector('#form-filtro-relatorio select[name=formaPagamento]');
  const formasEmUso = cacheVendas.map(v => v.formaPagamento).filter(Boolean);
  const formas = [...new Set([...FORMAS_PAGAMENTO, ...formasEmUso])];
  preencherSelectEnum(select, formas, { comOpcaoVazia: 'Todas' });
}

function filtrarRelatorio() {
  const form = formFiltroRelatorio;
  return filtrarVendasComCriterios({
    clienteId: buscaClienteRelatorio.obterClienteId(),
    status: form.status.value,
    statusPagamento: form.statusPagamento.value,
    formaPagamento: form.formaPagamento.value,
    dataInicio: form.dataInicio.value,
    dataFim: form.dataFim.value,
    produtoIds: buscaProdutosRelatorio.obterIds()
  });
}

function renderRelatorio() {
  const vendasFiltradas = filtrarRelatorio();

  // O resumo financeiro considera só vendas concluídas — canceladas não geram receita nem custo,
  // mas continuam aparecendo na tabela de movimentações abaixo (com o status marcado).
  const vendasValidas = vendasFiltradas.filter(v => v.status === 'concluido');
  const totalVendas = vendasValidas.reduce((soma, v) => soma + Number(v.total), 0);
  const custoProdutosVendidos = vendasValidas.reduce(
    (soma, v) => soma + v.itens.reduce((s, item) => s + item.quantidade * item.precoUnitCusto, 0),
    0
  );
  const margemBruta = totalVendas - custoProdutosVendidos;
  const pendentes = vendasValidas.filter(v => v.statusPagamento === 'pendente');
  const totalPendente = pendentes.reduce((soma, v) => soma + Number(v.total), 0);

  document.getElementById('relatorio-resumo').innerHTML = `
    <div class="linha"><span>Vendas concluídas no período</span><span>${vendasValidas.length}</span></div>
    <div class="linha"><span>Total vendido</span><span>${formatarMoeda(totalVendas)}</span></div>
    <div class="linha"><span>(-) Custo dos produtos vendidos</span><span>${formatarMoeda(custoProdutosVendidos)}</span></div>
    <div class="linha lucro ${margemBruta >= 0 ? 'positivo' : 'negativo'}"><span>Margem bruta</span><span>${formatarMoeda(margemBruta)}</span></div>
    ${pendentes.length > 0 ? `<p class="dica">Recebimentos pendentes no período (aguardando baixa): ${formatarMoeda(totalPendente)} em ${pendentes.length} venda(s)</p>` : ''}
  `;

  const tbody = document.querySelector('#tabela-relatorio-vendas tbody');
  tbody.innerHTML = vendasFiltradas.map(v => `
    <tr>
      <td>#${v.id}</td>
      <td>${formatarData(v.data)}</td>
      <td>${v.clienteNome}</td>
      <td>${formatarMoeda(v.total)}</td>
      <td><span class="badge ${v.status}">${v.status === 'concluido' ? 'Concluído' : 'Cancelado'}</span></td>
      <td>${formatarPagamentoVenda(v)}</td>
    </tr>
  `).join('') || `<tr><td colspan="6">${cacheVendas.length === 0 ? 'Nenhuma venda registrada' : 'Nenhuma venda encontrada com os filtros selecionados'}</td></tr>`;
}

async function carregarRelatorio() {
  cacheVendas = await api('GET', '/vendas');
  preencherFiltroFormaPagamentoRelatorio();
  renderRelatorio();
}

formFiltroRelatorio.addEventListener('input', renderRelatorio);
formFiltroRelatorio.addEventListener('change', renderRelatorio);
document.getElementById('limpar-filtro-relatorio').addEventListener('click', () => {
  formFiltroRelatorio.reset();
  buscaClienteRelatorio.limpar();
  buscaProdutosRelatorio.limpar();
  renderRelatorio();
});

// ---------- TRANSAÇÕES (lançamentos manuais no caixa, ex: rendimento, taxa, saída avulsa) ----------
let cacheTransacoes = [];
const formTransacao = document.getElementById('form-transacao');

function definirDataTransacaoParaHoje() {
  formTransacao.data.value = new Date().toISOString().slice(0, 10);
}
definirDataTransacaoParaHoje();

formTransacao.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('POST', '/caixa', {
      tipo: formTransacao.tipo.value,
      categoria: formTransacao.categoria.value || undefined,
      valor: Number(formTransacao.valor.value),
      descricao: formTransacao.descricao.value || undefined,
      data: formTransacao.data.value || undefined
    });
    formTransacao.reset();
    definirDataTransacaoParaHoje();
    await carregarTransacoes();
  } catch (e) { alert(e.message); }
});

async function carregarTransacoes() {
  cacheTransacoes = await api('GET', '/caixa');
  renderTransacoes();
}

const formFiltroTransacoes = document.getElementById('form-filtro-transacoes');
formFiltroTransacoes.addEventListener('input', renderTransacoes);
formFiltroTransacoes.addEventListener('change', renderTransacoes);
document.getElementById('limpar-filtro-transacoes').addEventListener('click', () => {
  formFiltroTransacoes.reset();
  renderTransacoes();
});

function filtrarTransacoes() {
  const form = formFiltroTransacoes;
  return cacheTransacoes.filter(t => {
    if (form.tipo.value && t.tipo !== form.tipo.value) return false;
    if (form.dataInicio.value && t.data.slice(0, 10) < form.dataInicio.value) return false;
    if (form.dataFim.value && t.data.slice(0, 10) > form.dataFim.value) return false;
    return true;
  });
}

function origemTransacao(t) {
  if (t.vendaId) return `Venda #${t.vendaId}`;
  if (t.pedidoId) return `Pedido #${t.pedidoId}`;
  return 'Manual';
}

function renderTransacoes() {
  const transacoes = filtrarTransacoes();

  const entradas = transacoes.filter(t => t.tipo === 'entrada').reduce((soma, t) => soma + Number(t.valor), 0);
  const saidas = transacoes.filter(t => t.tipo === 'saida').reduce((soma, t) => soma + Number(t.valor), 0);
  const saldo = entradas - saidas;
  document.getElementById('transacoes-resumo').innerHTML = `
    <div class="linha"><span>Entradas no período</span><span>${formatarMoeda(entradas)}</span></div>
    <div class="linha"><span>Saídas no período</span><span>${formatarMoeda(saidas)}</span></div>
    <div class="linha lucro ${saldo >= 0 ? 'positivo' : 'negativo'}"><span>Saldo</span><span>${formatarMoeda(saldo)}</span></div>
  `;

  const tbody = document.querySelector('#tabela-transacoes tbody');
  tbody.innerHTML = transacoes.map(t => `
    <tr>
      <td>${formatarData(t.data)}</td>
      <td><span class="badge ${t.tipo === 'entrada' ? 'pago' : 'cancelado'}">${t.tipo === 'entrada' ? 'Entrada' : 'Saída'}</span></td>
      <td>${escaparHtml(t.categoria)}</td>
      <td>${escaparHtml(t.descricao)}</td>
      <td>${formatarMoeda(t.valor)}</td>
      <td>${origemTransacao(t)}</td>
      <td class="acoes">
        ${t.manual ? `<button type="button" class="perigo" onclick="excluirTransacao(${t.id})">Excluir</button>` : ''}
      </td>
    </tr>
  `).join('') || `<tr><td colspan="7">${cacheTransacoes.length === 0 ? 'Nenhum lançamento registrado' : 'Nenhum lançamento encontrado com os filtros selecionados'}</td></tr>`;
}

window.excluirTransacao = async function (id) {
  if (!confirm('Excluir este lançamento manual do caixa?')) return;
  try {
    await api('DELETE', `/caixa/${id}`);
    await carregarTransacoes();
  } catch (e) { alert(e.message); }
};

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
