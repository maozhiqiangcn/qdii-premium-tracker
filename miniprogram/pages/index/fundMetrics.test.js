const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const {
  buildFundView,
  createSettingsSnapshot,
  filterAndSortFunds,
  normalizePayloadFunds,
  summarizeFunds,
  shouldNotifyAlert,
} = require("./fundMetrics");

test("mini program labels describe displayed values", () => {
  const wxml = fs.readFileSync("miniprogram/pages/index/index.wxml", "utf8");
  assert.match(wxml, /估值变动/);
  assert.match(wxml, /T-1溢价 \/ 日期/);
  assert.doesNotMatch(wxml, /系统误差|实时溢价率 \/ 天数/);
});

test("mini program settings include alert cooldown", () => {
  assert.deepEqual(
    createSettingsSnapshot({ alertEnabled: true, threshold: 3, lastAlertAt: 10, lastAlertSignature: "513100" }),
    { alertEnabled: true, threshold: 3, lastAlertAt: 10, lastAlertSignature: "513100" },
  );
});

test("stale payload clears realtime values", () => {
  const funds = normalizePayloadFunds(
    [{ code: "513100", realtimeEstimate: "2.10", realtimePremium: "3.00%", latestPremium: "4.00%" }],
    true,
  );
  assert.equal(funds[0].realtimeEstimate, "");
  assert.equal(funds[0].realtimePremium, "");
  assert.equal(funds[0].latestPremium, "4.00%");
  assert.equal(funds[0].realtimeFresh, false);
});

test("buildFundView parses premium values and marks alerts", () => {
  const fund = buildFundView(
    {
      code: "501225",
      name: "全球芯片LOF",
      realtimePremium: "+40.49%",
      latestPremium: "1.14%",
      pricePct: "-0.50%",
      turnoverWan: "3521万",
    },
    3,
  );

  assert.equal(fund.alert, true);
  assert.equal(fund.category, "qdii");
  assert.equal(fund.realtimePremiumClass, "positive");
  assert.equal(fund.pricePctClass, "negative");
  assert.equal(fund.sortPremium, 40.49);
});

test("filterAndSortFunds applies search, category, and premium ordering", () => {
  const funds = [
    buildFundView({ code: "501225", name: "全球芯片LOF", realtimePremium: "+40.49%" }, 3),
    buildFundView({ code: "161128", name: "标普信息科技LOF", realtimePremium: "+7.93%" }, 3),
    buildFundView({ code: "501088", name: "嘉实顺泽LOF", realtimePremium: "-2.07%" }, 3),
  ];

  const visible = filterAndSortFunds(funds, { query: "lof", category: "all" });
  assert.deepEqual(
    visible.map((fund) => fund.code),
    ["501225", "161128", "501088"],
  );

  const qdii = filterAndSortFunds(funds, { query: "", category: "qdii" });
  assert.deepEqual(
    qdii.map((fund) => fund.code),
    ["501225", "161128"],
  );
});

test("filterAndSortFunds orders by displayed realtime premium descending", () => {
  const funds = [
    buildFundView({ code: "159605", name: "A LOF", realtimePremium: "1.16% test" }, 3),
    buildFundView({ code: "160216", name: "B LOF", realtimePremium: "3.35% test" }, 3),
    buildFundView({ code: "164906", name: "C LOF", realtimePremium: "0.45% test" }, 3),
  ];

  const visible = filterAndSortFunds(funds, { query: "", category: "all" });
  assert.deepEqual(
    visible.map((fund) => fund.code),
    ["160216", "159605", "164906"],
  );
});

test("summarizeFunds returns counts and average premium", () => {
  const funds = [
    buildFundView({ code: "501225", name: "全球芯片LOF", realtimePremium: "+4.00%" }, 3),
    buildFundView({ code: "161128", name: "标普信息科技LOF", realtimePremium: "+2.00%" }, 3),
  ];

  assert.deepEqual(summarizeFunds(funds), {
    total: 2,
    alertCount: 1,
    avgPremium: "3.00%",
  });
});

test("shouldNotifyAlert respects signature changes and cooldown", () => {
  const now = 100000;
  const first = shouldNotifyAlert({
    alertFunds: [{ code: "501225" }],
    lastSignature: "",
    lastAt: 0,
    now,
    cooldownMs: 60000,
  });
  assert.equal(first.notify, true);

  const repeated = shouldNotifyAlert({
    alertFunds: [{ code: "501225" }],
    lastSignature: first.signature,
    lastAt: now,
    now: now + 10000,
    cooldownMs: 60000,
  });
  assert.equal(repeated.notify, false);

  const changed = shouldNotifyAlert({
    alertFunds: [{ code: "501225" }, { code: "161128" }],
    lastSignature: first.signature,
    lastAt: now,
    now: now + 10000,
    cooldownMs: 60000,
  });
  assert.equal(changed.notify, true);
});
