import { sessionStorage } from "../shopify.server";
import { shopify } from "../shopify.api";
import {
  buscarPedidoCompletoPorId,
  buscarNotaFiscalPorId,
  buscarIdPedido,
  cancelarPedido,
  atualizarObservacaoPedido,
} from "./blingPedidos.server";
import { saveOrderLogWithRetry } from "../../db/orderLog.server";

const SHOPIFY_REST_VERSION = "2025-07";

/**
 * Erro transitório: o evento deve ser reagendado (retry), não falhado.
 * Ex.: o pedido ainda não foi importado no Bling (timing).
 */
export class TimingError extends Error {
  constructor(message) {
    super(message);
    this.name = "TimingError";
    this.transient = true;
  }
}

/**
 * Dispatcher: processa um WebhookEvent conforme source:topic.
 * Retorna { skipped, reason } para casos terminais não-erro;
 * lança erro (transitório ou não) para falhas que o worker tratará.
 */
export async function processWebhookEvent(event) {
  const key = `${event.source}:${event.topic}`;
  switch (key) {
    case "bling:order-updated":
      return processBlingOrderUpdated(event.shop, event.payload);
    case "shopify:orders-updated":
      return processShopifyOrderUpdated(event.shop, event.payload);
    default:
      return { skipped: true, reason: `Tipo de evento desconhecido: ${key}` };
  }
}

/**
 * Bling -> Shopify: ao atingir situação 24 (verificado) ou 9 (atendido),
 * grava metafields (rastreio + link NF) e cria o fulfillment com rastreio.
 * Migrado de app/routes/api.webhook-bling-order-updated.jsx.
 */
