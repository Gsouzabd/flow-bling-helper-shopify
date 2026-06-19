import { prisma } from "./prisma.server";

/**
 * Camada de acesso à fila de webhooks (model WebhookEvent).
 * Os endpoints enfileiram aqui e respondem 2xx imediatamente; o worker
 * (app/services/webhookWorker.server.js) consome a fila com lock por linha.
 */

const STALE_LOCK_MS = 120000; // 2 min — locks órfãos voltam para 'pending'

/**
 * Enfileira um webhook. Faz deduplicação: se já existe um evento em aberto
 * (pending/processing) com o mesmo dedupeKey, retorna o existente sem criar
 * um novo — colapsando os múltiplos retries que o Bling/Shopify enviam.
 *
 * @param {object} args
 * @param {'bling'|'shopify'} args.source
 * @param {string} args.topic
 * @param {string} args.shop
 * @param {object} args.payload
 * @param {string} args.dedupeKey
 * @param {number} [args.maxAttempts]
 * @param {Date}   [args.nextRetryAt] - atraso inicial opcional (ex.: +60s)
 * @returns {Promise<object>}
 */
export async function enqueueWebhook(
  { source, topic, shop, payload, dedupeKey, maxAttempts = 8, nextRetryAt },
  retries = 3
) {
  for (let i = 0; i < retries; i++) {
    try {
      const existing = await prisma.webhookEvent.findFirst({
        where: { dedupeKey, status: { in: ["pending", "processing"] } },
      });
      if (existing) return existing;

      return await prisma.webhookEvent.create({
        data: {
          source,
          topic,
          shop,
          payload,
          dedupeKey,
          maxAttempts,
          ...(nextRetryAt ? { nextRetryAt } : {}),
        },
      });
    } catch (error) {
      if (
        error.code === "P2034" ||
        error.message?.includes("timeout") ||
        error.message?.includes("database is locked")
      ) {
        await new Promise((res) => setTimeout(res, 500));
        continue;
      }
      throw error;
    }
  }
  throw new Error("Falha ao enfileirar webhook após múltiplas tentativas");
}

/**
 * Reserva atomicamente o próximo lote de eventos prontos para processar.
 * Usa UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) para garantir
 * que ticks sobrepostos nunca peguem o mesmo evento.
 *
 * @param {object} [opts]
 * @param {number} [opts.limit]
 * @returns {Promise<Array<object>>}
 */
export async function claimNextBatch({ limit = 5 } = {}) {
  const rows = await prisma.$queryRaw`
    UPDATE "WebhookEvent"
    SET status = 'processing', "lockedAt" = now(), attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM "WebhookEvent"
      WHERE status = 'pending' AND "nextRetryAt" <= now()
      ORDER BY "nextRetryAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *;
  `;
  return rows;
}

/**
 * Devolve para 'pending' eventos travados em 'processing' há mais que o
 * staleLockMs (ex.: o processo morreu no meio de um processamento).
 * @returns {Promise<number>} quantidade recuperada
 */
export async function recoverStaleLocks(staleLockMs = STALE_LOCK_MS) {
  const cutoff = new Date(Date.now() - staleLockMs);
  const res = await prisma.webhookEvent.updateMany({
    where: { status: "processing", lockedAt: { lt: cutoff } },
    data: { status: "pending", lockedAt: null },
  });
  return res.count;
}

export async function markDone(id) {
  return prisma.webhookEvent.update({
    where: { id },
    data: {
      status: "done",
      lastError: null,
      lockedAt: null,
      processedAt: new Date(),
    },
  });
}

export async function markRetry(id, error, nextRetryAt) {
  return prisma.webhookEvent.update({
    where: { id },
    data: {
      status: "pending",
      lastError: String(error?.message ?? error).slice(0, 1000),
      lockedAt: null,
      nextRetryAt,
    },
  });
}

export async function markFailed(id, error) {
  return prisma.webhookEvent.update({
    where: { id },
    data: {
      status: "failed",
      lastError: String(error?.message ?? error).slice(0, 1000),
      lockedAt: null,
      processedAt: new Date(),
    },
  });
}
