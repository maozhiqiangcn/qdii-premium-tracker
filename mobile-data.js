(function (root) {
  const EXTRA_MOBILE_CODES = ["501312"];

  function mergeFundsByCode(...groups) {
    const order = [];
    const byCode = new Map();

    for (const group of groups) {
      for (const fund of group || []) {
        const code = String(fund?.code || "").trim();
        if (!code) continue;
        if (!byCode.has(code)) order.push(code);
        byCode.set(code, { ...byCode.get(code), ...fund, code });
      }
    }

    return order.map((code) => byCode.get(code));
  }

  function createHaoEtfUrl(apiOrigin, codes = []) {
    const url = new URL("/api/haoetf", apiOrigin);
    const normalizedCodes = codes.map((code) => String(code).trim()).filter(Boolean);
    if (normalizedCodes.length) url.searchParams.set("codes", normalizedCodes.join(","));
    url.searchParams.set("_", Date.now());
    return url.toString();
  }

  function buildExtraFundRow({ estimate, quote }) {
    const code = String(estimate?.code || quote?.code || "").trim();
    const nav = toNumber(estimate?.nav);
    const realtimeNav = toNumber(estimate?.estimate) || nav;
    const price = toNumber(quote?.price);
    const realtimePremium = percentage(price, realtimeNav);
    const latestPremium = percentage(price, nav);

    return {
      code,
      name: quote?.name || estimate?.name || code,
      realtimeEstimate: formatNumber(realtimeNav, 4),
      realtimePremium: formatPercent(realtimePremium),
      latestEstimate: formatNumber(nav, 4),
      latestPremium: formatPercent(latestPremium),
      estimateDate: compactDate(estimate?.navDate || estimate?.estimateTime),
      price: formatNumber(price, 3),
      pricePct: formatPercent(toNumber(quote?.pct), true),
      turnoverWan: formatNumber(toNumber(quote?.turnoverWan), 2),
      nav: formatNumber(nav, 4),
      navDate: compactDate(estimate?.navDate),
    };
  }

  function percentage(value, base) {
    if (!Number.isFinite(value) || !Number.isFinite(base) || base === 0) return NaN;
    return (value / base - 1) * 100;
  }

  function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : NaN;
  }

  function formatNumber(value, digits) {
    return Number.isFinite(value) ? value.toFixed(digits) : "";
  }

  function formatPercent(value, signed = false) {
    if (!Number.isFinite(value)) return "";
    const prefix = signed && value > 0 ? "+" : "";
    return `${prefix}${value.toFixed(2)}%`;
  }

  function compactDate(value) {
    const match = String(value || "").match(/(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[2]}-${match[3]}` : "";
  }

  function createSettingsSnapshot(state) {
    return {
      alertEnabled: state.alertEnabled !== false,
      threshold: Number(state.threshold) || 0,
      lastAlertAt: Number(state.lastAlertAt) || 0,
      lastAlertSignature: String(state.lastAlertSignature || ""),
    };
  }

  const api = {
    EXTRA_MOBILE_CODES,
    buildExtraFundRow,
    createHaoEtfUrl,
    createSettingsSnapshot,
    mergeFundsByCode,
  };

  root.LOF_MOBILE_DATA = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
