import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  try {
    // Leia o corpo como texto
    const bodyText = await request.text();

    // Valide o webhook
    await authenticate.webhook(
      new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: bodyText,
      })
    );

    // Parse do payload JSON
    const payload = JSON.parse(bodyText);

    console.log("Webhook validado ✅");
    console.log("Payload:", payload);

    // Aqui você verifica o financial_status do pedido
    const financialStatus = payload.financial_status;

    if (financialStatus === "expired") {
      console.log("Pedido com pagamento expirado detected!");

    } else {
      console.log(`Status financeiro: ${financialStatus}`);
    }

    return new Response("Webhook processado", { status: 200 });
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
