const API = '/api';

let cacheClientes = [];
let cacheFornecedores = [];
let cacheProdutos = [];
let cacheVendas = [];

function formatarMoeda(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarData(iso) {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

const NOMES_MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function formatarMesLabel(mes) {
  const [ano, m] = mes.split('-');
  return `${NOMES_MESES[Number(m) - 1]}/${ano}`;
}

async function api(metodo, caminho, corpo) {
  const resp = await fetch(API + caminho, {
    method: metodo,
    headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
    body: corpo ? JSON.stringify(corpo) : undefined
  });
  if (!resp.ok) {
    const erro = await resp.json().catch(() => ({ erro: 'Erro inesperado' }));
    throw new Error(erro.erro || 'Erro inesperado');
  }
  if (resp.status === 204) return null;
  return resp.json();
}

// ---------- NAVEGAÇÃO ----------
document.getElementById('nav').addEventListener('click', (e) => {
  const grupoHeader = e.target.closest('.nav-group-header');
  if (grupoHeader) {
    grupoHeader.parentElement.classList.toggle('collapsed');
    salvarGruposColapsados();
    return;
  }

  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  if (btn.dataset.tab === 'dashboard') carregarDashboard();
  if (btn.dataset.tab === 'fornecedores') carregarFornecedores();
  if (btn.dataset.tab === 'estoque') carregarEstoque();
  if (btn.dataset.tab === 'vendas') carregarVendas();
  if (btn.dataset.tab === 'pedidos') carregarPedidos();
  if (btn.dataset.tab === 'caixa') carregarCaixa();
  if (btn.dataset.tab === 'relatorio') buscarRelatorio();
});

// ---------- SIDEBAR (recolher/expandir e grupos) ----------
const sidebar = document.getElementById('sidebar');
const btnToggleSidebar = document.getElementById('toggle-sidebar');

function salvarGruposColapsados() {
  const colapsados = Array.from(document.querySelectorAll('.nav-group'))
    .filter(g => g.classList.contains('collapsed'))
    .map(g => g.dataset.group);
  localStorage.setItem('gruposColapsados', JSON.stringify(colapsados));
}

(function restaurarEstadoSidebar() {
  if (localStorage.getItem('sidebarColapsada') === 'true') {
    sidebar.classList.add('collapsed');
    btnToggleSidebar.textContent = 'Mostrar menu';
    btnToggleSidebar.setAttribute('aria-expanded', 'false');
  }
  const colapsados = JSON.parse(localStorage.getItem('gruposColapsados') || '[]');
  colapsados.forEach(nome => {
    const grupo = document.querySelector(`.nav-group[data-group="${nome}"]`);
    if (grupo) grupo.classList.add('collapsed');
  });
})();

btnToggleSidebar.addEventListener('click', () => {
  const colapsada = sidebar.classList.toggle('collapsed');
  btnToggleSidebar.textContent = colapsada ? 'Mostrar menu' : 'Ocultar menu';
  btnToggleSidebar.setAttribute('aria-expanded', String(!colapsada));
  localStorage.setItem('sidebarColapsada', String(colapsada));
});

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

// ---------- CLIENTES ----------
const formCliente = document.getElementById('form-cliente');
const btnCancelarEdicaoCliente = document.getElementById('cancelar-edicao-cliente');

async function carregarClientes() {
  cacheClientes = await api('GET', '/clientes');
  renderClientes();
  preencherSelectClientes();
}

function renderClientes() {
  const tbody = document.querySelector('#tabela-clientes tbody');
  tbody.innerHTML = cacheClientes.map(c => `
    <tr>
      <td>${c.nome}</td>
      <td>${c.telefone || ''}</td>
      <td>${c.email || ''}</td>
      <td>${c.endereco || ''}</td>
      <td class="acoes">
        <button type="button" onclick="editarCliente(${c.id})">Editar</button>
        <button type="button" class="perigo" onclick="excluirCliente(${c.id})">Excluir</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="5">Nenhum cliente cadastrado</td></tr>';
}

function preencherSelectClientes() {
  const select = document.querySelector('#form-venda select[name=clienteId]');
  select.innerHTML = '<option value="">Selecione o cliente</option>' +
    cacheClientes.map(c => `<option value="${c.id}">${c.nome}</option>`).join('');

  const selectFiltro = document.querySelector('#form-filtro-vendas select[name=clienteId]');
  const valorAtual = selectFiltro.value;
  selectFiltro.innerHTML = '<option value="">Todos os clientes</option>' +
    cacheClientes.map(c => `<option value="${c.id}">${c.nome}</option>`).join('');
  selectFiltro.value = valorAtual;
}

window.editarCliente = function (id) {
  const c = cacheClientes.find(x => x.id === id);
  formCliente.id.value = c.id;
  formCliente.nome.value = c.nome;
  formCliente.telefone.value = c.telefone;
  formCliente.email.value = c.email;
  formCliente.endereco.value = c.endereco;
  btnCancelarEdicaoCliente.style.display = 'inline-block';
};

window.excluirCliente = async function (id) {
  if (!confirm('Excluir este cliente?')) return;
  try {
    await api('DELETE', '/clientes/' + id);
    await carregarClientes();
  } catch (e) { alert(e.message); }
};

btnCancelarEdicaoCliente.addEventListener('click', () => {
  formCliente.reset();
  formCliente.id.value = '';
  btnCancelarEdicaoCliente.style.display = 'none';
});

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
    formCliente.reset();
    formCliente.id.value = '';
    btnCancelarEdicaoCliente.style.display = 'none';
    await carregarClientes();
  } catch (e) { alert(e.message); }
});

// ---------- FORNECEDORES ----------
const formFornecedor = document.getElementById('form-fornecedor');
const btnCancelarEdicaoFornecedor = document.getElementById('cancelar-edicao-fornecedor');

async function carregarFornecedores() {
  cacheFornecedores = await api('GET', '/fornecedores');
  renderFornecedores();
  preencherSelectFornecedores();
}

function renderFornecedores() {
  const tbody = document.querySelector('#tabela-fornecedores tbody');
  tbody.innerHTML = cacheFornecedores.map(f => `
    <tr>
      <td>${f.nome}</td>
      <td>${f.telefone || ''}</td>
      <td>${f.email || ''}</td>
      <td>${f.endereco || ''}</td>
      <td class="acoes">
        <button type="button" onclick="editarFornecedor(${f.id})">Editar</button>
        <button type="button" class="perigo" onclick="excluirFornecedor(${f.id})">Excluir</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="5">Nenhum fornecedor cadastrado</td></tr>';
}

function preencherSelectFornecedores() {
  const select = document.querySelector('#form-pedido select[name=fornecedorId]');
  select.innerHTML = '<option value="">Selecione o fornecedor</option>' +
    cacheFornecedores.map(f => `<option value="${f.id}">${f.nome}</option>`).join('');
}

window.editarFornecedor = function (id) {
  const f = cacheFornecedores.find(x => x.id === id);
  formFornecedor.id.value = f.id;
  formFornecedor.nome.value = f.nome;
  formFornecedor.telefone.value = f.telefone;
  formFornecedor.email.value = f.email;
  formFornecedor.endereco.value = f.endereco;
  btnCancelarEdicaoFornecedor.style.display = 'inline-block';
};

window.excluirFornecedor = async function (id) {
  if (!confirm('Excluir este fornecedor?')) return;
  try {
    await api('DELETE', '/fornecedores/' + id);
    await carregarFornecedores();
  } catch (e) { alert(e.message); }
};

btnCancelarEdicaoFornecedor.addEventListener('click', () => {
  formFornecedor.reset();
  formFornecedor.id.value = '';
  btnCancelarEdicaoFornecedor.style.display = 'none';
});

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
    formFornecedor.reset();
    formFornecedor.id.value = '';
    btnCancelarEdicaoFornecedor.style.display = 'none';
    await carregarFornecedores();
  } catch (e) { alert(e.message); }
});

