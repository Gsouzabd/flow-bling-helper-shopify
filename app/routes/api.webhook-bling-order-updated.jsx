import { json } from "@remix-run/node";
import { enqueueWebhook } from "../../db/webhookQueue.server";
import { startWebhookWorker } from "../services/webhookWorker.server";

/**
 * Webhook recebido do Bling. Apenas valida e enfileira, respondendo 2xx
 * imediatamente — o processamento pesado (Shopify/Bling) roda no worker.
 * Isso evita estourar o timeout do webhook do Bling (que desativa o webhook
 * após muitas respostas non-2xx/lentas).
 */
export const action = async ({ request }) => {
  startWebhookWorker(); // idempotente: garante o worker ligado após deploy

  try {
    const payload = await request.json();
    const idPedidoBling = payload?.data?.id;
    const orderIdShopify = payload?.data?.numeroLoja?.toString().trim();

    if (!idPedidoBling || !orderIdShopify) {
      return json({ ok: true, ignored: true }, { status: 200 });
    }

    await enqueueWebhook({
      source: "bling",
      topic: "order-updated",
      shop: process.env.SHOPIFY_SHOP,
      payload,
      dedupeKey: `bling:order-updated:${idPedidoBling}`,
    });

    return json({ ok: true, queued: true }, { status: 200 });
  } catch (error) {
    console.error("Erro ao enfileirar webhook Bling:", error);
    // Nunca retornar non-2xx ao Bling.
    return json({ ok: true }, { status: 200 });
  }
};
