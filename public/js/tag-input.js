// Campo de tags (chips): digite e pressione Enter ou vírgula para adicionar.
// Uso: const campo = criarCampoTags(container, ['tag1', 'tag2']);
//      campo.obterTags() / campo.definirTags(['a', 'b'])

function criarCampoTags(container, tagsIniciais = []) {
  container.classList.add('tag-input');
  container.innerHTML = `
    <div class="tag-input-chips"></div>
    <input type="text" class="tag-input-campo" placeholder="Digite uma tag e pressione Enter (ex: virilha)">
  `;

  const chipsEl = container.querySelector('.tag-input-chips');
  const inputEl = container.querySelector('.tag-input-campo');
  let tags = [];

  function renderizar() {
    chipsEl.innerHTML = tags.map((t, i) => `
      <span class="tag-chip">${escaparHtml(t)}<button type="button" class="tag-chip-remover" data-indice="${i}" aria-label="Remover tag ${escaparHtml(t)}">×</button></span>
    `).join('');
  }

  function adicionar(texto) {
    const valor = texto.trim();
    inputEl.value = '';
    if (!valor) return;
    if (tags.some(t => t.toLowerCase() === valor.toLowerCase())) return;
    tags.push(valor);
    renderizar();
  }

  function definirTags(lista) {
    tags = (lista || []).map(t => String(t).trim()).filter(Boolean);
    renderizar();
  }

  chipsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.tag-chip-remover');
    if (!btn) return;
    tags.splice(Number(btn.dataset.indice), 1);
    renderizar();
  });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      adicionar(inputEl.value);
    } else if (e.key === 'Backspace' && inputEl.value === '' && tags.length > 0) {
      tags.pop();
      renderizar();
    }
  });

  inputEl.addEventListener('blur', () => {
    if (inputEl.value.trim()) adicionar(inputEl.value);
  });

  definirTags(tagsIniciais);

  return {
    obterTags: () => tags.slice(),
    definirTags
  };
}
