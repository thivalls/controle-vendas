// Enums usados em selects do sistema (valores fixos, não vêm do banco).
// Cada enum é uma lista de strings (quando valor e rótulo são iguais) ou de
// objetos { value, label } (quando o valor salvo difere do texto exibido).

// Formas de pagamento aceitas nas vendas — inclui as que já eram usadas como
// texto livre no sistema (Pix, dinheiro, cartão) mais as demais mais comuns.
const FORMAS_PAGAMENTO = ['Pix', 'Dinheiro', 'Cartão de crédito', 'Cartão de débito', 'Boleto', 'Transferência', 'Outros'];
