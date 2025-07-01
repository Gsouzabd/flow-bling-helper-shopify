import { json } from "@remix-run/node";
import { sessionStorage } from "../shopify.server"; // ✅ usa a exportação correta
import { shopify } from "../shopify.api"; // instância do SDK Shopify (criada com shopifyApi)
import {buscarPedidoCompletoPorId, buscarNotaFiscalPorId } from "../services/blingPedidos.server";

export const action = async ({ request }) => {
  try {
    const payload = await request.json();
    const idPedidoBling = payload?.data?.id;
    if (!idPedidoBling) {
      return json({ error: "Missing idPedidoBling" }, { status: 400 });
    }
    console.log('idPedidoBling',idPedidoBling)
    const orderIdShopify = payload?.data?.numeroLoja;
    if (!orderIdShopify) {
      return json({ error: "Missing orderIdShopify" }, { status: 400 });
    }
        console.log('orderIdShopify',orderIdShopify)



    // const orderIdShopify = 6498155462945 // ---> Mock de desenvolvimento
    const shop = process.env.SHOPIFY_SHOP;

    const pedidoCompleto = await buscarPedidoCompletoPorId(shop, idPedidoBling);

    //Buscando codigo rastreio ?
    const codigosRastreio = pedidoCompleto.transporte?.volumes?.map(v => v.codigoRastreamento).filter(Boolean);
    const codigoRastreio = codigosRastreio?.[0] || null;

    //Buscando id nota fiscal
    const idNotaFiscal = pedidoCompleto.notaFiscal?.id;


    if(!codigoRastreio && !idNotaFiscal){
      console.log("🧨 Nao há codigoRastreio ou idNota Fiscal:");
      return json({ success: true, error: "Nao há codigoRastreio ou idNota Fiscal:"}, { status: 422 });
    }

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
    const orderRest = await fetch(
      `https://${shop}/admin/api/2025-07/orders/${orderIdShopify}.json`,
      {
        method: "GET",
        headers: {
          "X-Shopify-Access-Token": session.accessToken,
          "Content-Type": "application/json",
        },
      }
    );

    const orderJson = await orderRest.json();
    const orderGID = orderJson.order?.admin_graphql_api_id;

    if (!orderGID) {
      console.error("❌ Não foi possível obter o GID do pedido:", orderJson);
      return json({ error: "Pedido não encontrado ou GID ausente" }, { status: 404 });
    }
    let mutation;
    let variables = {
      metafields: [],
    };

    // 1. Adiciona código de rastreio, se existir
    if (codigoRastreio) {
      console.log("codigoRastreio: ", codigoRastreio);
      variables.metafields.push({
        namespace: "tracking",
        key: "codigo_de_rastreio_bling",
        type: "single_line_text_field",
        value: codigoRastreio,
        ownerId: `gid://shopify/Order/${orderIdShopify}`,
      });
    }

    // 2. Adiciona link da nota fiscal, se existir
    if (idNotaFiscal) {
      const notaFiscal = await buscarNotaFiscalPorId(shop, idNotaFiscal);
      const linkNotaFiscal = notaFiscal.linkPDF;

      if (linkNotaFiscal) {
        console.log("link nota fiscal: ", linkNotaFiscal);
        variables.metafields.push({
          namespace: "tracking",
          key: "link_nota_fiscal_bling",
          type: "url",
          value: linkNotaFiscal,
          ownerId: `gid://shopify/Order/${orderIdShopify}`,
        });
      }
    }

    // 3. Só executa se houver algo para salvar
    if (variables.metafields.length > 0) {
      mutation = `
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
    }

    // 4. Se nada foi salvo
    return json({ success: false, error: "Nenhum dado para salvar" }, { status: 204 });

  } catch (error) {
    console.error("❌ Erro ao processar webhook externo:", error);
    return json({ error: "Internal server error" }, { status: 500 });
  }
};