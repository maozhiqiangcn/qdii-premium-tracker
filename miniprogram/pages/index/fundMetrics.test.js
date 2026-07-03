const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildFundView,
  filterAndSortFunds,
  summarizeFunds,
  shouldNotifyAlert,
} = require("./fundMetrics");

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
