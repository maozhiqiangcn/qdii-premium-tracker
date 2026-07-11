const API_ORIGIN =
  window.LOF_API_ORIGIN ||
  (location.hostname === "127.0.0.1" || location.hostname === "localhost"
    ? location.origin
    : "https://flask-7ux0-271799-9-1444624345.sh.run.tcloudbase.com");
const AUTO_REFRESH_MS = 60_000;
const ALERT_COOLDOWN_MS = 5 * 60_000;
const STORAGE_KEY = "lof-mobile-settings-v2";
const LEGACY_STORAGE_KEY = "lof-mobile-settings-v1";
const SNAPSHOT_KEY = "lof-mobile-last-success-v1";
const fundCore = window.LOF_FUND_CORE;
const clientRuntime = window.LOF_CLIENT_RUNTIME;
let refreshInFlight = false;
const mobileData = window.LOF_MOBILE_DATA || {
  EXTRA_MOBILE_CODES: [],
  createHaoEtfUrl: (apiOrigin) => `${apiOrigin}/api/haoetf?_=${Date.now()}`,
  mergeFundsByCode: (...groups) => groups.flat(),
};

const OFFICIAL_FUND_NAMES = fundCore.OFFICIAL_FUND_NAMES;

const categories = [
  { key: "all", label: "全部" },
  { key: "fund", label: "股票型LOF" },
  { key: "index", label: "指数型LOF" },
  { key: "qdii", label: "QDII-LOF" },
  { key: "alert", label: "提醒" },
];

const state = {
  activeCategory: "all",
  alertEnabled: true,
  funds: [],
  lastAlertAt: 0,
  lastAlertSignature: "",
  query: "",
  threshold: 3,
};

const els = {
  alertToggle: document.querySelector("#alertToggle"),
  emptyState: document.querySelector("#emptyState"),
  errorBox: document.querySelector("#errorBox"),
  dataNotice: document.querySelector("#dataNotice"),
  estimateChange: document.querySelector("#estimateChange"),
  fundList: document.querySelector("#fundList"),
  refreshBtn: document.querySelector("#refreshBtn"),
  searchInput: document.querySelector("#searchInput"),
  statusText: document.querySelector("#statusText"),
  summaryText: document.querySelector("#summaryText"),
  tabs: document.querySelector("#tabs"),
  thresholdInput: document.querySelector("#thresholdInput"),
  totalCount: document.querySelector("#totalCount"),
  updatedAt: document.querySelector("#updatedAt"),
  visibleCount: document.querySelector("#visibleCount"),
};

loadSettings();
renderTabs();
bindEvents();
refreshFunds();
setInterval(refreshFunds, AUTO_REFRESH_MS);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

function bindEvents() {
  els.refreshBtn.addEventListener("click", refreshFunds);
  els.searchInput.addEventListener("input", () => {
    state.query = els.searchInput.value;
    render();
  });
  els.thresholdInput.addEventListener("input", () => {
    state.threshold = Math.max(0, Number(els.thresholdInput.value) || 0);
    state.funds = state.funds.map((fund) => buildFundView(fund));
    saveSettings();
    render();
  });
  els.alertToggle.addEventListener("click", async () => {
    state.alertEnabled = !state.alertEnabled;
    if (state.alertEnabled) await requestNotificationPermission();
    saveSettings();
    render();
  });
}

async function refreshFunds() {
  if (refreshInFlight) return;
  refreshInFlight = true;
  setStatus("更新中");
  els.errorBox.hidden = true;
  els.dataNotice.hidden = true;
  els.refreshBtn.disabled = true;

  try {
    let payload;
    let networkError;
    try {
      payload = await clientRuntime.fetchJsonWithRetry(`${API_ORIGIN}/api/haoetf?_=${Date.now()}`);
      if (!payload?.ok) throw new Error(payload?.error || "接口返回失败");
      clientRuntime.saveSnapshot(localStorage, SNAPSHOT_KEY, payload);
    } catch (error) {
      networkError = error;
      payload = clientRuntime.loadSnapshot(localStorage, SNAPSHOT_KEY);
    }
    if (!payload?.ok) throw networkError || new Error("接口返回失败");

    const usingSnapshot = Boolean(networkError);
    const payloadIsStale = usingSnapshot || payload.stale;
    state.funds = (payload.data?.funds || [])
      .map((fund) =>
        payloadIsStale
          ? { ...fund, realtimeEstimate: "", realtimePremium: "", realtimeFresh: false }
          : fund,
      )
      .map(buildFundView);
    setStatus(payloadIsStale ? "缓存数据" : "运行中");
    els.updatedAt.textContent = formatPayloadTime(payload);
    renderDataNotice(payload, payloadIsStale, networkError);
    render();
    maybeNotify();
  } catch (error) {
    setStatus("异常");
    els.errorBox.textContent = `刷新失败：${formatError(error)}`;
    els.errorBox.hidden = false;
  } finally {
    refreshInFlight = false;
    els.refreshBtn.disabled = false;
  }
}

