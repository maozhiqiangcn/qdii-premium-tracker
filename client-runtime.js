(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.LOF_CLIENT_RUNTIME = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const DEFAULT_SNAPSHOT_AGE_MS = 6 * 60 * 60 * 1000;

  async function fetchJsonWithRetry(url, options = {}) {
    const timeoutMs = options.timeoutMs ?? 12_000;
    const retries = options.retries ?? 1;
    const fetchImpl = options.fetchImpl || fetch;
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, { signal: controller.signal });
        if (!response.ok) {
          const error = new Error(`接口状态 ${response.status}`);
          error.status = response.status;
          throw error;
        }
        return await response.json();
      } catch (error) {
        if (controller.signal.aborted) lastError = new Error(`请求超时（${Math.round(timeoutMs / 1000)}秒）`);
        else lastError = error;
        const retryable = controller.signal.aborted || !error?.status || error.status === 429 || error.status >= 500;
        if (!retryable || attempt >= retries) throw lastError;
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError || new Error("请求失败");
  }

  function saveSnapshot(storage, key, payload, now = Date.now()) {
    storage.setItem(key, JSON.stringify({ savedAt: now, payload }));
  }

  function loadSnapshot(storage, key, options = {}) {
    const now = options.now ?? Date.now();
    const maxAgeMs = options.maxAgeMs ?? DEFAULT_SNAPSHOT_AGE_MS;
    try {
      const snapshot = JSON.parse(storage.getItem(key));
      const age = now - Number(snapshot?.savedAt);
      if (!snapshot?.payload || !Number.isFinite(age) || age < 0 || age > maxAgeMs) return null;
      return snapshot.payload;
    } catch {
      return null;
    }
  }

  function describePayloadStatus(payload) {
    const stale = payload?.stale === true;
    const sourceTime = payload?.sourceUpdatedAt || payload?.generatedAt || "时间未知";
    return {
      stale,
      label: stale ? "缓存数据" : "已更新",
      detail: `${payload?.source || "数据源"} · ${sourceTime}`,
    };
  }

  return {
    DEFAULT_SNAPSHOT_AGE_MS,
    describePayloadStatus,
    fetchJsonWithRetry,
    loadSnapshot,
    saveSnapshot,
  };
});
