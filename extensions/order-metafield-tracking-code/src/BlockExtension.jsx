import React, { useEffect, useState } from "react";
import {
  reactExtension,
  useApi,
  AdminBlock,
  BlockStack,
  TextField,
  Button,
  Text,
} from "@shopify/ui-extensions-react/admin";

const TARGET = "admin.order-details.block.render";

export default reactExtension(TARGET, () => <TrackingCodeBlock />);

function TrackingCodeBlock() {
  const { i18n, data } = useApi(TARGET);

  // Pega o ID do pedido do primeiro item selecionado
  const orderId = data?.selected?.[0]?.id?.split("/").pop() || "";

  const [trackingCode, setTrackingCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!orderId) return;

    (async () => {
      try {

const res = await fetch(`
  /api/get-tracking-code?orderId=${orderId}`, {
  method: "GET",
  mode: "cors",           // padrão, mas explicita
  credentials: "omit",    // garante que não envie cookies ou headers automáticos
  headers: {
    // não passe Authorization aqui
    "Content-Type": "application/json",
  },
});        console.log("Status da resposta:", res.status);
        const json = await res.json();
        console.log("Resposta JSON da API:", json);

        if (json.success && json.trackingCode) {
          setTrackingCode(json.trackingCode);
        } else {
          console.warn("Resposta sem sucesso ou trackingCode:", json);
        }
      } catch (e) {
        console.error("Erro ao buscar código de rastreio:", e);
      }
    })();
  }, [orderId]);

  async function handleSave() {
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch("/api/save-tracking-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, trackingCode }),
      });
      const json = await res.json();
      if (json.success) {
        setMessage("Código de rastreio salvo com sucesso");
      } else {
        setMessage("Erro ao salvar código de rastreio");
      }
    } catch (e) {
      console.error("Erro ao salvar código:", e);
      setMessage("Erro interno do app");
    }
    setLoading(false);
  }

  return (
    <AdminBlock title={i18n.translate("orderTrackingCode.title") || "Código de Rastreio Bling"}>
      <BlockStack spacing>
        <TextField
          label={i18n.translate("orderTrackingCode.label") || "Código de rastreio"}
          value={trackingCode}
          onChange={(value) => setTrackingCode(value)}
          disabled={loading}
        />
        <Button accessibilityLabel="Salvar código de rastreio" onPress={handleSave} loading={loading}>
          {i18n.translate("orderTrackingCode.saveButton") || "Salvar"}
        </Button>
        {message && <Text>{message}</Text>}
      </BlockStack>
    </AdminBlock>
  );
}
