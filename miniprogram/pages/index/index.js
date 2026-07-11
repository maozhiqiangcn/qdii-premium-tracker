const { API_BASE } = require("../../config");
const {
  buildFundView,
  createSettingsSnapshot,
  filterAndSortFunds,
  normalizePayloadFunds,
  shouldNotifyAlert,
  summarizeFunds,
} = require("./fundMetrics");

const STORAGE_KEY = "lof-premium-settings-v2";
const LEGACY_STORAGE_KEY = "lof-premium-settings-v1";
const SNAPSHOT_KEY = "lof-premium-last-success-v1";
const SNAPSHOT_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const DEFAULT_THRESHOLD = 3;
const AUTO_REFRESH_MS = 60 * 1000;
const ALERT_COOLDOWN_MS = 5 * 60 * 1000;

Page({
  data: {
    activeCategory: "all",
    alertCount: 0,
    alertEnabled: true,
    avgPremium: "--",
    categories: [
      { key: "all", label: "全部" },
      { key: "fund", label: "股票型LOF" },
      { key: "index", label: "指数型LOF" },
      { key: "qdii", label: "QDII-LOF" },
      { key: "alert", label: "提醒" },
    ],
    error: "",
    dataNotice: "",
    funds: [],
    lastAlertAt: 0,
    lastAlertSignature: "",
    loading: false,
    query: "",
    statusText: "待刷新",
    estimateChange: "--",
    threshold: DEFAULT_THRESHOLD,
    totalCount: 0,
    updatedAt: "",
    visibleFunds: [],
  },

  onLoad() {
    const settings = wx.getStorageSync(STORAGE_KEY) || wx.getStorageSync(LEGACY_STORAGE_KEY) || {};
    this.setData({
      alertEnabled: settings.alertEnabled !== false,
      lastAlertAt: Number(settings.lastAlertAt) || 0,
      lastAlertSignature: String(settings.lastAlertSignature || ""),
      threshold: Number(settings.threshold) || DEFAULT_THRESHOLD,
    });
    this.refresh();
  },

  onShow() {
    this.startAutoRefresh();
  },

  onHide() {
    this.stopAutoRefresh();
  },

  onUnload() {
    this.stopAutoRefresh();
  },

  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh());
  },

  onSearchInput(event) {
    this.setData({ query: event.detail.value || "" });
    this.applyFilters();
  },

  clearSearch() {
    this.setData({ query: "" });
    this.applyFilters();
  },

  switchCategory(event) {
    this.setData({ activeCategory: event.currentTarget.dataset.key || "all" });
    this.applyFilters();
  },

  onThresholdInput(event) {
    const threshold = Math.max(0, Number(event.detail.value) || 0);
    this.setData({ threshold });
    this.saveSettings();
    this.rebuildFunds(this.data.funds);
  },

  toggleAlert() {
    this.setData({ alertEnabled: !this.data.alertEnabled });
    this.saveSettings();
  },

  async refresh() {
    if (this.data.loading) return;
    this.setData({ loading: true, error: "", dataNotice: "", statusText: "更新中" });

    try {
      let result;
      let networkError;
      try {
        result = await loadHaoEtf();
        if (!result.ok) throw new Error(result.error || "接口返回失败");
        wx.setStorageSync(SNAPSHOT_KEY, { savedAt: Date.now(), payload: result });
      } catch (error) {
        networkError = error;
        const snapshot = wx.getStorageSync(SNAPSHOT_KEY) || {};
        if (snapshot.payload && Date.now() - Number(snapshot.savedAt) <= SNAPSHOT_MAX_AGE_MS) result = snapshot.payload;
        else throw error;
      }

      const stale = Boolean(networkError || result.stale);
      const funds = normalizePayloadFunds(result.data.funds || [], stale).map((fund) => buildFundView(fund, this.data.threshold));
      const sourceTime = result.sourceUpdatedAt || result.generatedAt;
      const noticeParts = [];
      if (stale) noticeParts.push("缓存数据");
      if (sourceTime) noticeParts.push(`来源时间 ${formatDateTime(new Date(sourceTime))}`);
      if (result.warnings?.length) noticeParts.push(result.warnings.join("；"));
      if (networkError) noticeParts.push(`本次刷新失败：${formatError(networkError)}`);
      this.rebuildFunds(funds, {
        dataNotice: noticeParts.join(" · "),
        statusText: stale ? "缓存数据" : "运行中",
        updatedAt: sourceTime ? formatDateTime(new Date(sourceTime)) : formatDateTime(new Date()),
      });
      this.maybeNotify(funds);
    } catch (error) {
      this.setData({
        error: `刷新失败：${formatError(error)}`,
        loading: false,
        statusText: "异常",
      });
      return;
    }

    this.setData({ loading: false });
  },

  rebuildFunds(funds, extra = {}) {
    const rebuilt = funds.map((fund) => buildFundView(fund, this.data.threshold));
    const summary = summarizeFunds(rebuilt);

    this.setData({
      ...extra,
      alertCount: summary.alertCount,
      avgPremium: summary.avgPremium,
      funds: rebuilt,
      estimateChange: calculateEstimateChange(rebuilt),
      totalCount: summary.total,
    });
    this.applyFilters();
  },

  applyFilters() {
    const visibleFunds = filterAndSortFunds(this.data.funds, {
      category: this.data.activeCategory,
      query: this.data.query,
    });
    this.setData({ visibleFunds });
  },

  maybeNotify(funds) {
    if (!this.data.alertEnabled) return;

    const alertFunds = funds.filter((fund) => fund.alert).slice(0, 5);
    const now = Date.now();
    const result = shouldNotifyAlert({
      alertFunds,
      lastAt: this.data.lastAlertAt,
      lastSignature: this.data.lastAlertSignature,
      now,
      cooldownMs: ALERT_COOLDOWN_MS,
    });

    if (!result.notify) return;

    this.setData(
      {
        lastAlertAt: now,
        lastAlertSignature: result.signature,
      },
      () => this.saveSettings(),
    );

    if (wx.vibrateShort) wx.vibrateShort({ type: "medium" });
    wx.showModal({
      title: "溢价提醒",
      content: alertFunds
        .map((fund) => `${fund.name || fund.code} ${fund.realtimePremium || fund.latestPremium || ""}`)
        .join("\n"),
      confirmText: "查看",
      showCancel: false,
    });
  },

  saveSettings() {
    wx.setStorageSync(STORAGE_KEY, createSettingsSnapshot(this.data));
  },

  startAutoRefresh() {
    this.stopAutoRefresh();
    this.refreshTimer = setInterval(() => this.refresh(), AUTO_REFRESH_MS);
  },

  stopAutoRefresh() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  },
});

function request(url) {
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: "GET",
      timeout: 12000,
      success: (response) => resolve(response.data),
      fail: reject,
    });
  });
}

async function loadHaoEtf() {
  if (wx.cloud && wx.cloud.callFunction) {
    try {
      const response = await wx.cloud.callFunction({ name: "haoetf" });
      return response.result;
    } catch (error) {
      console.warn("cloud function failed, falling back to request domain", error);
    }
  }

  return request(`${API_BASE}/api/haoetf`);
}

function calculateEstimateChange(funds) {
  const errors = funds
    .map((fund) => Math.abs(parsePercent(fund.realtimePremium) - parsePercent(fund.latestPremium)))
    .filter(Number.isFinite);
  const avg = errors.reduce((sum, value) => sum + value, 0) / errors.length;
  return Number.isFinite(avg) ? `${avg.toFixed(2)}%` : "--";
}

function parsePercent(value) {
  const number = Number(String(value || "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) ? number : NaN;
}

function formatDateTime(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatError(error) {
  if (!error) return "未知错误";
  if (typeof error === "string") return error;
  if (error.errMsg) return error.errMsg;
  if (error.message) return error.message;
  try {
    return JSON.stringify(error);
  } catch (jsonError) {
    return String(error);
  }
}
