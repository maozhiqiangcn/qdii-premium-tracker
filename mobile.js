const API_ORIGIN =
  window.LOF_API_ORIGIN ||
  (location.hostname === "127.0.0.1" || location.hostname === "localhost"
    ? location.origin
    : "https://flask-7ux0-271799-9-1444624345.sh.run.tcloudbase.com");
const AUTO_REFRESH_MS = 60_000;
const ALERT_COOLDOWN_MS = 5 * 60_000;
const STORAGE_KEY = "lof-mobile-settings-v1";

const OFFICIAL_FUND_NAMES = {
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
};

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
  fundList: document.querySelector("#fundList"),
  refreshBtn: document.querySelector("#refreshBtn"),
  searchInput: document.querySelector("#searchInput"),
  statusText: document.querySelector("#statusText"),
  summaryText: document.querySelector("#summaryText"),
  systemError: document.querySelector("#systemError"),
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
  setStatus("更新中");
  els.errorBox.hidden = true;
  els.refreshBtn.disabled = true;

  try {
    const response = await fetch(`${API_ORIGIN}/api/haoetf?_=${Date.now()}`);
    if (!response.ok) throw new Error(`接口状态 ${response.status}`);
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.error || "接口返回失败");

    state.funds = (payload.data.funds || []).map(buildFundView);
    setStatus("运行中");
    els.updatedAt.textContent = formatDateTime(new Date());
    render();
    maybeNotify();
  } catch (error) {
    setStatus("异常");
    els.errorBox.textContent = `刷新失败：${formatError(error)}`;
    els.errorBox.hidden = false;
  } finally {
    els.refreshBtn.disabled = false;
  }
}

function render() {
  const visibleFunds = filterAndSortFunds();
  const summary = summarizeFunds(state.funds);

  els.totalCount.textContent = summary.total;
  els.systemError.textContent = calculateSystemError(state.funds);
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
  const sortPremium = getSortablePremium(rawFund, realtimePremium, latestPremium);
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

function calculateSystemError(funds) {
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

function parsePercent(value) {
  const number = Number(String(value || "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) ? number : NaN;
}

function getSortablePremium(fund, realtimePremium, latestPremium) {
  const displayedPremium = parsePercent(fund.realtimePremium || fund.latestPremium);
  if (Number.isFinite(displayedPremium)) return displayedPremium;
  if (Number.isFinite(realtimePremium)) return realtimePremium;
  return latestPremium;
}

function comparePremiumDesc(a, b) {
  const premiumA = getSortablePremium(a, a.sortPremium, a.sortPremium);
  const premiumB = getSortablePremium(b, b.sortPremium, b.sortPremium);
  if (!Number.isFinite(premiumA)) return 1;
  if (!Number.isFinite(premiumB)) return -1;
  if (premiumB !== premiumA) return premiumB - premiumA;
  return String(a.code || "").localeCompare(String(b.code || ""), "zh-CN");
}

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
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved) return;
    state.alertEnabled = saved.alertEnabled !== false;
    state.threshold = Number(saved.threshold) || state.threshold;
    els.thresholdInput.value = state.threshold;
  } catch {
    // Keep defaults.
  }
}

function saveSettings() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      alertEnabled: state.alertEnabled,
      threshold: state.threshold,
    }),
  );
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
