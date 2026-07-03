const STORAGE_KEY = "qdii-premium-tracker-v2";
const OLD_STORAGE_KEY = "qdii-premium-tracker";
const AUTO_REFRESH_MS = 60_000;
const LOCAL_API_ORIGIN = "http://127.0.0.1:8766";
const CLOUD_API_ORIGIN = "https://flask-7ux0-271799-9-1444624345.sh.run.tcloudbase.com";
const API_ORIGIN =
  window.LOF_API_ORIGIN ||
  (location.hostname === "127.0.0.1" || location.hostname === "localhost" ? LOCAL_API_ORIGIN : CLOUD_API_ORIGIN);

const text = {
  nasdaq100: "\u7eb3\u65af\u8fbe\u514b100",
  sp500: "\u6807\u666e500",
  custom: "\u81ea\u5b9a\u4e49",
  auto: "\u81ea\u52a8",
  manual: "\u624b\u52a8",
};

const marketState = {
  spot: null,
  future: null,
  usdCnh: null,
  lastRefresh: "",
  status: "\u672a\u5237\u65b0",
};

let state = loadState();

const els = {
  addFundBtn: document.querySelector("#addFundBtn"),
  alertThreshold: document.querySelector("#alertThreshold"),
  avgPremium: document.querySelector("#avgPremium"),
  emptyState: document.querySelector("#emptyState"),
  fundTable: document.querySelector("#fundTable"),
  highPremium: document.querySelector("#highPremium"),
  lastSaved: document.querySelector("#lastSaved"),
  nasdaqFuture: document.querySelector("#nasdaqFuture"),
  nasdaqFutureMeta: document.querySelector("#nasdaqFutureMeta"),
  nasdaqSpot: document.querySelector("#nasdaqSpot"),
  nasdaqSpotMeta: document.querySelector("#nasdaqSpotMeta"),
  quoteStatus: document.querySelector("#quoteStatus"),
  quoteTime: document.querySelector("#quoteTime"),
  refreshBtn: document.querySelector("#refreshBtn"),
  rowTemplate: document.querySelector("#rowTemplate"),
  searchInput: document.querySelector("#searchInput"),
  sortBy: document.querySelector("#sortBy"),
  targetFilter: document.querySelector("#targetFilter"),
  totalCount: document.querySelector("#totalCount"),
  usdCnh: document.querySelector("#usdCnh"),
  usdCnhMeta: document.querySelector("#usdCnhMeta"),
};

els.alertThreshold.value = state.threshold;

render();
refreshQuotes();
setInterval(refreshQuotes, AUTO_REFRESH_MS);

els.addFundBtn.addEventListener("click", () => {
  state.funds.unshift({
    code: "",
    name: "",
    target: els.targetFilter.value === "all" ? "nasdaq100" : els.targetFilter.value,
    mode: "auto",
    price: "",
    nav: "",
    note: "",
    quote: null,
  });
  persist();
  render();
});

els.refreshBtn.addEventListener("click", refreshQuotes);

[els.searchInput, els.targetFilter, els.sortBy].forEach((el) => {
  el.addEventListener("input", render);
});

els.alertThreshold.addEventListener("input", () => {
  state.threshold = numberOrZero(els.alertThreshold.value);
  persist();
  render();
});

