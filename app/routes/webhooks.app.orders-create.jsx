import { authenticate } from "../shopify.server";
import { processShopifyOrderCreatedPrazoEntrega } from "../services/webhookProcessor.server";

/**
 * Webhook orders/create do Shopify. Valida o HMAC e grava, de forma
 * síncrona (sem fila), o metafield de prazo de entrega a partir do
 * shipping_lines[0].title. Não chama o Bling, então não precisa do
 * tratamento de retry/timing usado em orders/updated — responde 200
 * rápido para não gerar retries desnecessários.
 */
export const action = async ({ request }) => {
  try {
    const bodyText = await request.text();
    const shop = request.headers.get("x-shopify-shop-domain");

    await authenticate.webhook(
      new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: bodyText,
      })
    );

    const order = JSON.parse(bodyText);

    try {
      await processShopifyOrderCreatedPrazoEntrega(shop, order);
    } catch (err) {
      console.error("Erro ao gravar prazo de entrega (orders/create):", err);
    }

    return new Response("ok", { status: 200 });
  } catch (error) {
    console.error("Erro ao processar webhook Shopify orders/create:", error);
    return new Response("Webhook inválido", { status: 401 });
  }
};