function render() {
  const visibleFunds = filterAndSortFunds();
  const summary = summarizeFunds(state.funds);

  els.totalCount.textContent = summary.total;
  els.estimateChange.textContent = calculateEstimateChange(state.funds);
  els.summaryText.textContent = `筛选：溢价 >= ${state.threshold}%｜平均溢价 ${summary.avgPremium}`;
  els.visibleCount.textContent = `共 ${visibleFunds.length} 条`;
  els.alertToggle.textContent = state.alertEnabled ? "提醒开" : "提醒关";
  els.alertToggle.classList.toggle("secondary", true);

  renderTabs();
  els.fundList.replaceChildren(...visibleFunds.map(createFundCard));
  els.emptyState.hidden = visibleFunds.length > 0;
}

function renderTabs() {
  els.tabs.replaceChildren(
    ...categories.map((category) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = category.label;
      button.className = category.key === state.activeCategory ? "active" : "";
      button.addEventListener("click", () => {
        state.activeCategory = category.key;
        render();
      });
      return button;
    }),
  );
}

function createFundCard(fund) {
  const card = document.createElement("article");
  card.className = `fund-card${fund.alert ? " alert" : ""}`;
  card.innerHTML = `
    <div class="fund-main">
      <div class="fund-name">
        <span class="name">${escapeHtml(fund.name || "未命名基金")}</span>
        <div class="meta-row">
          <span class="code">${escapeHtml(fund.code || "--")}</span>
          ${fund.alert ? '<span class="halt">提醒中</span>' : ""}
          <span class="category">${escapeHtml(fund.categoryLabel)}</span>
        </div>
      </div>
      <div class="metric">
        <span class="metric-value">${escapeHtml(fund.realtimeEstimate || fund.nav || "--")}</span>
        <span class="metric-sub">${escapeHtml(fund.turnoverWan || "--")}</span>
      </div>
      <div class="metric">
        <span class="metric-value">${escapeHtml(fund.price || "--")}</span>
        <span class="metric-sub ${fund.pricePctClass}">${escapeHtml(fund.pricePct || "--")}</span>
      </div>
      <div class="premium metric">
        <span class="metric-value ${fund.realtimePremiumClass}">${escapeHtml(fund.realtimePremium || fund.latestPremium || "--")}</span>
        <span class="metric-sub">${escapeHtml(fund.latestPremium || "--")} / ${escapeHtml(fund.estimateDate || "--")}</span>
      </div>
    </div>
  `;
  return card;
}

function maybeNotify() {
  if (!state.alertEnabled) return;
  const alertFunds = state.funds
    .filter((fund) => fund.alert)
    .sort((a, b) => b.sortPremium - a.sortPremium)
    .slice(0, 5);
  const result = shouldNotifyAlert(alertFunds);
  if (!result.notify) return;

  state.lastAlertAt = Date.now();
  state.lastAlertSignature = result.signature;
  saveSettings();
  const message = alertFunds
    .map((fund) => `${fund.name || fund.code} ${fund.realtimePremium || fund.latestPremium || ""}`)
    .join("\n");

  if (navigator.vibrate) navigator.vibrate([160, 80, 160]);
  if (window.Notification && Notification.permission === "granted") {
    new Notification("LOF 溢价提醒", { body: message });
  } else {
    alert(`LOF 溢价提醒\n${message}`);
  }
  document.title = `(${alertFunds.length}) LOF溢价提醒`;
}

async function requestNotificationPermission() {
  if (!window.Notification || Notification.permission !== "default") return;
  try {
    await Notification.requestPermission();
  } catch {
    // Some mobile browsers only allow permission prompts from a direct tap.
  }
}