async function refreshQuotes() {
  setStatus("\u5237\u65b0\u4e2d...");

  try {
    const autoFunds = state.funds.filter((fund) => fund.mode !== "manual" && normalizeCode(fund.code));
    const marketPromise = loadEastmoneyQuotes(["100.NDX", "103.NQ00Y", "133.USDCNH", ...autoFunds.map(eastmoneySecid)]);
    const haoEtfPromise = loadHaoEtf(autoFunds.map((fund) => normalizeCode(fund.code)));
    const navPromise = loadFundEstimates(autoFunds.map((fund) => normalizeCode(fund.code)));
    const officialNavPromises = autoFunds.map((fund) => loadOfficialEtfNav(normalizeCode(fund.code)));
    const [marketQuotes, haoEtfQuotes, navQuotes, officialQuotes] = await Promise.allSettled([
      marketPromise,
      haoEtfPromise,
      navPromise,
      Promise.allSettled(officialNavPromises),
    ]);

    const eastmoneyQuotes = marketQuotes.status === "fulfilled" ? marketQuotes.value : {};
    marketState.spot = parseEastmoneyQuote(eastmoneyQuotes["100.NDX"]);
    marketState.future = parseEastmoneyQuote(eastmoneyQuotes["103.NQ00Y"]);
    marketState.usdCnh = parseEastmoneyQuote(eastmoneyQuotes["133.USDCNH"]);
    const haoEtfMap = haoEtfQuotes.status === "fulfilled" ? haoEtfQuotes.value : {};

    autoFunds.forEach((fund, index) => {
      const tradeQuote = parseEastmoneyQuote(eastmoneyQuotes[eastmoneySecid(fund)]);
      const haoEtfQuote = haoEtfMap[normalizeCode(fund.code)] || null;
      const navQuote = navQuotes.status === "fulfilled" && navQuotes.value[index]?.code === normalizeCode(fund.code)
        ? navQuotes.value[index]
        : null;
      const officialResult = officialQuotes.status === "fulfilled" ? officialQuotes.value[index] : null;
      const officialQuote = officialResult?.status === "fulfilled" ? officialResult.value : null;
      const selectedNav = toNumberOrNull(haoEtfQuote?.realtimeEstimate) || toNumberOrNull(haoEtfQuote?.latestEstimate) || officialQuote?.nav || navQuote?.estimate || navQuote?.nav;

      fund.quote = {
        haoetf: haoEtfQuote,
        official: officialQuote,
        trade: tradeQuote,
        nav: navQuote,
        updatedAt: new Date().toISOString(),
      };

      if (toNumberOrNull(haoEtfQuote?.price)) fund.price = toNumberOrNull(haoEtfQuote.price);
      else if (tradeQuote?.price) fund.price = tradeQuote.price;
      if (selectedNav) fund.nav = selectedNav;
      else fund.nav = "";
      if (!fund.name && (haoEtfQuote?.name || tradeQuote?.name || officialQuote?.name || navQuote?.name)) {
        fund.name = haoEtfQuote?.name || tradeQuote?.name || officialQuote?.name || navQuote?.name;
      }
    });

    marketState.lastRefresh = new Date().toISOString();
    setStatus(marketQuotes.status === "fulfilled" ? "\u5df2\u66f4\u65b0" : "\u90e8\u5206\u66f4\u65b0");
    persist();
  } catch (error) {
    console.error(error);
    setStatus("\u63a5\u53e3\u5931\u8d25");
  }

  render();
}

function render() {
  renderMarket();
  const funds = visibleFunds();
  els.fundTable.replaceChildren(...funds.map(createRow));
  els.emptyState.hidden = funds.length > 0;
  updateStats();
}

function renderMarket() {
  renderMarketTile(els.nasdaqSpot, els.nasdaqSpotMeta, marketState.spot);
  renderMarketTile(els.nasdaqFuture, els.nasdaqFutureMeta, marketState.future);
  renderMarketTile(els.usdCnh, els.usdCnhMeta, marketState.usdCnh, 4);
  els.quoteStatus.textContent = marketState.status;
  els.quoteTime.textContent = marketState.lastRefresh ? formatTime(marketState.lastRefresh) : "--";
}

function renderMarketTile(valueEl, metaEl, quote, digits = 2) {
  valueEl.textContent = quote?.value ? Number(quote.value).toFixed(digits) : "--";
  valueEl.className = quote?.pct > 0 ? "up" : quote?.pct < 0 ? "down" : "";
  metaEl.textContent = quote ? `${signedPct(quote.pct)} ${quote.time || ""}` : "--";
}

function createRow(fund) {
  const row = els.rowTemplate.content.firstElementChild.cloneNode(true);
  const metrics = getFundMetrics(fund);

  row.querySelectorAll("[data-key]").forEach((input) => {
    const key = input.dataset.key;
    input.value = fund[key] ?? "";
    input.addEventListener("input", () => {
      fund[key] = input.type === "number" ? numberOrEmpty(input.value) : input.value;
      if (key === "mode" && fund.mode === "manual") fund.quote = null;
      persist();
      render();
    });
  });

  setText(row, ".latest-estimate", metrics.latestEstimate);
  setPercent(row, ".latest-premium", metrics.latestPremium);
  setText(row, ".realtime-estimate", metrics.realtimeEstimate);
  setPercent(row, ".realtime-premium", metrics.realtimePremium);
  setText(row, ".price", metrics.price);
  setPercent(row, ".price-pct", metrics.pricePct);
  setText(row, ".estimate-date", metrics.estimateDate);
  setText(row, ".nav-info", metrics.navInfo);
  setText(row, ".quote-meta", metrics.source);

  if (Number.isFinite(metrics.sortPremium) && metrics.sortPremium >= state.threshold) {
    row.classList.add("alert");
  }

  row.querySelector(".remove").addEventListener("click", () => {
    state.funds = state.funds.filter((item) => item !== fund);
    persist();
    render();
  });

  return row;
}

