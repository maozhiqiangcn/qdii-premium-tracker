const test = require("node:test");
const assert = require("node:assert/strict");

const { EXTRA_MOBILE_CODES, buildExtraFundRow, mergeFundsByCode, createHaoEtfUrl } = require("./mobile-data");

test("mobile extra fund codes include 501312", () => {
  assert.equal(EXTRA_MOBILE_CODES.includes("501312"), true);
});

test("mergeFundsByCode appends extra funds without dropping existing rows", () => {
  const merged = mergeFundsByCode(
    [{ code: "513100", name: "nasdaq" }],
    [{ code: "501312", name: "tech" }],
  );

  assert.deepEqual(
    merged.map((fund) => fund.code),
    ["513100", "501312"],
  );
});

test("createHaoEtfUrl adds codes query only when codes are supplied", () => {
  assert.equal(createHaoEtfUrl("https://example.com", []).startsWith("https://example.com/api/haoetf?_="), true);
  assert.match(createHaoEtfUrl("https://example.com", ["501312"]), /^https:\/\/example\.com\/api\/haoetf\?codes=501312&_=/);
});

test("buildExtraFundRow creates a visible 501312 row from NAV and market quote", () => {
  const row = buildExtraFundRow({
    estimate: {
      code: "501312",
      nav: 2.1173,
      navDate: "2026-07-02",
      estimate: 2.1173,
      estimateTime: "2026-07-03 04:00",
    },
    quote: {
      code: "501312",
      name: "海外科技LOF",
      price: 2.367,
      pct: 0.17,
      turnoverWan: 7758.32,
    },
  });

  assert.equal(row.code, "501312");
  assert.equal(row.name, "海外科技LOF");
  assert.equal(row.price, "2.367");
  assert.equal(row.latestEstimate, "2.1173");
  assert.equal(row.latestPremium, "11.79%");
  assert.equal(row.estimateDate, "07-02");
});
