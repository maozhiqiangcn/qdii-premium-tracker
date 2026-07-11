const test = require("node:test");
const assert = require("node:assert/strict");

const {
  OFFICIAL_FUND_NAMES,
  chooseSavedState,
  isFreshEstimate,
  mergePinnedFunds,
  premiumPercent,
  selectDisplayPremium,
} = require("./miniprogram/utils/fund-core");

test("official names include the fixed watchlist", () => {
  assert.equal(OFFICIAL_FUND_NAMES["513100"], "纳指ETF国泰");
  assert.equal(OFFICIAL_FUND_NAMES["501312"], "海外科技LOF");
});

test("premiumPercent uses market price divided by NAV", () => {
  assert.ok(Math.abs(premiumPercent(2.2, 2) - 10) < 1e-9);
  assert.equal(Number.isNaN(premiumPercent(2.2, 0)), true);
});

test("stale estimate is rejected", () => {
  const now = new Date("2026-07-11T03:00:00Z");
  assert.equal(
    isFreshEstimate({ estimate: 2.1, nav: 2, estimateTime: "2026-07-09 15:00" }, now),
    false,
  );
});

test("same-day estimate is accepted unless it is a NAV placeholder", () => {
  const now = new Date("2026-07-11T03:00:00Z");
  assert.equal(
    isFreshEstimate({ estimate: 2.1, nav: 2, estimateTime: "2026-07-11 10:30" }, now),
    true,
  );
  assert.equal(
    isFreshEstimate({ estimate: 2, nav: 2, estimateTime: "2026-07-11 10:30" }, now),
    false,
  );
});

test("display premium prefers a fresh realtime value", () => {
  assert.equal(
    selectDisplayPremium(
      { realtimePremium: "3.20%", latestPremium: "4.10%", realtimeFresh: true },
    ),
    3.2,
  );
  assert.equal(
    selectDisplayPremium(
      { realtimePremium: "3.20%", latestPremium: "4.10%", realtimeFresh: false },
    ),
    4.1,
  );
});

test("saved settings win over pinned defaults", () => {
  const result = mergePinnedFunds(
    [{ code: "513100", note: "我的备注", mode: "manual", nav: 2 }],
    [{ code: "513100", note: "默认", mode: "auto" }, { code: "501312" }],
  );
  assert.equal(result[0].note, "我的备注");
  assert.equal(result[0].mode, "manual");
  assert.equal(result[0].nav, 2);
  assert.equal(result.some((fund) => fund.code === "501312"), true);
});

test("newest savedAt wins during migration", () => {
  const chosen = chooseSavedState([
    { savedAt: "2026-07-01T00:00:00Z", funds: [{ code: "1" }, { code: "2" }] },
    { savedAt: "2026-07-02T00:00:00Z", funds: [{ code: "1" }] },
  ]);
  assert.equal(chosen.savedAt, "2026-07-02T00:00:00Z");
});

test("migration falls back to the largest valid watchlist without timestamps", () => {
  const chosen = chooseSavedState([
    { funds: [{ code: "1" }] },
    { funds: [{ code: "1" }, { code: "2" }] },
  ]);
  assert.equal(chosen.funds.length, 2);
});
