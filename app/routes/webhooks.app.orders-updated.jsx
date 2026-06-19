import { authenticate } from "../shopify.server";
import { enqueueWebhook } from "../../db/webhookQueue.server";
import { startWebhookWorker } from "../services/webhookWorker.server";

/**
 * Webhook orders/updated do Shopify. Valida o HMAC, enfileira e responde 200.
 * O processamento (localizar pedido no Bling, cancelar PIX expirado e
 * sobrescrever `observacoes` — que limpa o note_attributes) roda no worker,
 * com retry por timing quando o pedido ainda não foi importado no Bling.
 */
export const action = async ({ request }) => {
  startWebhookWorker(); // idempotente: garante o worker ligado após deploy

  try {
    const bodyText = await request.text();
    const shop = request.headers.get("x-shopify-shop-domain");

    // Valida o webhook (HMAC). Se inválido, lança e cai no catch -> 401.
    await authenticate.webhook(
      new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: bodyText,
      })
    );

    const order = JSON.parse(bodyText);

    // Atraso inicial de 60s: dá tempo da integração nativa Bling↔Shopify
    // importar o pedido antes de tentarmos sobrescrever observacoes.
    await enqueueWebhook({
      source: "shopify",
      topic: "orders-updated",
      shop,
      payload: order,
      dedupeKey: `shopify:orders-updated:${order.id}`,
      nextRetryAt: new Date(Date.now() + 60000),
    });

    return new Response("queued", { status: 200 });
  } catch (error) {
    console.error("Erro ao enfileirar webhook Shopify:", error);
    // HMAC inválido (webhook não autêntico) -> 401; não enfileira.
    return new Response("Webhook inválido", { status: 401 });
  }
};
