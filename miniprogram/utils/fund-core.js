(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.LOF_FUND_CORE = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const OFFICIAL_FUND_NAMES = Object.freeze({
    161130: "纳斯达克100LOF",
    161128: "标普信息科技LOF",
    161125: "标普500LOF",
    513500: "标普500ETF博时",
    159696: "纳指ETF易方达",
    159501: "纳指ETF嘉实",
    513100: "纳指ETF国泰",
    501312: "海外科技LOF",
    159941: "纳指ETF",
    159659: "纳斯达克100ETF",
  });

  function parsePercent(value) {
    const number = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
    return Number.isFinite(number) ? number : NaN;
  }

  function premiumPercent(price, nav) {
    const priceNumber = Number(price);
    const navNumber = Number(nav);
    if (!Number.isFinite(priceNumber) || !Number.isFinite(navNumber) || navNumber === 0) return NaN;
    return (priceNumber / navNumber - 1) * 100;
  }

  function chinaDate(value = new Date()) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(value);
  }

  function isFreshEstimate(quote, now = new Date()) {
    const estimate = Number(quote?.estimate);
    const nav = Number(quote?.nav);
    const estimateTime = String(quote?.estimateTime || "");
    const dateMatch = estimateTime.match(/^(\d{4}-\d{2}-\d{2})/);
    if (!Number.isFinite(estimate) || !dateMatch || dateMatch[1] !== chinaDate(now)) return false;
    if (Number.isFinite(nav) && Math.abs(estimate - nav) < 0.000001) return false;
    return true;
  }

  function selectDisplayPremium(fund) {
    const realtime = parsePercent(fund?.realtimePremium);
    if (fund?.realtimeFresh !== false && Number.isFinite(realtime)) return realtime;
    return parsePercent(fund?.latestPremium);
  }

  function comparePremiumDesc(a, b) {
    const premiumA = selectDisplayPremium(a);
    const premiumB = selectDisplayPremium(b);
    if (!Number.isFinite(premiumA)) return 1;
    if (!Number.isFinite(premiumB)) return -1;
    if (premiumB !== premiumA) return premiumB - premiumA;
    return String(a?.code || "").localeCompare(String(b?.code || ""), "zh-CN");
  }

  function chooseSavedState(candidates) {
    const valid = (candidates || []).filter((candidate) => Array.isArray(candidate?.funds) && candidate.funds.length);
    if (!valid.length) return null;
    return [...valid].sort((a, b) => {
      const timeA = Date.parse(a.savedAt || "");
      const timeB = Date.parse(b.savedAt || "");
      if (Number.isFinite(timeA) || Number.isFinite(timeB)) {
        return (Number.isFinite(timeB) ? timeB : 0) - (Number.isFinite(timeA) ? timeA : 0);
      }
      return b.funds.length - a.funds.length;
    })[0];
  }

  function mergePinnedFunds(savedFunds, pinnedFunds) {
    const order = [];
    const byCode = new Map();
    for (const fund of savedFunds || []) {
      const code = String(fund?.code || "").trim();
      if (!code) continue;
      if (!byCode.has(code)) order.push(code);
      byCode.set(code, { ...fund, code });
    }
    for (const fund of pinnedFunds || []) {
      const code = String(fund?.code || "").trim();
      if (!code || byCode.has(code)) continue;
      order.push(code);
      byCode.set(code, { ...fund, code });
    }
    return order.map((code) => byCode.get(code));
  }

  return {
    OFFICIAL_FUND_NAMES,
    chooseSavedState,
    comparePremiumDesc,
    isFreshEstimate,
    mergePinnedFunds,
    parsePercent,
    premiumPercent,
    selectDisplayPremium,
  };
});
