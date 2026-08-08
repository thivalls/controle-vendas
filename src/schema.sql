CREATE TABLE IF NOT EXISTS clientes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  telefone VARCHAR(50) NOT NULL DEFAULT '',
  email VARCHAR(255) NOT NULL DEFAULT '',
  endereco VARCHAR(500) NOT NULL DEFAULT '',
  criado_em DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fornecedores (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  telefone VARCHAR(50) NOT NULL DEFAULT '',
  email VARCHAR(255) NOT NULL DEFAULT '',
  endereco VARCHAR(500) NOT NULL DEFAULT '',
  criado_em DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- SKU é a unidade física de estoque (o que se compra e se conta no depósito).
-- Existe independente de produto: dá pra cadastrar um SKU que só vai ser usado
-- como componente de kit, sem precisar virar um produto vendável por si só.
CREATE TABLE IF NOT EXISTS skus (
  id INT AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(50) NULL,
  nome VARCHAR(255) NOT NULL,
  preco_custo DECIMAL(10,2) NOT NULL DEFAULT 0,
  estoque INT NOT NULL DEFAULT 0,
  criado_em DATETIME NOT NULL,
  UNIQUE KEY uq_skus_codigo (codigo),
  UNIQUE KEY uq_skus_nome (nome)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Produto é o que aparece pra venda (nome, preço de venda, imagem, tags).
-- tipo 'simples': vendável 1:1 com um único SKU (produto_skus tem 1 linha, quantidade 1).
-- tipo 'kit': agrupa 2+ SKUs (via produto_skus); custo e estoque disponível do produto
-- são sempre calculados a partir dos SKUs que o compõem, nunca armazenados aqui.
CREATE TABLE IF NOT EXISTS produtos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tipo ENUM('simples', 'kit') NOT NULL DEFAULT 'simples',
  nome VARCHAR(255) NOT NULL,
  preco_venda DECIMAL(10,2) NOT NULL,
  imagem VARCHAR(255) NULL,
  tags VARCHAR(500) NOT NULL DEFAULT '',
  criado_em DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Composição de um produto: quais SKUs (e em que quantidade) formam o produto.
-- Produto simples tem exatamente 1 linha aqui (quantidade 1); kit tem 2 ou mais.
CREATE TABLE IF NOT EXISTS produto_skus (
  id INT AUTO_INCREMENT PRIMARY KEY,
  produto_id INT NOT NULL,
  sku_id INT NOT NULL,
  quantidade INT NOT NULL DEFAULT 1,
  FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE,
  FOREIGN KEY (sku_id) REFERENCES skus(id),
  UNIQUE KEY uq_produto_sku (produto_id, sku_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS vendas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cliente_id INT NOT NULL,
  data DATETIME NOT NULL,
  status ENUM('concluido', 'cancelado') NOT NULL DEFAULT 'concluido',
  forma_pagamento VARCHAR(100) NOT NULL DEFAULT '',
  observacoes TEXT,
  total DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (cliente_id) REFERENCES clientes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Registra o que foi vendido comercialmente (o produto, simples ou kit). A baixa de
-- estoque de verdade acontece nos SKUs que compõem o produto (ver movimentos_estoque).
CREATE TABLE IF NOT EXISTS venda_itens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  venda_id INT NOT NULL,
  produto_id INT NOT NULL,
  quantidade INT NOT NULL,
  preco_unit_venda DECIMAL(10,2) NOT NULL,
  preco_unit_custo DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (venda_id) REFERENCES vendas(id) ON DELETE CASCADE,
  FOREIGN KEY (produto_id) REFERENCES produtos(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Pedido de compra: entrada de mercadoria de um fornecedor (nota fiscal opcional).
-- Compra-se SKU (a unidade física), nunca um produto do tipo kit.
CREATE TABLE IF NOT EXISTS pedidos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  fornecedor_id INT NOT NULL,
  data DATETIME NOT NULL,
  status ENUM('concluido', 'cancelado') NOT NULL DEFAULT 'concluido',
  numero_nota_fiscal VARCHAR(100) NULL,
  data_nota_fiscal DATE NULL,
  observacoes TEXT,
  total DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (fornecedor_id) REFERENCES fornecedores(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS pedido_itens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pedido_id INT NOT NULL,
  sku_id INT NOT NULL,
  quantidade INT NOT NULL,
  preco_unit_custo DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
  FOREIGN KEY (sku_id) REFERENCES skus(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Movimentação real de estoque: sempre no nível do SKU (a unidade física), nunca do produto.
CREATE TABLE IF NOT EXISTS movimentos_estoque (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sku_id INT NOT NULL,
  tipo ENUM('entrada', 'saida') NOT NULL,
  quantidade INT NOT NULL,
  motivo VARCHAR(255) NOT NULL DEFAULT '',
  data DATETIME NOT NULL,
  venda_id INT NULL,
  pedido_id INT NULL,
  FOREIGN KEY (sku_id) REFERENCES skus(id) ON DELETE CASCADE,
  FOREIGN KEY (venda_id) REFERENCES vendas(id) ON DELETE SET NULL,
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS caixa (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tipo ENUM('entrada', 'saida') NOT NULL,
  categoria VARCHAR(255) NOT NULL DEFAULT 'Outros',
  valor DECIMAL(10,2) NOT NULL,
  descricao VARCHAR(500) NOT NULL DEFAULT '',
  data DATETIME NOT NULL,
  venda_id INT NULL,
  pedido_id INT NULL,
  FOREIGN KEY (venda_id) REFERENCES vendas(id) ON DELETE SET NULL,
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
