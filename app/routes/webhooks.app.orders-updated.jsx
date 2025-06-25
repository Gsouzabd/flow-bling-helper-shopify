import { authenticate } from "../shopify.server";
import { prisma } from "../../db/prisma.server";  // caminho correto para seu prisma.client

import { getValidBlingToken } from "../../db/blingToken.server";
import { saveOrderLog, saveOrderLogWithRetry } from "../../db/orderLog.server";
import { buscarPedidosPorData, buscarPedidoPorOrderId, cancelarPedido } from "../services/blingPedidos.server";

export const action = async ({ request }) => {
  try {
    // Leia o corpo como texto
    const bodyText = await request.text();
    const shop = request.headers.get("x-shopify-shop-domain");

    // Valide o webhook
    await authenticate.webhook(
      new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: bodyText,
      })
    );

    // Parse do order JSON
    const order = JSON.parse(bodyText);

    console.log("Webhook validado ✅");
    // console.log("order:", order);

    const orderId = order.id;
    const financialStatus = order.financial_status;
    const createdDateRaw = order.created_at.split("T")[0];
    const createdDate = new Date(createdDateRaw);

    // ✅ Cópia +1 dia
    const createdDatePlusOneObj = new Date(createdDate);
    createdDatePlusOneObj.setDate(createdDatePlusOneObj.getDate() + 1);
    const createdDatePlusOne = createdDatePlusOneObj.toISOString().split("T")[0];

    // ✅ Cópia -1 dia
    const createdDateMinusOneObj = new Date(createdDate);
    createdDateMinusOneObj.setDate(createdDateMinusOneObj.getDate() - 1);
    const createdDateMinusOne = createdDateMinusOneObj.toISOString().split("T")[0];

    console.log(`orderId: ${orderId}`);
    console.log(`Criado em: ${createdDate.toISOString().split("T")[0]}`);
    console.log(`+1 dia: ${createdDatePlusOne}`);
    console.log(`-1 dia: ${createdDateMinusOne}`);
    console.log(`Status financeiro: ${financialStatus}`);

    // console.log(Object.keys(prisma)); 



    if(financialStatus != 'expired') { return new Response(`Pedido ${orderId} nao está expirado.`, { status: 200 }) ;}
    // --- Chamada Bling ---
    const pedido = await buscarPedidoPorOrderId(shop, createdDateMinusOne, createdDatePlusOne, orderId);
    console.log("Pedido filtrado:", pedido);

    try {
      const response = await cancelarPedido(
        "flowdigital.myshopify.com",   // shop
        pedido.id                    // id do pedido no Bling (campo `id`)
      );
      await saveOrderLogWithRetry({ orderId, financialStatus, createdDate, shop })
        .then((result) => {
          console.log("Pedido salvo no banco:", {
            id: result.id,
            orderId: result.orderId.toString(),
            financialStatus: result.financialStatus,
            createdDate: result.createdDate.toISOString().split("T")[0],
            shop: result.shop,
          });
        })
        .catch((error) => {
          console.error("Erro ao salvar pedido no banco:", error);
        });
      console.log("Pedido cancelado com sucesso:", response);
    } catch (err) {
      console.error("Erro ao cancelar pedido:", err);
    }

    return new Response(`Pedido ${orderId} cancelado com sucesso na BLING!`, { status: 200 });
  } catch (error) {
    console.error("Erro no webhook:", error);

    return new Response(
      JSON.stringify({
        error: {
          message: error.message || "Erro desconhecido",
          name: error.name || "Tipo de erro desconhecido",
          stack: error.stack || "Sem stack trace disponível",
        },
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};
