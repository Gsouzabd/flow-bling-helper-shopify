import { json } from "@remix-run/node";
import { sessionStorage } from "../shopify.server";
import { shopify } from "../shopify.api";

export const loader = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const orderId = url.searchParams.get("orderId");
    if (!orderId) {
      console.log("[get-tracking-code] orderId missing");
      return json({ success: false, error: "orderId missing" }, { status: 400 });
    }
    console.log("[get-tracking-code] orderId:", orderId);

    const shop = process.env.SHOPIFY_SHOP;
    const sessionId = `offline_${shop}`;
    const session = await sessionStorage.loadSession(sessionId);

    if (!session) {
      console.log("[get-tracking-code] Sessão não encontrada:", sessionId);
      return json({ success: false, error: "Sessão não encontrada" }, { status: 403 });
    }
    console.log("[get-tracking-code] Sessão carregada com sucesso");

    const client = new shopify.clients.Graphql({ session });

    const query = `
      query getMetafield($ownerId: ID!) {
        node(id: $ownerId) {
          ... on Order {
            metafield(namespace: "tracking", key: "codigo_de_rastreio_bling") {
              value
            }
          }
        }
      }
    `;

    const variables = {
      ownerId: `gid://shopify/Order/${orderId}`,
    };

    console.log("[get-tracking-code] Executando query GraphQL com variables:", variables);

    const response = await client.query({ data: { query, variables } });

    console.log("[get-tracking-code] Resposta da API Shopify:", JSON.stringify(response.body));

    const value = response.body.data.node?.metafield?.value || "";
    console.log("[get-tracking-code] Valor do metafield:", value);

    return json(
      { success: true, trackingCode: value },
      {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization", // Adicione Authorization aqui
        },
      }
    );
  } catch (error) {
    console.error("[get-tracking-code] Erro inesperado:", error);
    return json(
      { success: false, error: "Internal server error" },
      {
        status: 500,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      }
    );
  }
};

export const options = () => {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      
    },
  });
};
