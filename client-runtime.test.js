const test = require("node:test");
const assert = require("node:assert/strict");

const {
  describePayloadStatus,
  fetchJsonWithRetry,
  loadSnapshot,
  saveSnapshot,
} = require("./client-runtime");

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test("transient server failure retries once", async () => {
  let calls = 0;
  const payload = await fetchJsonWithRetry("https://example.test/api", {
    timeoutMs: 50,
    retries: 1,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return { ok: false, status: 503, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
  });
  assert.equal(calls, 2);
  assert.deepEqual(payload, { ok: true });
});

test("request timeout aborts instead of hanging", async () => {
  const fetchImpl = (_url, { signal }) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")));
    });

  await assert.rejects(
    fetchJsonWithRetry("https://example.test/api", { timeoutMs: 10, retries: 0, fetchImpl }),
    /请求超时/,
  );
});

test("snapshot expires after six hours", () => {
  const storage = memoryStorage();
  saveSnapshot(storage, "funds", { ok: true }, 1000);
  assert.deepEqual(loadSnapshot(storage, "funds", { now: 1000 + 21_600_000 }), { ok: true });
  assert.equal(loadSnapshot(storage, "funds", { now: 1001 + 21_600_000 }), null);
});

test("stale backend payload produces an explicit cache warning", () => {
  const result = describePayloadStatus({
    stale: true,
    sourceUpdatedAt: "2026-07-11T10:00:00+08:00",
    cacheAgeSeconds: 600,
  });
  assert.equal(result.stale, true);
  assert.match(result.label, /缓存数据/);
  assert.match(result.detail, /2026-07-11/);
});
