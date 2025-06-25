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
 * Busca um pedido específico pelo `numeroLoja` (orderId da Shopify) dentro do intervalo de datas
 * @param {string} shop
 * @param {string} dataInicial - "YYYY-MM-DD"
 * @param {string} dataFinal - "YYYY-MM-DD"
 * @param {string|number} orderId - ID da Shopify (deve ser comparado com numeroLoja)
 * @returns {Promise<object|null>}
 */
export async function buscarPedidoPorOrderId(shop, dataInicial, dataFinal, orderId) {
  const pedidosData = await buscarPedidosPorData(shop, dataInicial, dataFinal);

  if (!Array.isArray(pedidosData?.data)) {
    return null;
  }

  const pedido = pedidosData.data.find(
    (p) => p.numeroLoja?.toString() === orderId.toString()
  );
  // const pedido = pedidosData.data.find(
  //   (p) => p.numeroLoja?.toString() === '6169721831645'// ----> MOCK DE DESENVOLVIMENTO
  // );

  return pedido || null;
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