// ---------- PRODUTOS ----------
const formProduto = document.getElementById('form-produto');

async function carregarProdutos() {
  cacheProdutos = await api('GET', '/produtos');
  renderProdutos();
  preencherSelectProdutoEstoque();
  preencherFiltroProdutosVenda();
}

function preencherFiltroProdutosVenda() {
  const select = document.querySelector('#form-filtro-vendas select[name=produtoIds]');
  const selecionados = new Set(Array.from(select.selectedOptions).map(o => o.value));
  select.innerHTML = cacheProdutos.map(p => `<option value="${p.id}">${p.nome}</option>`).join('');
  Array.from(select.options).forEach(o => { o.selected = selecionados.has(o.value); });
}

function renderProdutos() {
  const tbody = document.querySelector('#tabela-produtos tbody');
  tbody.innerHTML = cacheProdutos.map(p => `
    <tr>
      <td>${p.nome}</td>
      <td>${formatarMoeda(p.precoCusto)}</td>
      <td>${formatarMoeda(p.precoVenda)}</td>
      <td>${p.estoque}</td>
      <td class="acoes">
        <button type="button" class="perigo" onclick="excluirProduto(${p.id})">Excluir</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="5">Nenhum produto cadastrado</td></tr>';
}

window.excluirProduto = async function (id) {
  if (!confirm('Excluir este produto?')) return;
  try {
    await api('DELETE', '/produtos/' + id);
    await carregarProdutos();
  } catch (e) { alert(e.message); }
};

formProduto.addEventListener('submit', async (e) => {
  e.preventDefault();
  const dados = {
    nome: formProduto.nome.value,
    precoCusto: formProduto.precoCusto.value,
    precoVenda: formProduto.precoVenda.value,
    estoqueInicial: formProduto.estoqueInicial.value,
    lancarCompraNoCaixa: formProduto.lancarCompraNoCaixa.checked
  };
  try {
    await api('POST', '/produtos', dados);
    formProduto.reset();
    await carregarProdutos();
  } catch (e) { alert(e.message); }
});

// ---------- ESTOQUE ----------
const formEstoque = document.getElementById('form-estoque');

function preencherSelectProdutoEstoque() {
  const select = formEstoque.produtoId;
  select.innerHTML = cacheProdutos.map(p => `<option value="${p.id}">${p.nome} (estoque: ${p.estoque})</option>`).join('');
}

async function carregarEstoque() {
  const movimentos = await api('GET', '/estoque');
  const tbody = document.querySelector('#tabela-estoque tbody');
  tbody.innerHTML = movimentos.map(m => `
    <tr>
      <td>${formatarData(m.data)}</td>
      <td>${m.produtoNome}</td>
      <td>${m.tipo === 'entrada' ? 'Entrada' : 'Saída'}</td>
      <td>${m.quantidade}</td>
      <td>${m.motivo || ''}</td>
    </tr>
  `).join('') || '<tr><td colspan="5">Nenhuma movimentação registrada</td></tr>';
}

formEstoque.addEventListener('submit', async (e) => {
  e.preventDefault();
  const produtoId = formEstoque.produtoId.value;
  const tipo = formEstoque.tipo.value;
  const dados = {
    quantidade: formEstoque.quantidade.value,
    motivo: formEstoque.motivo.value,
    custoTotal: formEstoque.custoTotal.value || undefined
  };
  try {
    await api('POST', `/produtos/${produtoId}/${tipo}`, dados);
    formEstoque.reset();
    await carregarProdutos();
    await carregarEstoque();
  } catch (e) { alert(e.message); }
});

// ---------- VENDAS ----------
const formVenda = document.getElementById('form-venda');
const itensVendaDiv = document.getElementById('itens-venda');

function novaLinhaItemVenda() {
  const div = document.createElement('div');
  div.className = 'item-linha';
  div.innerHTML = `
    <select class="item-produto">${cacheProdutos.map(p => `<option value="${p.id}" data-preco="${p.precoVenda}" data-estoque="${p.estoque}">${p.nome} - ${formatarMoeda(p.precoVenda)} (estoque: ${p.estoque})</option>`).join('')}</select>
    <input type="number" class="item-quantidade" min="1" value="1">
    <button type="button" class="secundario remover-item">Remover</button>
  `;
  div.querySelector('.remover-item').addEventListener('click', () => {
    div.remove();
    atualizarTotalVenda();
  });
  div.querySelector('.item-produto').addEventListener('change', atualizarTotalVenda);
  div.querySelector('.item-quantidade').addEventListener('input', atualizarTotalVenda);
  itensVendaDiv.appendChild(div);
  atualizarTotalVenda();
}

function atualizarTotalVenda() {
  let total = 0;
  itensVendaDiv.querySelectorAll('.item-linha').forEach(linha => {
    const select = linha.querySelector('.item-produto');
    const opcao = select.selectedOptions[0];
    const preco = opcao ? Number(opcao.dataset.preco) : 0;
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
formVenda.statusPagamento.addEventListener('change', () => {
  campoPrevisaoPagamento.style.display = formVenda.statusPagamento.value === 'pendente' ? '' : 'none';
});

async function carregarVendas() {
  cacheVendas = await api('GET', '/vendas');
  preencherFiltroFormaPagamentoVenda();
  renderVendasFiltradas();
}

function preencherFiltroFormaPagamentoVenda() {
  const select = document.querySelector('#form-filtro-vendas select[name=formaPagamento]');
  const valorAtual = select.value;
  const formas = [...new Set(cacheVendas.map(v => v.formaPagamento).filter(Boolean))].sort();
  select.innerHTML = '<option value="">Todas</option>' + formas.map(f => `<option value="${f}">${f}</option>`).join('');
  select.value = valorAtual;
}

function filtrarVendas() {
  const form = formFiltroVendas;
  const clienteId = form.clienteId.value;
  const status = form.status.value;
  const statusPagamento = form.statusPagamento.value;
  const formaPagamento = form.formaPagamento.value;
  const dataInicio = form.dataInicio.value;
  const dataFim = form.dataFim.value;
  const produtoIds = Array.from(form.produtoIds.selectedOptions).map(o => Number(o.value));

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
  Array.from(formFiltroVendas.produtoIds.options).forEach(o => { o.selected = false; });
  renderVendasFiltradas();
});

window.cancelarVenda = async function (id) {
  if (!confirm('Cancelar esta venda? O estoque será devolvido e, se o pagamento já tiver sido recebido, o valor será estornado no caixa.')) return;
  try {
    await api('POST', `/vendas/${id}/cancelar`);
    await carregarVendas();
    await carregarProdutos();
  } catch (e) { alert(e.message); }
};

window.darBaixaVenda = async function (id) {
  if (!confirm('Confirmar o recebimento desta venda? O valor será lançado como entrada no caixa hoje.')) return;
  try {
    await api('POST', `/vendas/${id}/dar-baixa`);
    await carregarVendas();
    await carregarCaixa();
  } catch (e) { alert(e.message); }
};

formVenda.addEventListener('submit', async (e) => {
  e.preventDefault();
  const clienteId = formVenda.clienteId.value;
  if (!clienteId) { alert('Selecione um cliente'); return; }
  const linhas = itensVendaDiv.querySelectorAll('.item-linha');
  if (linhas.length === 0) { alert('Adicione ao menos um produto'); return; }

  const itens = Array.from(linhas).map(linha => ({
    produtoId: Number(linha.querySelector('.item-produto').value),
    quantidade: Number(linha.querySelector('.item-quantidade').value)
  }));

  try {
    await api('POST', '/vendas', {
      clienteId,
      itens,
      formaPagamento: formVenda.formaPagamento.value,
      statusPagamento: formVenda.statusPagamento.value,
      previsaoPagamento: formVenda.previsaoPagamento.value || undefined
    });
    formVenda.reset();
    itensVendaDiv.innerHTML = '';
    campoPrevisaoPagamento.style.display = 'none';
    atualizarTotalVenda();
    await carregarVendas();
    await carregarProdutos();
    await carregarCaixa();
  } catch (e) { alert(e.message); }
});

// ---------- PEDIDOS (compras) ----------
const formPedido = document.getElementById('form-pedido');
const itensPedidoDiv = document.getElementById('itens-pedido');

function novaLinhaItemPedido() {
  const div = document.createElement('div');
  div.className = 'item-linha';
  div.innerHTML = `
    <select class="item-produto">${cacheProdutos.map(p => `<option value="${p.id}" data-custo="${p.precoCusto}">${p.nome} (custo atual: ${formatarMoeda(p.precoCusto)})</option>`).join('')}</select>
    <input type="number" class="item-quantidade" min="1" value="1">
    <input type="number" class="item-preco" min="0" step="0.01" placeholder="Preço unitário (R$)">
    <button type="button" class="secundario remover-item">Remover</button>
  `;
  const select = div.querySelector('.item-produto');
  const inputPreco = div.querySelector('.item-preco');
  inputPreco.value = select.selectedOptions[0] ? Number(select.selectedOptions[0].dataset.custo).toFixed(2) : '0.00';
  div.querySelector('.remover-item').addEventListener('click', () => {
    div.remove();
    atualizarTotalPedido();
  });
  select.addEventListener('change', () => {
    inputPreco.value = Number(select.selectedOptions[0].dataset.custo).toFixed(2);
    atualizarTotalPedido();
  });
  inputPreco.addEventListener('input', atualizarTotalPedido);
  div.querySelector('.item-quantidade').addEventListener('input', atualizarTotalPedido);
  itensPedidoDiv.appendChild(div);
  atualizarTotalPedido();
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
  if (cacheProdutos.length === 0) {
    alert('Cadastre ao menos um produto antes de criar um pedido.');
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
    await carregarProdutos();
  } catch (e) { alert(e.message); }
};

formPedido.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fornecedorId = formPedido.fornecedorId.value;
  if (!fornecedorId) { alert('Selecione um fornecedor'); return; }
  const linhas = itensPedidoDiv.querySelectorAll('.item-linha');
  if (linhas.length === 0) { alert('Adicione ao menos um produto'); return; }

  const itens = Array.from(linhas).map(linha => ({
    produtoId: Number(linha.querySelector('.item-produto').value),
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
    itensPedidoDiv.innerHTML = '';
    atualizarTotalPedido();
    await carregarPedidos();
    await carregarProdutos();
  } catch (e) { alert(e.message); }
});

// ---------- CAIXA ----------
const formCaixa = document.getElementById('form-caixa');
const btnCancelarEdicaoCaixa = document.getElementById('cancelar-edicao-caixa');
let cacheCaixa = [];

async function carregarCaixa() {
  const dados = await api('GET', '/caixa');
  cacheCaixa = dados.lancamentos;
  document.getElementById('total-entradas').textContent = formatarMoeda(dados.totalEntradas);
  document.getElementById('total-saidas').textContent = formatarMoeda(dados.totalSaidas);
  document.getElementById('saldo-caixa').textContent = formatarMoeda(dados.saldo);

  const tbody = document.querySelector('#tabela-caixa tbody');
  tbody.innerHTML = dados.lancamentos.map(l => `
    <tr>
      <td>${formatarData(l.data)}</td>
      <td>${l.tipo === 'entrada' ? 'Entrada' : 'Saída'}</td>
      <td>${l.categoria}</td>
      <td>${l.descricao || ''}</td>
      <td>${formatarMoeda(l.valor)}</td>
      <td class="acoes">
        ${!l.vendaId && !l.pedidoId ? `
          <button type="button" onclick="editarCaixa(${l.id})">Editar</button>
          <button type="button" class="perigo" onclick="excluirCaixa(${l.id})">Excluir</button>
        ` : ''}
      </td>
    </tr>
  `).join('') || '<tr><td colspan="6">Nenhum lançamento</td></tr>';
}

window.editarCaixa = function (id) {
  const l = cacheCaixa.find(x => x.id === id);
  formCaixa.id.value = l.id;
  formCaixa.tipo.value = l.tipo;
  formCaixa.categoria.value = l.categoria;
  formCaixa.valor.value = l.valor;
  formCaixa.descricao.value = l.descricao;
  btnCancelarEdicaoCaixa.style.display = 'inline-block';
  formCaixa.scrollIntoView({ behavior: 'smooth' });
};

window.excluirCaixa = async function (id) {
  if (!confirm('Excluir este lançamento?')) return;
  try {
    await api('DELETE', '/caixa/' + id);
    await carregarCaixa();
  } catch (e) { alert(e.message); }
};

btnCancelarEdicaoCaixa.addEventListener('click', () => {
  formCaixa.reset();
  formCaixa.id.value = '';
  btnCancelarEdicaoCaixa.style.display = 'none';
});

formCaixa.addEventListener('submit', async (e) => {
  e.preventDefault();
  const dados = {
    tipo: formCaixa.tipo.value,
    categoria: formCaixa.categoria.value,
    valor: formCaixa.valor.value,
    descricao: formCaixa.descricao.value
  };
  try {
    if (formCaixa.id.value) {
      await api('PUT', '/caixa/' + formCaixa.id.value, dados);
    } else {
      await api('POST', '/caixa', dados);
    }
    formCaixa.reset();
    formCaixa.id.value = '';
    btnCancelarEdicaoCaixa.style.display = 'none';
    await carregarCaixa();
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
  await carregarClientes();
  await carregarFornecedores();
  await carregarProdutos();
  await carregarDashboard();
})();
