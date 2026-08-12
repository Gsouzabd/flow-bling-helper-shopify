import { useEffect } from "react";
import {
  reactExtension,
  useDeliveryGroups,
  useApplyAttributeChange,
} from "@shopify/ui-extensions-react/checkout";

const NOTE_ATTR_KEY = "Prazo de Entrega";
const REGEX_DIAS_UTEIS = /(\d+)\s*dias?\s*uteis?/i;

function removerAcentos(texto) {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export default reactExtension("purchase.checkout.shipping-option-list.render-after", () => (
  <PrazoEntrega />
));

function PrazoEntrega() {
  const deliveryGroups = useDeliveryGroups();
  const applyAttributeChange = useApplyAttributeChange();

  useEffect(() => {
    const grupo = deliveryGroups?.find((g) => g.selectedDeliveryOption);
    const titulo = grupo?.selectedDeliveryOption?.title;
    if (!titulo) return;

    const match = removerAcentos(titulo).match(REGEX_DIAS_UTEIS);
    const prazoTexto = match ? `${match[1]} dias úteis` : titulo;

    applyAttributeChange({
      type: "updateAttribute",
      key: NOTE_ATTR_KEY,
      value: prazoTexto,
    });
  }, [deliveryGroups, applyAttributeChange]);

  return null;
}
