import React, { useEffect, useState } from "react";

import {
  reactExtension,
  useOrder,
  Text,
  Banner,
  BlockStack,
  Link,
  Button 
} from "@shopify/ui-extensions-react/customer-account";

export default reactExtension("customer-account.order-status.block.render", () => <NotaFiscal />);

function NotaFiscal() {
  const order = useOrder();
  const [linkNotaFiscal, setLinkNotaFiscal] = useState(null);
  const [trackingCode, setTrackingCode] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      if (!order?.id) {
        setLoading(false);
        return;
      }

      const orderId = order.id.split("/").pop();

      try {
        // const apiBase = "https://flow-bling-helper.fly.dev"; // --> homologação
        const apiBase = "https://flow-bling-helper.fly.dev"; // --> produção

        // Buscar Nota Fiscal
        const nfRes = await fetch(`${apiBase}/api/get-nota-fiscal-link?orderId=${orderId}`);
        const nfJson = await nfRes.json();
        if (nfRes.ok && nfJson.linkNotaFiscal) {
          setLinkNotaFiscal(nfJson.linkNotaFiscal);
        }

        // Buscar Código de Rastreio
        const tcRes = await fetch(`${apiBase}/api/get-tracking-code?orderId=${orderId}`, {
          method: "GET",
          mode: "cors",
          credentials: "omit",
          headers: {
            "Content-Type": "application/json",
          },
        });

        console.log("Status da resposta:", tcRes.status);
        const tcJson = await tcRes.json();
        console.log("Resposta JSON da API:", tcJson);

        if (tcJson.success && tcJson.trackingCode) {
          setTrackingCode(tcJson.trackingCode);
        } else {
          console.warn("Resposta sem sucesso ou trackingCode:", tcJson);
        }
      } catch (error) {
        console.error("Erro ao buscar dados do pedido:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [order]);

  if (loading) return <Text>Carregando dados do pedido...</Text>;

  return (
    <BlockStack spacing="base">
      {linkNotaFiscal ? (
        <Banner
          padding="base"
          background="white"
          border="base"
          borderRadius="base"
          title="📄 Nota Fiscal disponível"
          status="success"
        >
          <BlockStack spacing="tight">
            <Text tone="subdued">
              Você pode baixar o PDF da nota fiscal referente a este pedido:{" "}
            </Text>

            <Link to={linkNotaFiscal} external>
              <Button >
                Baixar Nota Fiscal
              </Button>
            </Link>          
          </BlockStack>
        </Banner>
      ) : (
       ''
      )}

      {trackingCode && (
        <Banner
          padding="base"
          background="white"
          border="base"
          borderRadius="base"
          title="📦 Código de Rastreio"
          status="info"
        >
          <BlockStack spacing="tight">
            <Text tone="subdued">
              O seu pedido pode ser rastreado com o código: 
              <Text tone="subdued" appearance="accent" emphasis> {trackingCode}</Text> 
            </Text>
          </BlockStack>
        </Banner>
      )}
    </BlockStack>
  );
}
