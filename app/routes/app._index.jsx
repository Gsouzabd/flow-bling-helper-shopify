import React from "react";

import { useLoaderData, useNavigate, useSearchParams } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  IndexTable,
  useIndexResourceState,
  Badge,
  TextField,
  Button,
  Pagination,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import { prisma } from "../../db/prisma.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const searchOrderId = url.searchParams.get("orderId") || "";
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const pageSize = 10;
  const skip = (page - 1) * pageSize;

  const where = searchOrderId
    ? {
        orderId: BigInt(searchOrderId),  // Prisma usa BigInt para orderId no seu schema
      }
    : {};

  // Consulta com filtro e paginação
  const [totalCount, rawLogs] = await Promise.all([
    prisma.orderLog.count({ where }),
    prisma.orderLog.findMany({
      where,
      orderBy: { createdDate: "desc" },
      skip,
      take: pageSize,
    }),
  ]);

  const logs = rawLogs.map((log) => ({
    ...log,
    orderId: log.orderId.toString(),
  }));

  return { logs, totalCount, page, pageSize, searchOrderId };
};




export default function Index() {
  const { logs, totalCount, page, pageSize, searchOrderId } = useLoaderData();
  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(logs);

  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Estado local para input de busca
  const [orderIdInput, setOrderIdInput] = React.useState(searchOrderId);

  // Função para submeter busca
  const handleSearchSubmit = () => {
    const params = new URLSearchParams();
    if (orderIdInput) params.set("orderId", orderIdInput);
    // Sempre volta pra página 1 ao buscar
    params.set("page", "1");
    navigate(`?${params.toString()}`);
  };

  // Função para mudar página
  const handlePageChange = (newPage) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", newPage);
    navigate(`?${params.toString()}`);
  };

  const resourceName = { singular: "log", plural: "logs" };

  return (
    <Page title="Flow Bling Helper">
      <Layout>
        {/* Descrição do app */}
        <Layout.Section>
          <Card title="Sobre o Flow Bling Helper" sectioned>
            <Text as="p" variant="bodyMd">
              O Flow Bling Helper é um app de integração inteligente entre Shopify e Bling.
              Ele automatiza o monitoramento de pedidos, identifica pagamentos via expirados
              e realiza cancelamentos automáticos no Bling. Além disso, adiciona observações
              personalizadas nos pedidos e registra logs completos no banco de dados para rastreabilidade.
            </Text>
          </Card>
        </Layout.Section>
       

        {/* Tabela */}
        <Layout.Section>
          <Text as="h2" variant="headingMd" alignment="start">
            Log de Pedidos processados
          </Text>
          <Card title="Últimos pedidos processados" sectioned>
             {/* Busca */}
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 10 }}>
              <TextField
                label=""
                value={orderIdInput}
                onChange={setOrderIdInput}z
                clearButton
                onClearButtonClick={() => {
                  setOrderIdInput("");
                  navigate("/"); // limpa busca e volta para página 1
                }}
                placeholder="Buscar por Order ID"
                type="number"
                style={{ flex: 1 }} // para o input ocupar o máximo possível
              />
              <Button onClick={handleSearchSubmit} primary>
                Buscar
              </Button>
            </div>

            <IndexTable
              resourceName={resourceName}
              itemCount={logs.length}
              selectedItemsCount={allResourcesSelected ? "All" : selectedResources.length}
              onSelectionChange={handleSelectionChange}
              headings={[
                { title: "Pedido Shopify" },
                { title: "Status financeiro" },
                { title: "Descrição" },
                { title: "Data da Operação" },
              ]}
            >
              {logs.map((log, index) => (
                <IndexTable.Row
                  id={log.id}
                  key={log.id}
                  selected={selectedResources.includes(log.id)}
                  position={index}
                >
                  <IndexTable.Cell>{log.orderId}</IndexTable.Cell>
                  <IndexTable.Cell>
                    <Badge
                      status={
                        log.financialStatus === "expired" || log.financialStatus === "pending"
                          ? "critical"
                          : "success"
                      }
                    >
                      {log.financialStatus}
                    </Badge>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{log.descriptionOperation}</IndexTable.Cell>
                  <IndexTable.Cell>
                    {new Date(log.createdAt).toLocaleString("pt-BR", {
                      timeZone: "America/Sao_Paulo",
                    })}
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>

            {/* Paginação */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, marginTop: 16 }}>
            <Pagination
              hasPrevious={page > 1}
              onPrevious={() => handlePageChange(page - 1)}
              hasNext={page * pageSize < totalCount}
              onNext={() => handlePageChange(page + 1)}
            />
            <span style={{ fontWeight: "bold" }}>Página {page}</span>
          </div>
          </Card>
        </Layout.Section>

        {/* Rodapé */}
        <Layout.Section>
          <Card sectioned>
            <div style={{ textAlign: "center", paddingTop: "8px" }}>
              <Text variant="bodyMd" as="span">
                Desenvolvido por{" "}
                <a
                  href="https://goflow.digital/"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ textDecoration: "none", color: "#000" }}
                >
                  <img
                    src="https://goflow.digital/wp-content/uploads/2024/07/logo-flow.svg"
                    alt="Flow Digital"
                    style={{ height: "50px", verticalAlign: "middle" }}
                  />
                </a>
              </Text>
            </div>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