function visibleFunds() {
  const query = els.searchInput.value.trim().toLowerCase();
  const target = els.targetFilter.value;

  return state.funds
    .filter((fund) => {
      const targetName = text[fund.target] || fund.target || "";
      const source = `${fund.code} ${fund.name} ${targetName}`.toLowerCase();
      return (!query || source.includes(query)) && (target === "all" || fund.target === target);
    })
    .sort((a, b) => {
      const sortBy = els.sortBy.value;
      if (sortBy === "premiumAsc") return comparePremium(a, b);
      if (sortBy === "codeAsc") return String(a.code).localeCompare(String(b.code), "zh-CN");
      if (sortBy === "nameAsc") return String(a.name).localeCompare(String(b.name), "zh-CN");
      return comparePremium(b, a);
    });
}

function updateStats() {
  const premiums = state.funds.map((fund) => getFundMetrics(fund).sortPremium).filter(Number.isFinite);
  const highCount = premiums.filter((item) => item >= state.threshold).length;
  const avg = premiums.reduce((sum, item) => sum + item, 0) / premiums.length;

  els.totalCount.textContent = state.funds.length;
  els.avgPremium.textContent = Number.isFinite(avg) ? `${avg.toFixed(2)}%` : "--";
  els.highPremium.textContent = highCount;
  els.lastSaved.textContent = state.savedAt ? formatTime(state.savedAt) : "--";
}

function calculateLiveNav(fund) {
  const baseNav = Number(fund.nav);
  if (!baseNav) return { value: NaN, meta: "\u7b49\u5f85\u4f30\u503c" };

  if (fund.mode === "manual") {
    return { value: baseNav, meta: "\u624b\u52a8\u503c" };
  }

  const officialQuote = fund.quote?.official;
  if (officialQuote?.nav) {
    const tags = [
      officialQuote.source,
      officialQuote.tradingDay,
      `IOPV:${officialQuote.publishIopv || "-"}`,
    ].filter(Boolean);
    return { value: baseNav, meta: tags.join(" / ") };
  }

  const navQuote = fund.quote?.nav;
  const estimateTime = navQuote?.estimateTime || navQuote?.navDate || "";
  return {
    value: baseNav,
    meta: estimateTime ? `\u5929\u5929\u57fa\u91d1 ${estimateTime}` : "\u57fa\u91d1\u4f30\u503c",
  };
}

function calculatePremium(fund, liveNavValue) {
  const price = Number(fund.price);
  const nav = Number(liveNavValue);
  if (!price || !nav) return NaN;
  return (price / nav - 1) * 100;
}

function getFundMetrics(fund) {
  const hao = fund.quote?.haoetf;
  if (hao) {
    const realtimePremium = pctNumber(hao.realtimePremium);
    const latestPremium = pctNumber(hao.latestPremium);
    return {
      latestEstimate: hao.latestEstimate || "--",
      latestPremium: hao.latestPremium || "--",
      realtimeEstimate: hao.realtimeEstimate || "--",
      realtimePremium: hao.realtimePremium || "--",
      price: hao.price || formatNumber(fund.price, 3),
      pricePct: hao.pricePct || "--",
      estimateDate: hao.estimateDate || "--",
      navInfo: [hao.nav, hao.navDate].filter(Boolean).join(" / ") || "--",
      source: "HaoETF",
      sortPremium: Number.isFinite(realtimePremium) ? realtimePremium : latestPremium,
    };
  }

  const liveNav = calculateLiveNav(fund);
  const premium = calculatePremium(fund, liveNav.value);
  const navQuote = fund.quote?.nav;
  const latestEstimate = navQuote?.nav || fund.nav;
  const realtimeEstimate = hasFreshFundEstimate(navQuote) ? navQuote.estimate : null;
  const latestPremium = calculatePremium(fund, latestEstimate);
  const realtimePremium = calculatePremium(fund, realtimeEstimate);
  return {
    latestEstimate: formatNumber(latestEstimate, 4),
    latestPremium: Number.isFinite(latestPremium) ? `${latestPremium.toFixed(2)}%` : "--",
    realtimeEstimate: realtimeEstimate ? formatNumber(realtimeEstimate, 4) : "--",
    realtimePremium: Number.isFinite(realtimePremium) ? `${realtimePremium.toFixed(2)}%` : "--",
    price: formatNumber(fund.price, 3),
    pricePct: fund.quote?.trade ? signedPct(fund.quote.trade.pct) : "--",
    estimateDate: navQuote?.navDate || "--",
    navInfo: [formatNumber(navQuote?.nav || fund.nav, 4), navQuote?.navDate].filter(Boolean).join(" / ") || "--",
    source: liveNav.meta,
    sortPremium: premium,
  };
}