function buildFundView(rawFund) {
  const realtimePremium = parsePercent(rawFund.realtimePremium);
  const latestPremium = parsePercent(rawFund.latestPremium);
  const pricePct = parsePercent(rawFund.pricePct);
  const sortPremium = fundCore.selectDisplayPremium(rawFund);
  const category = getCategory(rawFund);

  return {
    ...rawFund,
    name: OFFICIAL_FUND_NAMES[String(rawFund.code || "")] || rawFund.name,
    alert: Number.isFinite(sortPremium) && sortPremium >= state.threshold,
    category,
    categoryLabel: categoryLabel(category),
    latestPremiumClass: percentClass(latestPremium),
    pricePctClass: percentClass(pricePct),
    realtimePremiumClass: percentClass(realtimePremium),
    sortPremium,
  };
}

function filterAndSortFunds() {
  const query = state.query.trim().toLowerCase();
  return state.funds
    .filter((fund) => {
      const haystack = `${fund.code || ""} ${fund.name || ""} ${fund.categoryLabel || ""}`.toLowerCase();
      const matchesQuery = !query || haystack.includes(query);
      const matchesCategory =
        state.activeCategory === "all" ||
        (state.activeCategory === "alert" && fund.alert) ||
        fund.category === state.activeCategory;
      return matchesQuery && matchesCategory;
    })
    .sort(fundCore.comparePremiumDesc);
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

function shouldNotifyAlert(alertFunds) {
  const signature = alertFunds
    .map((fund) => fund.code)
    .filter(Boolean)
    .sort()
    .join(",");
  if (!signature) return { notify: false, signature };
  if (signature !== state.lastAlertSignature) return { notify: true, signature };
  return {
    notify: Date.now() - state.lastAlertAt >= ALERT_COOLDOWN_MS,
    signature,
  };
}

function calculateEstimateChange(funds) {
  const errors = funds
    .map((fund) => Math.abs(parsePercent(fund.realtimePremium) - parsePercent(fund.latestPremium)))
    .filter(Number.isFinite);
  const avg = errors.reduce((sum, value) => sum + value, 0) / errors.length;
  return Number.isFinite(avg) ? `${avg.toFixed(2)}%` : "--";
}

function getCategory(fund) {
  const text = `${fund.code || ""} ${fund.name || ""}`.toLowerCase();
  if (/qdii|全球|海外|纳指|标普|美国|德国|印度|日本|日经|越南|香港|恒生|港美|黄金|油气/.test(text)) return "qdii";
  if (/指数|中证|科创|创业板|沪深|上证|深证/.test(text)) return "index";
  return "fund";
}

function categoryLabel(category) {
  return categories.find((item) => item.key === category)?.label || "LOF";
}

const parsePercent = fundCore.parsePercent;

function percentClass(value) {
  if (!Number.isFinite(value)) return "neutral";
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

function setStatus(status) {
  els.statusText.textContent = status;
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY));
    if (!saved) return;
    state.alertEnabled = saved.alertEnabled !== false;
    state.threshold = Number(saved.threshold) || state.threshold;
    state.lastAlertAt = Number(saved.lastAlertAt) || 0;
    state.lastAlertSignature = String(saved.lastAlertSignature || "");
    els.thresholdInput.value = state.threshold;
  } catch {
    // Keep defaults.
  }
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(mobileData.createSettingsSnapshot(state)));
}

function renderDataNotice(payload, stale, error) {
  const status = clientRuntime.describePayloadStatus({ ...payload, stale });
  const warnings = payload.warnings?.length ? ` · ${payload.warnings.join("；")}` : "";
  const failure = error ? ` · 本次刷新失败：${formatError(error)}` : "";
  els.dataNotice.textContent = `${status.label} · ${status.detail}${warnings}${failure}`;
  els.dataNotice.hidden = !(stale || payload.warnings?.length || error);
}

function formatPayloadTime(payload) {
  const date = new Date(payload.sourceUpdatedAt || payload.generatedAt || Date.now());
  return Number.isNaN(date.getTime()) ? "--" : formatDateTime(date);
}

function formatDateTime(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatError(error) {
  return error?.message || String(error || "未知错误");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return entities[char];
  });
}
