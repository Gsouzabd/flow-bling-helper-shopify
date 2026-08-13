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
    const opcao = grupo?.selectedDeliveryOption;
    if (!opcao) return;

    // O prazo em dias úteis vem em "description" (ex.: "11 dias úteis"),
    // não em "title" (que é só o nome da modalidade, ex.: "Econômico").
    const textoBase = opcao.description || opcao.title;
    if (!textoBase) return;

    const match = removerAcentos(textoBase).match(REGEX_DIAS_UTEIS);
    const prazoTexto = match ? `${match[1]} dias úteis` : textoBase;

    applyAttributeChange({
      type: "updateAttribute",
      key: NOTE_ATTR_KEY,
      value: prazoTexto,
    });
  }, [deliveryGroups, applyAttributeChange]);

  return null;
}
