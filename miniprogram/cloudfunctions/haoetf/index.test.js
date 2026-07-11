const test = require("node:test");
const assert = require("node:assert/strict");

const { API_TIMEOUT_MS, createMain } = require("./index");

test("cloud function uses a twelve second request bound", () => {
  assert.equal(API_TIMEOUT_MS, 12_000);
});

test("cloud function returns normalized backend payload", async () => {
  const main = createMain(async () => ({ ok: true, data: { funds: [{ code: "501312" }] } }));
  const result = await main();
  assert.equal(result.ok, true);
  assert.equal(result.data.funds[0].code, "501312");
});

test("cloud function hides infrastructure error details", async () => {
  const main = createMain(async () => {
    throw new Error("connect ECONNREFUSED 10.0.0.1:443");
  });
  const result = await main();
  assert.deepEqual(result, { ok: false, error: "行情服务暂时不可用" });
});