export async function processBlingOrderUpdated(shop, payload) {
  const idPedidoBling = payload?.data?.id;
  const orderIdShopify = payload?.data?.numeroLoja?.toString().trim();

  if (!idPedidoBling || !orderIdShopify) {
    return { skipped: true, reason: "Parâmetros inválidos" };
  }

  const sessionId = `offline_${shop}`;
  const session = await sessionStorage.loadSession(sessionId);

  if (!session || !session.accessToken) {
    return { skipped: true, reason: "Sessão inválida ou sem token" };
  }

  const pedidoCompleto = await buscarPedidoCompletoPorId(shop, idPedidoBling);
  const statusBling = pedidoCompleto.situacao?.id;
  if (statusBling != 24 && statusBling != 9) {
    return { skipped: true, reason: "Não foi verificado ou atendido" };
  }

  const codigosRastreio = pedidoCompleto.transporte?.volumes
    ?.map((v) => v.codigoRastreamento)
    .filter(Boolean);
  const codigoRastreio = codigosRastreio?.[0] || null;

  const idNotaFiscal = pedidoCompleto.notaFiscal?.id;

  const client = new shopify.clients.Graphql({ session });

  // Adiciona Metafields (Tracking e NF)
  const metafields = [];

  if (codigoRastreio) {
    metafields.push({
      namespace: "tracking",
      key: "codigo_de_rastreio_bling",
      type: "single_line_text_field",
      value: codigoRastreio,
      ownerId: `gid://shopify/Order/${orderIdShopify}`,
    });
  }

  if (idNotaFiscal) {
    const notaFiscal = await buscarNotaFiscalPorId(shop, idNotaFiscal);
    if (notaFiscal.linkPDF) {
      metafields.push({
        namespace: "tracking",
        key: "link_nota_fiscal_bling",
        type: "url",
        value: notaFiscal.linkPDF,
        ownerId: `gid://shopify/Order/${orderIdShopify}`,
      });
    }
  }

  if (metafields.length > 0) {
    const mutation = `
      mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { key namespace value }
          userErrors { field message }
        }
      }
    `;

    const res = await client.query({
      data: { query: mutation, variables: { metafields } },
    });

    if (res.body.data.metafieldsSet.userErrors.length) {
      return {
        skipped: true,
        reason: "Erro ao gravar metafields",
        errors: res.body.data.metafieldsSet.userErrors,
      };
    }
  }

  // Sem código de rastreio não há fulfillment a criar.
  if (!codigoRastreio) {
    return { ok: true, reason: "Metafields atualizados (sem rastreio)" };
  }

  // Identifica a transportadora para montar o link de rastreio
  const empresaRastreio =
    pedidoCompleto.transporte?.contato?.nome?.toLowerCase() || "";

  const linksRastreio = {
    Correios: "https://www.linkcorreios.com.br/?objeto=",
    Mandae: "https://rastreae.com.br/resultado/",
  };

  const identificarTransportadora = (nome) => {
    if (!nome) return null;
    if (nome.includes("correios")) return "Correios";
    if (nome.includes("mandae")) return "Mandae";
    return null;
  };

  const transportadoraKey = identificarTransportadora(empresaRastreio);
  let linkRastreamento = null;
  if (transportadoraKey) {
    linkRastreamento = linksRastreio[transportadoraKey] + codigoRastreio;
  }

  console.log({ empresaRastreio, linkRastreamento });

  // Buscar fulfillment_orders
  const fulfillmentOrdersRes = await fetch(
    `https://${shop}/admin/api/${SHOPIFY_REST_VERSION}/orders/${orderIdShopify}/fulfillment_orders.json`,
    {
      method: "GET",
      headers: {
        "X-Shopify-Access-Token": session.accessToken,
        "Content-Type": "application/json",
      },
    }
  );

  const fulfillmentOrdersJson = await fulfillmentOrdersRes.json();

  if (!fulfillmentOrdersRes.ok) {
    throw new Error("Erro ao buscar fulfillment_orders");
  }

  const fulfillmentOrder = fulfillmentOrdersJson.fulfillment_orders?.[0];
  if (!fulfillmentOrder) {
    return { skipped: true, reason: "Sem fulfillment_orders" };
  }

  const fulfillmentOrderId = fulfillmentOrder.id;
  const fulfillmentOrderLineItems = fulfillmentOrder.line_items
    .filter((item) => item.fulfillable_quantity > 0)
    .map((item) => ({
      id: item.id,
      quantity: item.fulfillable_quantity,
    }));

  // Idempotência: nada a cumprir significa que já foi feito antes.
  if (fulfillmentOrderLineItems.length === 0) {
    return { ok: true, reason: "Nenhum item pendente para fulfillment (já cumprido)" };
  }

  const fulfillmentPayload = {
    fulfillment: {
      message: "Pedido enviado via Bling",
      notify_customer: false,
      tracking_info: {
        number: codigoRastreio,
        company: "Clique para acompanhar a entrega do seu pedido",
        url: linkRastreamento,
      },
      line_items_by_fulfillment_order: [
        {
          fulfillment_order_id: fulfillmentOrderId,
          fulfillment_order_line_items: fulfillmentOrderLineItems,
        },
      ],
    },
  };

  const fulfillmentRes = await fetch(
    `https://${shop}/admin/api/${SHOPIFY_REST_VERSION}/fulfillments.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": session.accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(fulfillmentPayload),
    }
  );

  const fulfillmentJson = await fulfillmentRes.json();

  if (!fulfillmentRes.ok) {
    console.error("Erro ao criar fulfillment", fulfillmentJson);
    throw new Error("Erro ao criar fulfillment");
  }

  console.log("Fulfillment criado com sucesso", fulfillmentJson);
  return { ok: true, fulfillment: fulfillmentJson };
}

/**
 * Shopify -> Bling: cancela pedidos com PIX expirado (>24h pending) e
 * sobrescreve `observacoes` do pedido Bling com a referência da loja.
 * Esse overwrite é o que limpa o `note_attributes` injetado pela integração
 * nativa Bling↔Shopify — por isso precisa rodar de forma confiável.
 * Migrado de app/routes/webhooks.app.orders-updated.jsx.
 */
export async function processShopifyOrderUpdated(shop, order) {
  const orderId = order.id;
  const shopifyId = order.name ?? order.order_number;
  const financialStatus = order.financial_status;
  const createdAt = new Date(order.created_at);
  const currentDate = new Date();

  const timeDiffHours = (currentDate - createdAt) / (1000 * 60 * 60);
  const isExpired = financialStatus === "pending" && timeDiffHours > 24;

  // Janela de datas (-1 / +1 dia) para localizar o pedido no Bling
  const createdDateRaw = order.created_at.split("T")[0];
  const createdDate = new Date(createdDateRaw);

  const createdDatePlusOneObj = new Date(createdDate);
  createdDatePlusOneObj.setDate(createdDatePlusOneObj.getDate() + 1);
  const createdDatePlusOne = createdDatePlusOneObj.toISOString().split("T")[0];

  const createdDateMinusOneObj = new Date(createdDate);
  createdDateMinusOneObj.setDate(createdDateMinusOneObj.getDate() - 1);
  const createdDateMinusOne = createdDateMinusOneObj.toISOString().split("T")[0];

  const pedido = await buscarIdPedido(
    shop,
    createdDateMinusOne,
    createdDatePlusOne,
    orderId
  );

  // Timing: o pedido ainda não foi importado no Bling. Reagendar (retry),
  // NÃO desistir — é justamente o que garante que o overwrite de observacoes
  // (limpeza do note_attributes) acabe rodando.
  if (pedido === undefined || pedido === null) {
    throw new TimingError("Pedido ainda não encontrado no Bling");
  }

  // Cancela pedido com PIX expirado
  if (isExpired) {
    try {
      const response = await cancelarPedido(shop, pedido.id);
      console.log("Pedido cancelado com sucesso:", response);
    } catch (err) {
      console.error("Erro ao CANCELAR pedido:", err);
    }
  }

  const pedidoCompleto = await buscarPedidoCompletoPorId(shop, pedido.id);

  // Overwrite de observacoes — limpa o note_attributes da integração nativa.
  try {
    const response = await atualizarObservacaoPedido(
      shop,
      pedidoCompleto,
      `Referência na Loja: ${shopifyId} \n Nº Pedido Loja: ${orderId}`
    );
    console.log("Pedido Atualizado com sucesso:", response);
  } catch (err) {
    console.error("Erro ao adicionar OBSERVAÇÃO no pedido:", err);
  }

  const descriptionOperation = isExpired
    ? "Pedido cancelado automaticamente por expiração do PIX"
    : "Observação atualizada manualmente";

  await saveOrderLogWithRetry({
    orderId,
    financialStatus,
    createdDate,
    shop,
    descriptionOperation,
  }).catch((error) => {
    console.error("Erro ao salvar pedido no banco:", error);
  });

  return { ok: true, orderId: orderId.toString() };
}
