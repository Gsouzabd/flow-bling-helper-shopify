import { json } from "@remix-run/node";
import { sessionStorage } from "../shopify.server";
import { shopify } from "../shopify.api";
import { buscarPedidoCompletoPorId, buscarNotaFiscalPorId } from "../services/blingPedidos.server";

export const action = async ({ request }) => {
  try {
    const payload = await request.json();
    const idPedidoBling = payload?.data?.id;
    const orderIdShopify = payload?.data?.numeroLoja;

    if (!idPedidoBling || !orderIdShopify) {
      return json({ error: "Parâmetros inválidos" }, { status: 400 });
    }

    const shop = process.env.SHOPIFY_SHOP;
    const sessionId = `offline_${shop}`;
    const session = await sessionStorage.loadSession(sessionId);

    if (!session || !session.accessToken) {
      return json({ error: "Sessão inválida ou sem token" }, { status: 403 });
    }

    const pedidoCompleto = await buscarPedidoCompletoPorId(shop, idPedidoBling);
    const codigosRastreio = pedidoCompleto.transporte?.volumes?.map(v => v.codigoRastreamento).filter(Boolean);
    const codigoRastreio = codigosRastreio?.[0] || null;

    const idNotaFiscal = pedidoCompleto.notaFiscal?.id;

    const client = new shopify.clients.Graphql({ session });

    // Adiciona Metafields (Tracking e NF)
    const metafields = [];

    if (codigoRastreio) {
      metafields.push({
        namespace: "tracking",
        key: "codigo_de_rastreio_bling",
        type: "single_line_text_field",
        value: codigoRastreio,
        ownerId: `gid://shopify/Order/${orderIdShopify}`,
      });
    }

    if (idNotaFiscal) {
      const notaFiscal = await buscarNotaFiscalPorId(shop, idNotaFiscal);
      if (notaFiscal.linkPDF) {
        metafields.push({
          namespace: "tracking",
          key: "link_nota_fiscal_bling",
          type: "url",
          value: notaFiscal.linkPDF,
          ownerId: `gid://shopify/Order/${orderIdShopify}`,
        });
      }
    }

    if (metafields.length > 0) {
      const mutation = `
        mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields { key namespace value }
            userErrors { field message }
          }
        }
      `;

      const res = await client.query({
        data: { query: mutation, variables: { metafields } },
      });

      if (res.body.data.metafieldsSet.userErrors.length) {
        return json({ success: false, errors: res.body.data.metafieldsSet.userErrors }, { status: 400 });
      }
    }

    // Criar fulfillment via REST (não GraphQL)
    const locationsRes = await fetch(`https://${shop}/admin/api/2025-07/locations.json`, {
      headers: { "X-Shopify-Access-Token": session.accessToken }
    });
    const locations = await locationsRes.json();
    console.log(locations);
    
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

    let locationId = orderJson.order.location_id;

    const lineItems = orderJson.order.line_items.map(item => ({
      id: item.id,
      quantity: item.quantity, // quantity não pode ser 0
    }));
    
    if (!locationId) {
      const fulfillmentOrdersRes = await fetch(`https://${shop}/admin/api/2025-07/orders/${orderIdShopify}/fulfillment_orders.json`, {
        method: "GET",
        headers: {
          "X-Shopify-Access-Token": session.accessToken,
          "Content-Type": "application/json"
        }
      });
    
      const fulfillmentOrdersJson = await fulfillmentOrdersRes.json();
    
      if (!fulfillmentOrdersRes.ok || !fulfillmentOrdersJson.fulfillment_orders.length) {
        return json({ error: "Não foi possível obter fulfillment_orders" }, { status: 400 });
      }
    
      const fulfillmentOrder = fulfillmentOrdersJson.fulfillment_orders[0];
    
      if (!fulfillmentOrder.assigned_location || !fulfillmentOrder.assigned_location.location || !fulfillmentOrder.assigned_location.location.id) {
  
        // Força usar o "Shop location" do locations.json
        const shopLocation = locations.locations.find(loc => loc.name.toLowerCase() === 'shop location');
        
        if (!shopLocation) {
          return json({ error: "Nenhuma location válida encontrada" }, { status: 400 });
        }
      
        locationId = shopLocation.id; // Fallback para o Shop location
      
      } else {
        // Usa a location atribuída normalmente
        locationId = fulfillmentOrder.assigned_location.location.id;
      }
    }
      
    


    if (codigoRastreio) {
      let empresaRastreio = pedidoCompleto.transporte?.contato?.nome?.toLowerCase() || '';

      const linksRastreio = {
        Correios: 'https://www.linkcorreios.com.br/?objeto=',
        Mandae: 'https://rastreae.com.br/resultado/'
      };

      // Função para identificar a transportadora
      const identificarTransportadora = (nome) => {
        if (!nome) return null;

        if (nome.includes('correios')) return 'Correios';
        if (nome.includes('mandae')) return 'Mandae';

        return null; // fallback, caso não encontre correspondência
      };

      const transportadoraKey = identificarTransportadora(empresaRastreio);

      let linkRastreamento = null;

      if (transportadoraKey && codigoRastreio) {
        linkRastreamento = linksRastreio[transportadoraKey];

        // Monta o link completo dependendo da transportadora
        if (transportadoraKey === 'Correios') {
          linkRastreamento += codigoRastreio;
        } else if (transportadoraKey === 'Mandae') {
          linkRastreamento += codigoRastreio;
        }
      }

      console.log({ empresaRastreio, linkRastreamento });


      // Buscar fulfillment_orders
      const fulfillmentOrdersRes = await fetch(`https://${shop}/admin/api/2025-07/orders/${orderIdShopify}/fulfillment_orders.json`, {
        method: "GET",
        headers: {
          "X-Shopify-Access-Token": session.accessToken,
          "Content-Type": "application/json"
        }
      });
    
      const fulfillmentOrdersJson = await fulfillmentOrdersRes.json();
    
      if (!fulfillmentOrdersRes.ok) {
        throw new Error("Erro ao buscar fulfillment_orders");
      }
    
      const fulfillmentOrder = fulfillmentOrdersJson.fulfillment_orders[0];
    
      const fulfillmentOrderId = fulfillmentOrder.id;
      const fulfillmentOrderLineItems = fulfillmentOrder.line_items
      .filter(item => item.fulfillable_quantity > 0)
      .map(item => ({
        id: item.id, // fulfillment_order_line_item id
        quantity: item.fulfillable_quantity,
      }));
    
    if (fulfillmentOrderLineItems.length === 0) {
      return json({ error: "Nenhum item com quantidade para fulfillment" }, { status: 400 });
    }
      
      
      
    
      const fulfillmentPayload = {
        fulfillment: {
          message: "Pedido enviado via Bling",
          notify_customer: false,
          tracking_info: {
            number: codigoRastreio,
            company: 'Clique para acompanhar a entrega do seu pedido',
            url: `${linksRastreio}${encodeURIComponent(codigoRastreio)}`
          },
          line_items_by_fulfillment_order: [
            {
              fulfillment_order_id: fulfillmentOrderId,
              fulfillment_order_line_items: fulfillmentOrderLineItems
            }
          ]
        }
      };
    
      const fulfillmentRes = await fetch(`https://${shop}/admin/api/2025-07/fulfillments.json`, {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": session.accessToken,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(fulfillmentPayload)
      });
    
      const fulfillmentJson = await fulfillmentRes.json();
    
      if (!fulfillmentRes.ok) {
        console.error("Erro ao criar fulfillment", fulfillmentJson);
        throw new Error("Erro ao criar fulfillment");
      }
    
      console.log("Fulfillment criado com sucesso", fulfillmentJson);
    
      return json({
        success: true,
        fulfillment: fulfillmentJson
      });
    }
    


  } catch (error) {
    console.error("Erro geral:", error);
    return json({ error: "Erro interno", message: error.message }, { status: 500 });
  }
};