function hasFreshFundEstimate(navQuote) {
  if (!navQuote?.estimate || !navQuote?.estimateTime) return false;
  if (navQuote.nav && Math.abs(navQuote.estimate - navQuote.nav) < 0.000001) return false;
  return true;
}

function setText(row, selector, value) {
  const el = row.querySelector(selector);
  if (el) el.textContent = value || "--";
}

function setPercent(row, selector, value) {
  const el = row.querySelector(selector);
  if (!el) return;
  el.textContent = value || "--";
  el.className = `${selector.slice(1)} ${premiumClass(pctNumber(value))}`;
}

function comparePremium(a, b) {
  const premiumA = getFundMetrics(a).sortPremium;
  const premiumB = getFundMetrics(b).sortPremium;
  if (!Number.isFinite(premiumA)) return 1;
  if (!Number.isFinite(premiumB)) return -1;
  return premiumA - premiumB;
}

function premiumClass(premium) {
  if (!Number.isFinite(premium)) return "neutral";
  if (premium > 0) return "positive";
  if (premium < 0) return "negative";
  return "neutral";
}

async function loadEastmoneyQuotes(secids) {
  const uniqueSecids = [...new Set(secids.filter(Boolean))];
  if (!uniqueSecids.length) return {};

  const fields = "f12,f14,f2,f3,f4,f6,f58";
  const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${uniqueSecids.join(",")}&fields=${fields}&_=${Date.now()}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error("Eastmoney quote request failed");

  const payload = await response.json();
  const quotes = {};
  for (const quote of payload?.data?.diff || []) {
    const secid = uniqueSecids.find((item) => item.endsWith(`.${quote.f12}`));
    if (secid) quotes[secid] = quote;
  }
  return quotes;
}

async function loadHaoEtf(codes) {
  const cleanCodes = [...new Set(codes.filter(Boolean))];
  if (!cleanCodes.length) return {};

  const response = await fetch(`${API_ORIGIN}/api/haoetf?codes=${cleanCodes.join(",")}&_=${Date.now()}`);
  if (!response.ok) throw new Error("HaoETF request failed");

  const payload = await response.json();
  const funds = payload?.data?.funds || [];
  return Object.fromEntries(funds.map((fund) => [fund.code, fund]));
}

async function loadOfficialEtfNav(code) {
  if (!code.startsWith("5") || !location.origin.startsWith("http://127.0.0.1:8766")) {
    return null;
  }

  const response = await fetch(`/api/sse-etf?code=${code}&_=${Date.now()}`);
  if (!response.ok) throw new Error(`SSE ETF NAV failed: ${code}`);

  const payload = await response.json();
  const row = payload?.data;
  if (!payload?.ok || !row) return null;

  return {
    code,
    name: row.FUND_NAME,
    nav: moneyToNumber(row.NAV),
    navPerCu: moneyToNumber(row.NAVPERCU),
    tradingDay: formatCompactDate(row.TRADING_DAY),
    previousTradingDay: formatCompactDate(row.PRE_TRADING_DAY),
    publishIopv: row.PUBLISH_IOPV,
    creationRedemption: row.CREATION_REDEMPTION,
    source: "\u4e0a\u4ea4\u6240\u7533\u8d4e\u6e05\u5355",
  };
}

