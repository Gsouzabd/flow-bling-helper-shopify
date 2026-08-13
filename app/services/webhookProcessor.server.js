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

const REGEX_DIAS_UTEIS = /(\d+)\s*dias?\s*uteis?/i;

// Domínio da loja usado pelo widget de calculadora de frete (Kokfy) como
// "origin" na chamada da API. A loja não é Shopify Plus, então checkout UI
// extensions na etapa de frete não rodam — o prazo em dias úteis não fica
// salvo em nenhum campo do pedido (shipping_lines[].title só tem o nome da
// modalidade, ex.: "Sedex"). A alternativa viável é recalcular o mesmo frete
// chamando a API pública que a calculadora de frete do site já usa.
const KOKFY_STORE_DOMAIN = "woodbull.com.br";
const KOKFY_API_URL = "https://calculo-frete-produto.kokfy.com/api/carrier/shopify";

function removerAcentos(texto) {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Recalcula o prazo de entrega chamando a mesma API pública que a
 * calculadora de frete do site (Kokfy) usa, com os itens e o CEP do
 * próprio pedido. Retorna o texto (ex.: "8 dias úteis") da opção cujo
 * nome bate com a modalidade escolhida no pedido, ou null se não achar.
 */
async function buscarPrazoViaKokfy(shop, order, shippingTitle) {
  const cep = order?.shipping_address?.zip?.replace(/\D/g, "");
  if (!cep || !order?.line_items?.length) return null;

  const items = order.line_items.map((li) => ({
    id: li.variant_id,
    variant_id: li.variant_id,
    product_id: li.product_id,
    quantity: li.quantity,
    grams: li.grams,
    price: Math.round(Number(li.price) * 100),
    sku: li.sku,
  }));

  const res = await fetch(`${KOKFY_API_URL}?shop=${shop}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items, cep, shop, origin: KOKFY_STORE_DOMAIN }),
  });
  if (!res.ok) return null;

  const opcoes = await res.json();
  if (!Array.isArray(opcoes) || !opcoes.length) return null;

  const alvo = removerAcentos(shippingTitle || "").toLowerCase();
  const opcao = opcoes.find((o) => {
    const nome = removerAcentos(o.name || "").toLowerCase();
    return nome.includes(alvo) || alvo.includes(nome);
  });

  return opcao?.shipping_date || null;
}

/**
 * Grava o prazo de entrega (dias úteis) como metafield da Order.
 * Recalcula o prazo via API da calculadora de frete (Kokfy) usando os
 * dados do próprio pedido. Fallback: tenta extrair dias úteis do título
 * da modalidade de frete (shipping_lines[0].title) — que normalmente NÃO
 * tem essa informação, mas serve como último recurso caso a chamada à
 * Kokfy falhe ou não encontre a opção correspondente.
 * Chamado de forma síncrona pelo webhook orders/create — não depende do
 * Bling, então não precisa da fila de retry.
 */
export async function processShopifyOrderCreatedPrazoEntrega(shop, order) {
  const orderIdShopify = order?.id?.toString().trim();
  if (!orderIdShopify) {
    return { skipped: true, reason: "Pedido sem id" };
  }

  const shippingTitle = order?.shipping_lines?.[0]?.title;
  if (!shippingTitle) {
    return { skipped: true, reason: "Pedido sem shipping_lines" };
  }

  let prazoTexto = null;
  try {
    prazoTexto = await buscarPrazoViaKokfy(shop, order, shippingTitle);
  } catch (err) {
    console.error("Erro ao consultar prazo via Kokfy:", err);
  }

  if (!prazoTexto) {
    prazoTexto = shippingTitle;
  }

  // Deixa explícito que a contagem começa na data da compra — sem isso,
  // clientes interpretavam "X dias úteis" como a partir de hoje/da leitura
  // do e-mail, e não a partir do momento em que o pedido foi feito.
  const match = removerAcentos(prazoTexto).match(REGEX_DIAS_UTEIS);
  prazoTexto = match
    ? `${match[1]} dias úteis após a data da compra`
    : prazoTexto;

  const sessionId = `offline_${shop}`;
  const session = await sessionStorage.loadSession(sessionId);
  if (!session || !session.accessToken) {
    return { skipped: true, reason: "Sessão inválida ou sem token" };
  }

  const client = new shopify.clients.Graphql({ session });

  const mutation = `
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { key namespace value }
        userErrors { field message }
      }
    }
  `;

  const variables = {
    metafields: [
      {
        namespace: "tracking",
        key: "prazo_entrega_dias_uteis",
        type: "single_line_text_field",
        value: prazoTexto,
        ownerId: `gid://shopify/Order/${orderIdShopify}`,
      },
    ],
  };

  const res = await client.query({ data: { query: mutation, variables } });

  if (res.body.data.metafieldsSet.userErrors.length) {
    return {
      skipped: true,
      reason: "Erro ao gravar metafield de prazo de entrega",
      errors: res.body.data.metafieldsSet.userErrors,
    };
  }

  return { ok: true, reason: "Metafield de prazo de entrega gravado" };
}

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
