import { test } from "node:test";
import assert from "node:assert/strict";

import { nextRetryDelay } from "../app/services/webhookWorker.server.js";

const BASE = 30000; // 30s
const MAX = 30 * 60000; // 30 min

test("nextRetryDelay cresce exponencialmente a partir de 30s", () => {
  // attempts=1 -> base; attempts=2 -> 2x; attempts=3 -> 4x
  assert.ok(nextRetryDelay(1) >= BASE && nextRetryDelay(1) < BASE * 1.3);
  assert.ok(nextRetryDelay(2) >= BASE * 2 && nextRetryDelay(2) < BASE * 2.6);
  assert.ok(nextRetryDelay(3) >= BASE * 4 && nextRetryDelay(3) < BASE * 5.2);
});

test("nextRetryDelay satura em 30 min", () => {
  for (const attempts of [10, 20, 50]) {
    const d = nextRetryDelay(attempts);
    assert.ok(d >= MAX, `delay deveria estar saturado para attempts=${attempts}`);
    assert.ok(d < MAX * 1.3, `delay não deveria exceder muito o teto`);
  }
});

test("nextRetryDelay é determinístico", () => {
  assert.equal(nextRetryDelay(4), nextRetryDelay(4));
});
