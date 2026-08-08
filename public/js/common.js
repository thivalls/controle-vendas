const API = '/api';

function formatarMoeda(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarData(iso) {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function escaparHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}

async function api(metodo, caminho, corpo) {
  const ehFormData = corpo instanceof FormData;
  const resp = await fetch(API + caminho, {
    method: metodo,
    headers: corpo && !ehFormData ? { 'Content-Type': 'application/json' } : undefined,
    body: corpo ? (ehFormData ? corpo : JSON.stringify(corpo)) : undefined
  });
  if (!resp.ok) {
    const erro = await resp.json().catch(() => ({ erro: 'Erro inesperado' }));
    throw new Error(erro.erro || 'Erro inesperado');
  }
  if (resp.status === 204) return null;
  return resp.json();
}

// Fonte única da navegação: cada item aponta para a página real que o atende hoje.
// Itens que ainda vivem como aba dentro de index.html (sem página própria) apontam para 'index.html';
// o próprio index.html decide, ao clicar, se troca de aba (quando a aba existe nele) ou navega de verdade.
const NAV_CONFIG = [
  { grupo: 'Início', chave: 'inicio', itens: [
    { chave: 'dashboard', rotulo: 'Dashboard', href: 'index.html#dashboard' }
  ]},
  { grupo: 'Cadastros', chave: 'cadastros', itens: [
    { chave: 'clientes', rotulo: 'Clientes', href: 'clientes.html' },
    { chave: 'fornecedores', rotulo: 'Fornecedores', href: 'fornecedores.html' },
    { chave: 'produtos', rotulo: 'Produtos', href: 'produtos.html', badge: true },
    { chave: 'skus', rotulo: 'SKUs', href: 'skus.html' }
  ]},
  { grupo: 'Operações', chave: 'operacoes', itens: [
    { chave: 'estoque', rotulo: 'Estoque', href: 'index.html#estoque' },
    { chave: 'vendas', rotulo: 'Vendas', href: 'index.html#vendas' },
    { chave: 'pedidos', rotulo: 'Pedidos', href: 'index.html#pedidos' }
  ]},
  { grupo: 'Financeiro', chave: 'financeiro', itens: [
    { chave: 'caixa', rotulo: 'Fluxo de Caixa', href: 'caixa.html' },
    { chave: 'relatorio', rotulo: 'Relatório Mensal', href: 'index.html#relatorio' }
  ]}
];

function destacarItemNav(chave) {
  document.querySelectorAll('#nav .tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === chave);
  });
}

function initSidebar(chaveAtiva) {
  const nav = document.getElementById('nav');
  nav.innerHTML = NAV_CONFIG.map(grupo => `
    <div class="nav-group" data-group="${grupo.chave}">
      <button type="button" class="nav-group-header">${grupo.grupo}</button>
      <div class="nav-group-items">
        ${grupo.itens.map(item => `<a href="${item.href}" data-tab="${item.chave}" class="tab-btn">${item.rotulo}${item.badge ? `<span class="tab-btn-badge" id="badge-nav-${item.chave}"></span>` : ''}</a>`).join('')}
      </div>
    </div>
  `).join('');
  destacarItemNav(chaveAtiva);

  const sidebar = document.getElementById('sidebar');
  const btnToggleSidebar = document.getElementById('toggle-sidebar');

  function salvarGruposColapsados() {
    const colapsados = Array.from(document.querySelectorAll('.nav-group'))
      .filter(g => g.classList.contains('collapsed'))
      .map(g => g.dataset.group);
    localStorage.setItem('gruposColapsados', JSON.stringify(colapsados));
  }

  if (localStorage.getItem('sidebarColapsada') === 'true') {
    sidebar.classList.add('collapsed');
    btnToggleSidebar.textContent = 'Mostrar menu';
    btnToggleSidebar.setAttribute('aria-expanded', 'false');
  }
  const colapsados = JSON.parse(localStorage.getItem('gruposColapsados') || '[]');
  colapsados.forEach(nome => {
    const grupo = nav.querySelector(`.nav-group[data-group="${nome}"]`);
    if (grupo) grupo.classList.add('collapsed');
  });

  btnToggleSidebar.addEventListener('click', () => {
    const colapsada = sidebar.classList.toggle('collapsed');
    btnToggleSidebar.textContent = colapsada ? 'Mostrar menu' : 'Ocultar menu';
    btnToggleSidebar.setAttribute('aria-expanded', String(!colapsada));
    localStorage.setItem('sidebarColapsada', String(colapsada));
  });

  nav.addEventListener('click', (e) => {
    const grupoHeader = e.target.closest('.nav-group-header');
    if (grupoHeader) {
      grupoHeader.parentElement.classList.toggle('collapsed');
      salvarGruposColapsados();
    }
  });

  atualizarBadgesNav();
}

// Badges numéricos no menu lateral (ex: quantidade de produtos cadastrados). Roda em toda
// página, já que o menu lateral aparece em todas — falha silenciosamente se a API não
// responder, pra não travar a navegação por causa de um indicador visual.
async function atualizarBadgesNav() {
  const badgeProdutos = document.getElementById('badge-nav-produtos');
  if (badgeProdutos) {
    try {
      const produtos = await api('GET', '/produtos');
      badgeProdutos.textContent = produtos.length;
    } catch {
      badgeProdutos.hidden = true;
    }
  }
}
