import { prisma } from "./prisma.server";

export async function saveOrderLog({ orderId, financialStatus, createdDate, shop, descriptionOperation }) {
  return prisma.orderLog.create({
    data: {
      orderId: orderId,
      financialStatus: financialStatus,
      createdDate: createdDate,
      shop: shop,
      descriptionOperation: descriptionOperation, // 👈 aqui precisa estar presente
    },
  });
}


export async function saveOrderLogWithRetry(data, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await saveOrderLog(data);
    } catch (error) {
      if (
        error.code === 'P2034' || // Código de erro do Prisma para timeout
        error.message.includes('timeout') ||
        error.message.includes('database is locked')
      ) {
        console.warn(`Timeout ou lock detectado, tentando novamente (${i + 1}/${retries})`);
        await new Promise((res) => setTimeout(res, 500)); // espera 500ms antes de tentar
        continue;
      }
      throw error; // outro erro, lança
    }
  }
  throw new Error('Falha ao salvar log após múltiplas tentativas');
}
