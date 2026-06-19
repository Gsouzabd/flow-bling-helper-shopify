import {
  claimNextBatch,
  recoverStaleLocks,
  markDone,
  markRetry,
  markFailed,
} from "../../db/webhookQueue.server";
import { processWebhookEvent } from "./webhookProcessor.server";

/**
 * Worker in-process que consome a fila WebhookEvent. Como o app roda em uma
 * única máquina sempre ativa no Fly (auto_stop=off, min_machines_running=1),
 * um setInterval é suficiente e dispensa cron externo. A segurança de
 * concorrência vem do lock por linha (FOR UPDATE SKIP LOCKED) em claimNextBatch.
 */

const INTERVAL_MS = Number(process.env.WEBHOOK_WORKER_INTERVAL_MS ?? 15000);
const BATCH_LIMIT = Number(process.env.WEBHOOK_WORKER_BATCH ?? 5);
const BASE_BACKOFF_MS = 30000; // 30s
const MAX_BACKOFF_MS = 30 * 60000; // 30 min

let started = false;
let running = false;

export function startWebhookWorker() {
  if (started || process.env.WEBHOOK_WORKER_DISABLED === "1") return;
  started = true;
  console.log(`[webhookWorker] iniciado (intervalo ${INTERVAL_MS}ms)`);
  const timer = setInterval(tick, INTERVAL_MS);
  // Não segura o event loop em ambientes de teste/CLI
  if (typeof timer.unref === "function") timer.unref();
}

export function nextRetryDelay(attempts) {
  const exp = BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1);
  const capped = Math.min(MAX_BACKOFF_MS, exp);
  const jitter = Math.floor(capped * 0.2 * (attempts % 5) / 5); // jitter determinístico
  return capped + jitter;
}

async function tick() {
  if (running) return; // evita ticks sobrepostos
  running = true;
  try {
    await recoverStaleLocks();
    const batch = await claimNextBatch({ limit: BATCH_LIMIT });
    for (const event of batch) {
      await handleOne(event);
    }
  } catch (err) {
    console.error("[webhookWorker] erro no tick:", err);
  } finally {
    running = false;
  }
}

async function handleOne(event) {
  try {
    const result = await processWebhookEvent(event);
    await markDone(event.id);
    if (result?.skipped) {
      console.log(`[webhookWorker] ${event.id} skipped: ${result.reason}`);
    } else {
      console.log(`[webhookWorker] ${event.id} done`);
    }
  } catch (err) {
    const attempts = event.attempts ?? 1;
    if (attempts >= (event.maxAttempts ?? 8)) {
      console.error(`[webhookWorker] ${event.id} FAILED após ${attempts} tentativas:`, err);
      await markFailed(event.id, err);
      return;
    }
    const delay = nextRetryDelay(attempts);
    const nextRetryAt = new Date(Date.now() + delay);
    console.warn(
      `[webhookWorker] ${event.id} retry ${attempts}/${event.maxAttempts ?? 8} em ${Math.round(delay / 1000)}s: ${err?.message}`
    );
    await markRetry(event.id, err, nextRetryAt);
  }
}