function loadFundEstimate(code) {
  return new Promise((resolve, reject) => {
    const callbackName = "jsonpgz";
    const previous = window[callbackName];
    const script = document.createElement("script");
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Fund estimate timeout: ${code}`));
    }, 8000);

    window[callbackName] = (data) => {
      cleanup();
      resolve({
        code: data.fundcode,
        name: data.name,
        nav: toNumber(data.dwjz),
        navDate: data.jzrq,
        estimate: toNumber(data.gsz),
        estimatePct: toNumber(data.gszzl),
        estimateTime: data.gztime,
      });
    };

    script.src = `https://fundgz.1234567.com.cn/js/${code}.js?rt=${Date.now()}`;
    script.charset = "utf-8";
    script.onerror = () => {
      cleanup();
      reject(new Error(`Fund estimate failed: ${code}`));
    };

    function cleanup() {
      clearTimeout(timer);
      script.remove();
      if (previous) window[callbackName] = previous;
      else delete window[callbackName];
    }

    document.body.appendChild(script);
  });
}

async function loadFundEstimates(codes) {
  const quotes = [];
  for (const code of codes) {
    try {
      quotes.push(await loadFundEstimate(code));
    } catch (error) {
      console.warn(error);
      quotes.push(null);
    }
  }
  return quotes;
}

function parseEastmoneyQuote(raw) {
  if (!raw) return null;
  return {
    name: raw.f14,
    value: toNumber(raw.f2),
    price: toNumber(raw.f2),
    pct: toNumber(raw.f3),
    time: "",
  };
}

function eastmoneySecid(fund) {
  const code = normalizeCode(fund.code);
  if (!code) return "";
  return `${code.startsWith("5") ? "1" : "0"}.${code}`;
}

function normalizeCode(code) {
  return String(code || "").replace(/\D/g, "").slice(0, 6);
}

function percentFrom(value, base) {
  if (!value || !base) return 0;
  return (value / base - 1) * 100;
}

function signedPct(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return `${number >= 0 ? "+" : ""}${number.toFixed(2)}%`;
}

function setStatus(status) {
  marketState.status = status;
  renderMarket();
}

function persist() {
  state.savedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState() {
  const fallback = {
    funds: [
      {
        code: "513100",
        name: "\u7eb3\u6307ETF\u56fd\u6cf0",
        target: "nasdaq100",
        mode: "auto",
        price: "",
        nav: "",
        note: "\u53ef\u66ff\u6362\u6210\u4f60\u8981\u8ddf\u8e2a\u7684QDII",
        quote: null,
      },
    ],
    savedAt: "",
    threshold: 3,
  };

  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.funds) return normalizeState({ ...fallback, ...saved });

    const oldSaved = JSON.parse(localStorage.getItem(OLD_STORAGE_KEY));
    if (oldSaved?.funds) {
      return normalizeState({
        ...fallback,
        ...oldSaved,
        funds: oldSaved.funds.map((fund) => ({
          ...fund,
          target: normalizeTarget(fund.target || fund.type),
          mode: "auto",
          quote: null,
        })),
      });
    }

    return fallback;
  } catch {
    return fallback;
  }
}

function normalizeState(input) {
  return {
    ...input,
    funds: input.funds.map((fund) => ({
      code: normalizeCode(fund.code),
      name: fund.name || "",
      target: normalizeTarget(fund.target),
      mode: fund.mode === "manual" ? "manual" : "auto",
      price: fund.price ?? "",
      nav: fund.nav ?? "",
      note: fund.note || "",
      quote: fund.quote || null,
    })),
  };
}

function normalizeTarget(value) {
  const source = String(value || "").toLowerCase();
  if (source.includes("500") || source.includes("sp")) return "sp500";
  if (source.includes("custom") || source.includes("\u81ea\u5b9a\u4e49")) return "custom";
  return "nasdaq100";
}

function formatTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function toNumberOrNull(value) {
  const number = Number(String(value || "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) && value !== "" && value != null ? number : null;
}

function pctNumber(value) {
  const number = toNumberOrNull(value);
  return number == null ? NaN : number;
}

function formatNumber(value, digits) {
  const number = Number(value);
  return Number.isFinite(number) && number ? number.toFixed(digits) : "--";
}

function moneyToNumber(value) {
  const number = Number(String(value || "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function formatCompactDate(value) {
  const text = String(value || "");
  if (!/^\d{8}$/.test(text)) return text;
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

function numberOrEmpty(value) {
  return value === "" ? "" : Number(value);
}

function numberOrZero(value) {
  return Number(value) || 0;
}
