const CATEGORY_LABELS = {
  all: "全部",
  qdii: "QDII-LOF",
  index: "指数型LOF",
  fund: "普通LOF",
  alert: "提醒",
};

function buildFundView(rawFund, threshold) {
  const realtimePremium = parsePercent(rawFund.realtimePremium);
  const latestPremium = parsePercent(rawFund.latestPremium);
  const pricePct = parsePercent(rawFund.pricePct);
  const sortPremium = selectDisplayPremium(rawFund);
  const category = getCategory(rawFund);

  return {
    ...rawFund,
    name: OFFICIAL_FUND_NAMES[String(rawFund.code || "")] || rawFund.name,
    category,
    categoryLabel: CATEGORY_LABELS[category] || "LOF",
    alert: Number.isFinite(sortPremium) && sortPremium >= threshold,
    latestPremiumClass: percentClass(latestPremium),
    pricePctClass: percentClass(pricePct),
    realtimePremiumClass: percentClass(realtimePremium),
    sortPremium,
  };
}

function filterAndSortFunds(funds, options) {
  const query = String(options.query || "").trim().toLowerCase();
  const category = options.category || "all";

  return funds
    .filter((fund) => {
      const haystack = `${fund.code || ""} ${fund.name || ""} ${fund.categoryLabel || ""}`.toLowerCase();
      const matchesQuery = !query || haystack.includes(query);
      const matchesCategory =
        category === "all" ||
        (category === "alert" && fund.alert) ||
        fund.category === category;
      return matchesQuery && matchesCategory;
    })
    .sort(comparePremiumDesc);
}

function summarizeFunds(funds) {
  const premiums = funds.map((fund) => fund.sortPremium).filter(Number.isFinite);
  const avg = premiums.reduce((sum, value) => sum + value, 0) / premiums.length;

  return {
    total: funds.length,
    alertCount: funds.filter((fund) => fund.alert).length,
    avgPremium: Number.isFinite(avg) ? `${avg.toFixed(2)}%` : "--",
  };
}

function shouldNotifyAlert({ alertFunds, lastSignature, lastAt, now, cooldownMs }) {
  const signature = alertFunds
    .map((fund) => fund.code)
    .filter(Boolean)
    .sort()
    .join(",");

  if (!signature) return { notify: false, signature };
  if (signature !== lastSignature) return { notify: true, signature };
  return { notify: now - lastAt >= cooldownMs, signature };
}

function percentClass(value) {
  if (!Number.isFinite(value)) return "neutral";
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

function getCategory(fund) {
  const text = `${fund.code || ""} ${fund.name || ""}`.toLowerCase();
  if (
    text.includes("qdii") ||
    /全球|海外|纳指|标普|美国|德国|印度|日本|日经|越南|香港|恒生|港美|黄金|油气/.test(text)
  ) {
    return "qdii";
  }
  if (text.includes("指数") || text.includes("标普") || text.includes("纳指") || text.includes("中证")) return "index";
  return "fund";
}

module.exports = {
  buildFundView,
  filterAndSortFunds,
  summarizeFunds,
  shouldNotifyAlert,
};
const {
  OFFICIAL_FUND_NAMES,
  comparePremiumDesc,
  parsePercent,
  selectDisplayPremium,
} = require("../../utils/fund-core");
