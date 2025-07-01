import { json } from "@remix-run/node";
import { sessionStorage } from "../shopify.server";
import { shopify } from "../shopify.api";

export const loader = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const orderId = url.searchParams.get("orderId");

    if (!orderId) {
      console.log("[get-nota-fiscal-link] orderId missing");
      return json({ success: false, error: "orderId missing" }, { status: 400 });
    }

    console.log("[get-nota-fiscal-link] orderId:", orderId);

    const shop = process.env.SHOPIFY_SHOP;
    const sessionId = `offline_${shop}`;
    const session = await sessionStorage.loadSession(sessionId);

    if (!session) {
      console.log("[get-nota-fiscal-link] Sessão não encontrada:", sessionId);
      return json({ success: false, error: "Sessão não encontrada" }, { status: 403 });
    }

    console.log("[get-nota-fiscal-link] Sessão carregada com sucesso");

    const client = new shopify.clients.Graphql({ session });

    const query = `
      query getNotaFiscalMetafield($ownerId: ID!) {
        node(id: $ownerId) {
          ... on Order {
            metafield(namespace: "tracking", key: "link_nota_fiscal_bling") {
              value
            }
          }
        }
      }
    `;

    const variables = {
      ownerId: `gid://shopify/Order/${orderId}`,
    };

    console.log("[get-nota-fiscal-link] Executando query GraphQL com variables:", variables);

    const response = await client.query({ data: { query, variables } });

    console.log("[get-nota-fiscal-link] Resposta da API Shopify:", JSON.stringify(response.body));

    const linkNotaFiscal = response.body.data.node?.metafield?.value || "";

    console.log("[get-nota-fiscal-link] Link da nota fiscal:", linkNotaFiscal);

    return json(
      { success: true, linkNotaFiscal },
      {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      }
    );
  } catch (error) {
    console.error("[get-nota-fiscal-link] Erro inesperado:", error);
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
