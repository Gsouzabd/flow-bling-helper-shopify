import { json } from "@remix-run/node";
import { sessionStorage } from "../shopify.server"; // ✅ usa a exportação correta
import { shopify } from "../shopify.api"; // instância do SDK Shopify (criada com shopifyApi)

export const action = async ({ request }) => {
  try {
    const payload = await request.json();
    const idPedidoBling = payload?.data?.id;
    if (!idPedidoBling) {
      return json({ error: "Missing idPedidoBling" }, { status: 400 });
    }
    const orderIdShopify = payload?.data?.numeroLoja;
    // const orderIdShopify = 6498155462945 // ---> Mock de desenvolvimento
    const shop = process.env.SHOPIFY_SHOP;
    const sessionId = `offline_${shop}`;
    const session = await sessionStorage.loadSession(sessionId);

    if (!session) {
      console.error("❌ Sessão não encontrada:", sessionId);
      return json({ error: "Sessão não encontrada" }, { status: 403 });
    }

    if (!session.accessToken) {
      console.error("❌ Sessão encontrada, mas sem accessToken:", session);
      return json({ error: "Sessão sem token" }, { status: 403 });
    }
      // Cria o cliente GraphQL usando a sessão válida
    const client = new shopify.clients.Graphql({ session });

    const mutation = `
      mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            key
            namespace
            value
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      metafields: [
        {
          namespace: "tracking",
          key: "codigo_de_rastreio_bling",
          type: "single_line_text_field",
          value: "BR1234567890SE",
          ownerId: `gid://shopify/Order/${orderIdShopify}`,
        },
      ],
    };

    const response = await client.query({
      data: { query: mutation, variables },
    });

    const result = response.body?.data?.metafieldsSet;

    if (!result) {
      console.error("❌ Resposta inválida da API Shopify:", response.body);
      return json({ error: "Resposta inválida da Shopify" }, { status: 500 });
    }

    if (result.userErrors?.length) {
      console.error("🧨 Erros ao criar metafield:", result.userErrors);
      return json({ success: false, errors: result.userErrors }, { status: 400 });
    }

    return json({ success: true, metafields: result.metafields });
  } catch (error) {
    console.error("❌ Erro ao processar webhook externo:", error);
    return json({ error: "Internal server error" }, { status: 500 });
  }
};
