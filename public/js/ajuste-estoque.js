const formUpload = document.getElementById('form-upload-estoque');
const inputArquivo = document.getElementById('input-arquivo-estoque');
const painelPrevia = document.getElementById('painel-previa-estoque');
const painelResultado = document.getElementById('painel-resultado-estoque');
const resumoPreviaEl = document.getElementById('resumo-previa-estoque');
const tabelaPreviaBody = document.querySelector('#tabela-previa-estoque tbody');
const btnConfirmar = document.getElementById('btn-confirmar-ajustes');
const btnNovoAjuste = document.getElementById('btn-novo-ajuste');
const resumoResultadoEl = document.getElementById('resumo-resultado-estoque');
const tabelaResultadoBody = document.querySelector('#tabela-resultado-estoque tbody');

let previaAtual = null;

// Ordem de exibição: o que precisa de atenção (entrada/saída) primeiro, o resto depois.
const ORDEM_CLASSIFICACAO = ['entrada', 'saida', 'sem_alteracao', 'ignorado_valor_invalido', 'ignorado_nao_contado', 'ignorado_sku_nao_encontrado'];

const CLASSIFICACAO_INFO = {
  entrada: { rotulo: 'Entrada', badge: 'pago' },
  saida: { rotulo: 'Saída', badge: 'cancelado' },
  sem_alteracao: { rotulo: 'Sem alteração' },
  ignorado_nao_contado: { rotulo: 'Não contado' },
  ignorado_sku_nao_encontrado: { rotulo: 'SKU não encontrado' },
  ignorado_valor_invalido: { rotulo: 'Valor inválido' }
};

formUpload.addEventListener('submit', async (e) => {
  e.preventDefault();
  const arquivo = inputArquivo.files[0];
  if (!arquivo) { alert('Selecione um arquivo .xlsx'); return; }

  const dados = new FormData();
  dados.append('arquivo', arquivo);

  painelResultado.hidden = true;
  try {
    previaAtual = await api('POST', '/skus/importar-estoque', dados);
    renderizarPrevia();
  } catch (err) {
    alert(err.message);
  }
});

function renderizarPrevia() {
  const { linhas, resumo } = previaAtual;
  resumoPreviaEl.textContent =
    `${resumo.aAjustar} para ajustar · ${resumo.semAlteracao} sem alteração · ${resumo.ignorados} ignorados (de ${resumo.totalLinhas} linhas na planilha)`;

  const linhasOrdenadas = [...linhas].sort(
    (a, b) => ORDEM_CLASSIFICACAO.indexOf(a.classificacao) - ORDEM_CLASSIFICACAO.indexOf(b.classificacao)
  );

  tabelaPreviaBody.innerHTML = linhasOrdenadas.map(linhaPreviaHtml).join('')
    || '<tr><td colspan="6" class="tabela-vazio">Nenhuma linha encontrada na planilha</td></tr>';

  painelPrevia.hidden = false;
  btnConfirmar.disabled = resumo.aAjustar === 0;
  painelPrevia.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function linhaPreviaHtml(l) {
  const info = CLASSIFICACAO_INFO[l.classificacao];
  const destaque = l.classificacao === 'entrada' || l.classificacao === 'saida';
  return `
    <tr class="${destaque ? '' : 'linha-discreta'}">
      <td>${l.skuId ?? '—'}</td>
      <td>${escaparHtml(l.codigo || '')}</td>
      <td>${escaparHtml(l.nome || '(SKU não encontrado)')}</td>
      <td>${l.estoqueSistema ?? '—'}</td>
      <td>${l.estoqueReal ?? '—'}</td>
      <td>${info.badge ? `<span class="badge ${info.badge}">${info.rotulo}</span>` : escaparHtml(info.rotulo)}</td>
    </tr>
  `;
}

btnConfirmar.addEventListener('click', async () => {
  if (!previaAtual) return;
  const linhasParaAplicar = previaAtual.linhas
    .filter(l => l.classificacao === 'entrada' || l.classificacao === 'saida')
    .map(l => ({ skuId: l.skuId, estoqueReal: l.estoqueReal }));
  if (linhasParaAplicar.length === 0) return;

  btnConfirmar.disabled = true;
  btnConfirmar.textContent = 'Aplicando...';
  try {
    const resultado = await api('POST', '/skus/importar-estoque/aplicar', { linhas: linhasParaAplicar });
    renderizarResultado(resultado);
  } catch (err) {
    alert(err.message);
  } finally {
    btnConfirmar.disabled = false;
    btnConfirmar.textContent = 'Confirmar ajustes';
  }
});

function renderizarResultado(resultado) {
  const { aplicados, ignorados } = resultado;
  resumoResultadoEl.textContent = ignorados.length
    ? `${aplicados.length} SKU(s) ajustado(s) · ${ignorados.length} ignorado(s)`
    : `${aplicados.length} SKU(s) ajustado(s) com sucesso`;

  const linhasAplicadas = aplicados.map(a => `
    <tr>
      <td>${a.skuId}</td>
      <td>${escaparHtml(a.nome)}</td>
      <td>${a.estoqueAntes}</td>
      <td>${a.estoqueDepois}</td>
      <td><span class="badge ${a.tipo === 'entrada' ? 'pago' : 'cancelado'}">${a.tipo === 'entrada' ? 'Entrada' : 'Saída'} de ${a.quantidade}</span></td>
    </tr>
  `).join('');

  const linhasIgnoradas = ignorados.map(i => `
    <tr class="linha-discreta">
      <td>${i.skuId ?? '—'}</td>
      <td colspan="4">${escaparHtml(i.motivo)}</td>
    </tr>
  `).join('');

  tabelaResultadoBody.innerHTML = (linhasAplicadas + linhasIgnoradas)
    || '<tr><td colspan="5" class="tabela-vazio">Nada foi aplicado</td></tr>';

  painelPrevia.hidden = true;
  painelResultado.hidden = false;
  painelResultado.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

btnNovoAjuste.addEventListener('click', () => {
  previaAtual = null;
  formUpload.reset();
  painelPrevia.hidden = true;
  painelResultado.hidden = true;
  tabelaPreviaBody.innerHTML = '';
  tabelaResultadoBody.innerHTML = '';
  btnConfirmar.disabled = true;
});

initSidebar('skus');
