import { json } from "@remix-run/node";
import { sessionStorage } from "../shopify.server";
import { shopify } from "../shopify.api";

export const loader = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const orderId = url.searchParams.get("orderId");
    if (!orderId) {
      console.log("[get-prazo-entrega] orderId missing");
      return json({ success: false, error: "orderId missing" }, { status: 400 });
    }
    console.log("[get-prazo-entrega] orderId:", orderId);

    const shop = process.env.SHOPIFY_SHOP;
    const sessionId = `offline_${shop}`;
    const session = await sessionStorage.loadSession(sessionId);

    if (!session) {
      console.log("[get-prazo-entrega] Sessão não encontrada:", sessionId);
      return json({ success: false, error: "Sessão não encontrada" }, { status: 403 });
    }
    console.log("[get-prazo-entrega] Sessão carregada com sucesso");

    const client = new shopify.clients.Graphql({ session });

    const query = `
      query getMetafield($ownerId: ID!) {
        node(id: $ownerId) {
          ... on Order {
            metafield(namespace: "tracking", key: "prazo_entrega_dias_uteis") {
              value
            }
          }
        }
      }
    `;

    const variables = {
      ownerId: `gid://shopify/Order/${orderId}`,
    };

    console.log("[get-prazo-entrega] Executando query GraphQL com variables:", variables);

    const response = await client.query({ data: { query, variables } });

    console.log("[get-prazo-entrega] Resposta da API Shopify:", JSON.stringify(response.body));

    const value = response.body.data.node?.metafield?.value || "";
    console.log("[get-prazo-entrega] Valor do metafield:", value);

    return json(
      { success: true, prazoEntrega: value },
      {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      }
    );
  } catch (error) {
    console.error("[get-prazo-entrega] Erro inesperado:", error);
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
