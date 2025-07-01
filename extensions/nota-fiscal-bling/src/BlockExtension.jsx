import React, { useEffect, useState } from "react";
import {
  reactExtension,
  useApi,
  AdminBlock,
  BlockStack,
  Text,
  Link,
  InlineStack,
} from "@shopify/ui-extensions-react/admin";

const TARGET = "admin.order-details.block.render";

export default reactExtension(TARGET, () => <NotaFiscalBlock />);

function NotaFiscalBlock() {
  const { i18n, data } = useApi(TARGET);
  const orderId = data?.selected?.[0]?.id?.split("/").pop() || "";

  const [linkNotaFiscal, setLinkNotaFiscal] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!orderId) return;

    (async () => {
      try {
        const res = await fetch(`/api/get-nota-fiscal-link?orderId=${orderId}`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        });

        const json = await res.json();

        if (json.success && json.linkNotaFiscal) {
          setLinkNotaFiscal(json.linkNotaFiscal);
        } else {
          setError("Nota fiscal não encontrada.");
        }
      } catch (e) {
        console.error("Erro ao buscar nota fiscal:", e);
        setError("Nota fiscal não encontrada.");
      }
    })();
  }, [orderId]);

  return (
    <AdminBlock title="Nota Fiscal - Bling">
      <BlockStack spacing>
        {linkNotaFiscal ? (
          <Link to={linkNotaFiscal} external>
            <InlineStack spacing="extraTight" alignment="center">
              <Text>📄 Baixar Nota Fiscal (PDF)</Text>
            </InlineStack>
          </Link>
        ) : (
          <Text>{error || "Carregando nota fiscal..."}</Text>
        )}
      </BlockStack>
    </AdminBlock>
  );
}
