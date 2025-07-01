import { getValidBlingToken } from "../../db/blingToken.server";

/**
 * Busca pedidos no Bling por intervalo de datas (createdAt)
 * @param {string} shop - domínio/identificador da loja
 * @param {string} dataInicial - formato "YYYY-MM-DD"
 * @param {string} dataFinal - formato "YYYY-MM-DD"
 * @returns {Promise<object>} - resposta completa da API Bling
 */
export async function buscarPedidosPorData(shop, dataInicial, dataFinal) {
  const token = await getValidBlingToken(shop);

  const url = `https://bling.com.br/Api/v3/pedidos/vendas?dataInicial=${dataInicial}&dataFinal=${dataFinal}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Erro Bling: ${text}`);
  }

  const data = await res.json();

  // console.log(data)
  return data;
}

/**
 * Busca todos os pedidos e filtra um pedido específico pelo `numeroLoja` (orderId da Shopify) dentro do intervalo de datas
 * @param {string} shop
 * @param {string} dataInicial - "YYYY-MM-DD"
 * @param {string} dataFinal - "YYYY-MM-DD"
 * @param {string|number} orderId - ID da Shopify (deve ser comparado com numeroLoja)
 * @returns {Promise<object|null>}
 */
export async function buscarIdPedido(shop, dataInicial, dataFinal, orderId) {
  const pedidosData = await buscarPedidosPorData(shop, dataInicial, dataFinal);

  if (!Array.isArray(pedidosData?.data)) {
    return null;
  }

  const pedido = pedidosData.data.find(
    (p) => p.numeroLoja?.toString() === orderId.toString()
  );
  // const pedido = pedidosData.data.find(
  //   (p) => p.numeroLoja?.toString() === '6171121418461'// ----> MOCK DE DESENVOLVIMENTO
  // );

  console.log(pedido)

  return pedido || null;
}


/**
 * Busca um pedido específico pelo (orderId da bling) dentro do intervalo de datas
 * @param {string} shop
 * @param {string|number} idPedido - ID da Bling 
 * @returns {Promise<object|null>}
 */
export async function buscarPedidoCompletoPorId(shop, idPedido) {
  const token = await getValidBlingToken(shop);
  const url = `https://bling.com.br/Api/v3/pedidos/vendas/${idPedido}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Erro ao buscar pedido completo: ${text}`);
  }

  const json = await res.json();
  return json.data // estrutura típica da API Bling
}


/*
 * Cancela um pedido no Bling, alterando sua situação
 * @param {string} shop - domínio/identificador da loja
 * @param {number|string} idPedidoVenda - ID interno do pedido no Bling (campo `id`)
 * @param {number|string} idSituacao - geralmente `12 ` para "Cancelado"
 * @returns {Promise<object>} - resposta da API Bling
 */
export async function cancelarPedido(shop, idPedidoVenda, idSituacao = 12) {
  const token = await getValidBlingToken(shop);

  const url = `https://bling.com.br/Api/v3/pedidos/vendas/${idPedidoVenda}/situacoes/${idSituacao}`;

  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text(); // Bling pode retornar string de erro
    throw new Error(`Erro ao cancelar pedido no Bling: ${text}`);
  }

  // ✅ Tenta fazer .json() somente se houver corpo
  const text = await res.text();
  const data = text ? JSON.parse(text) : { status: "Pedido cancelado com sucesso" };

  return data;
}

/**
 * Adiciona ou atualiza a observação de um pedido no Bling
 * @param {string} shop - domínio/identificador da loja
 * @param {number|string} idPedidoVenda - ID interno do pedido no Bling (campo `id`)
 * @param {string} observacao - texto a ser inserido no campo "observacoes"
 * @returns {Promise<object>} - resposta da API Bling
 */
export async function atualizarObservacaoPedido(shop, pedidoCompleto, novaObservacao) {
  const token = await getValidBlingToken(shop);

  // Atualiza o campo observacoes concatenando o novo texto
  pedidoCompleto.observacoes = novaObservacao;

  const res = await fetch(`https://bling.com.br/Api/v3/pedidos/vendas/${pedidoCompleto.id}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(pedidoCompleto),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Erro ao atualizar pedido: ${text}`);
  }

  return await res.json();
}


/**
 * Busca uma nota fiscal específica no Bling pelo ID
 * @param {string} shop - domínio/identificador da loja
 * @param {string|number} idNotaFiscal - ID da nota fiscal no Bling
 * @returns {Promise<object|null>} - dados da nota fiscal
 */
export async function buscarNotaFiscalPorId(shop, idNotaFiscal) {
  const token = await getValidBlingToken(shop);

  const url = `https://bling.com.br/Api/v3/nfe/${idNotaFiscal}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Erro ao buscar nota fiscal: ${text}`);
  }

  const json = await res.json();
  return json.data; // estrutura típica da API Bling
}
