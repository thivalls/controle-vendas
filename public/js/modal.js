// Modal simples: mostra/esconde um overlay já existente no HTML. Fecha ao clicar fora da
// caixa, em qualquer elemento com a classe .modal-fechar dentro dele, ou pressionando Esc.
// Uso: const modal = criarModal(document.getElementById('modal-novo-cliente'));
//      modal.abrir(); modal.fechar();

function criarModal(overlayEl) {
  function fechar() {
    overlayEl.hidden = true;
  }

  function abrir() {
    overlayEl.hidden = false;
  }

  overlayEl.addEventListener('click', (e) => {
    if (e.target === overlayEl) fechar();
  });

  overlayEl.querySelectorAll('.modal-fechar').forEach(btn => btn.addEventListener('click', fechar));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlayEl.hidden) fechar();
  });

  return { abrir, fechar };
}
