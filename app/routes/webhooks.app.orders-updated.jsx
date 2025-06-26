import { authenticate } from "../shopify.server";
import { saveOrderLogWithRetry } from "../../db/orderLog.server";
import { atualizarObservacaoPedido, buscarIdPedido, buscarPedidoCompletoPorId, cancelarPedido } from "../services/blingPedidos.server";

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
    console.log("order:", order);

    const orderId = order.id;
    const shopifyId = order.name ?? order.order_number;
    const financialStatus = order.financial_status;
    const createdAt = new Date(order.created_at); // Data de criação do pedido
    const currentDate = new Date(); // Data atual

    // Calcular a diferença de tempo em horas
    const timeDiffMs = currentDate - createdAt;
    const timeDiffHours = timeDiffMs / (1000 * 60 * 60); // Converte para horas
    const isPixExpired = financialStatus === 'pending' && timeDiffHours > 24; // Expira após 24 horas

    console.log(`orderId: ${orderId}`);
    console.log(`Criado em: ${createdAt.toISOString()}`);
    console.log(`Tempo decorrido (horas): ${timeDiffHours.toFixed(2)}`);
    console.log(`Status financeiro: ${financialStatus}`);
    console.log(`PIX expirado: ${isPixExpired}`);

    // --- Chamada Bling ---
    const createdDateRaw = order.created_at.split("T")[0];
    const createdDate = new Date(createdDateRaw);

    // Cópia +1 dia
    const createdDatePlusOneObj = new Date(createdDate);
    createdDatePlusOneObj.setDate(createdDatePlusOneObj.getDate() + 1);
    const createdDatePlusOne = createdDatePlusOneObj.toISOString().split("T")[0];

    // Cópia -1 dia
    const createdDateMinusOneObj = new Date(createdDate);
    createdDateMinusOneObj.setDate(createdDateMinusOneObj.getDate() - 1);
    const createdDateMinusOne = createdDateMinusOneObj.toISOString().split("T")[0];

    const pedido = await buscarIdPedido(shop, createdDateMinusOne, createdDatePlusOne, orderId);
    console.log("Pedido filtrado:", pedido);
      if (pedido === undefined || pedido === null) {
        return new Response("Pedido não encontrado", { status: 404 });
      }
    // Cancela pedido expirado
    if (isPixExpired) {
      try {
        const response = await cancelarPedido(shop, pedido.id);
        console.log("Pedido cancelado com sucesso:", response);
      } catch (err) {
        console.error("Erro ao CANCELAR pedido:", err);
      }
    }

    const pedidoCompleto = await buscarPedidoCompletoPorId(shop, pedido.id);
    console.log('pedidoCompleto', pedidoCompleto);

    // Atualizar Observação
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

    const descriptionOperation = isPixExpired
      ? "Pedido cancelado automaticamente por expiração do PIX"
      : "Observação atualizada manualmente";

    // Salva o log do pedido no banco
    await saveOrderLogWithRetry({ orderId, financialStatus, createdDate, shop, descriptionOperation })
      .then((result) => {
        console.log("Pedido salvo no banco:", {
          id: result.id,
          orderId: result.orderId.toString(),
          financialStatus: result.financialStatus,
          createdDate: result.createdDate.toISOString().split("T")[0],
          shop: result.shop,
          description: result.descriptionOperation,
        });
      })
      .catch((error) => {
        console.error("Erro ao salvar pedido no banco:", error);
      });

    return new Response(`Pedido ${orderId} processado com sucesso!`, { status: 200 });
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