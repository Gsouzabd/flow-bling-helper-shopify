import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../db/prisma.server.js";
import {
  enqueueWebhook,
  claimNextBatch,
  recoverStaleLocks,
  markDone,
  markRetry,
  markFailed,
} from "../db/webhookQueue.server.js";

const TEST_SHOP = "test.myshopify.com";
// Prefixo aleatório para isolar esta execução de qualquer outra linha de teste.
const PREFIX = `itest:${Math.floor(Math.random() * 1e9)}:`;

function baseEvent(overrides = {}) {
  return {
    source: "bling",
    topic: "order-updated",
    shop: TEST_SHOP,
    payload: { data: { id: 1, numeroLoja: "1" } },
    dedupeKey: `${PREFIX}${Math.random()}`,
    ...overrides,
  };
}

async function cleanup() {
  await prisma.webhookEvent.deleteMany({ where: { shop: TEST_SHOP } });
}

// Reserva em loop curto até encontrar o evento alvo. Reflete o comportamento
// real do worker (múltiplos ticks) e neutraliza a corrida de visibilidade do
// pool de conexões do Prisma quando há inserts concorrentes.
async function claimUntil(targetId, attempts = 5) {
  const collected = [];
  for (let i = 0; i < attempts; i++) {
    const batch = await claimNextBatch({ limit: 10 });
    collected.push(...batch);
    const found = collected.find((r) => r.id === targetId);
    if (found) return { found, collected };
  }
  return { found: undefined, collected };
}

before(cleanup);
beforeEach(cleanup);
after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test("enqueueWebhook cria linha pending com campos corretos", async () => {
  const ev = await enqueueWebhook(baseEvent());
  assert.equal(ev.status, "pending");
  assert.equal(ev.shop, TEST_SHOP);
  assert.equal(ev.attempts, 0);
  assert.equal(ev.maxAttempts, 8);
  assert.ok(ev.id);
});

test("enqueueWebhook deduplica por dedupeKey em aberto", async () => {
  const dedupeKey = `${PREFIX}dedup`;
  const first = await enqueueWebhook(baseEvent({ dedupeKey }));
  const second = await enqueueWebhook(baseEvent({ dedupeKey }));
  assert.equal(second.id, first.id);

  const count = await prisma.webhookEvent.count({ where: { dedupeKey } });
  assert.equal(count, 1);
});

test("claimNextBatch reserva a linha (processing, attempts+1, lockedAt)", async () => {
  const ev = await enqueueWebhook(baseEvent({ dedupeKey: `${PREFIX}claim` }));
  const { found: claimed } = await claimUntil(ev.id);

  assert.ok(claimed, "evento deveria ter sido reservado");
  assert.equal(claimed.status, "processing");
  assert.equal(claimed.attempts, 1);
  assert.ok(claimed.lockedAt);
});

test("claimNextBatch ignora linha com nextRetryAt no futuro", async () => {
  const ev = await enqueueWebhook(
    baseEvent({
      dedupeKey: `${PREFIX}future`,
      nextRetryAt: new Date(Date.now() + 3600_000),
    })
  );
  const batch = await claimNextBatch({ limit: 50 });
  assert.equal(
    batch.find((r) => r.id === ev.id),
    undefined
  );
});

test("recoverStaleLocks devolve processing órfão para pending", async () => {
  const ev = await enqueueWebhook(baseEvent({ dedupeKey: `${PREFIX}stale` }));
  // Simula lock órfão antigo
  await prisma.webhookEvent.update({
    where: { id: ev.id },
    data: { status: "processing", lockedAt: new Date(Date.now() - 600_000) },
  });

  const recovered = await recoverStaleLocks(120000);
  assert.ok(recovered >= 1);

  const after = await prisma.webhookEvent.findUnique({ where: { id: ev.id } });
  assert.equal(after.status, "pending");
  assert.equal(after.lockedAt, null);
});

test("markDone / markRetry / markFailed transicionam corretamente", async () => {
  const done = await enqueueWebhook(baseEvent({ dedupeKey: `${PREFIX}done` }));
  const d = await markDone(done.id);
  assert.equal(d.status, "done");
  assert.ok(d.processedAt);

  const retry = await enqueueWebhook(baseEvent({ dedupeKey: `${PREFIX}retry` }));
  const future = new Date(Date.now() + 60_000);
  const r = await markRetry(retry.id, new Error("boom"), future);
  assert.equal(r.status, "pending");
  assert.equal(r.lastError, "boom");
  assert.ok(r.nextRetryAt > new Date());

  const failed = await enqueueWebhook(baseEvent({ dedupeKey: `${PREFIX}failed` }));
  const f = await markFailed(failed.id, new Error("fatal"));
  assert.equal(f.status, "failed");
  assert.equal(f.lastError, "fatal");
  assert.ok(f.processedAt);
});
