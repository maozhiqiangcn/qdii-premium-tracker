# QDII/LOF Data Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all three clients display consistent, freshness-aware fund data with bounded failures and honest night-market reference labels.

**Architecture:** Normalize source data and freshness metadata in the Flask/local backends, centralize client-side fund rules in a UMD helper shared by browser pages and the mini program, and retain only explicitly labelled last-success snapshots. Preserve the existing `/api/haoetf` response fields while extending its metadata so the currently deployed frontend remains compatible during rollout.

**Tech Stack:** Vanilla JavaScript, Node.js built-in test runner, Python 3.11 `unittest`, Flask/Gunicorn, WeChat mini program APIs, GitHub Pages service worker.

## Global Constraints

- Published fund NAV is authoritative; estimates never overwrite it without a visible source and timestamp.
- Night futures and USD/CNH are reference signals only.
- Network timeout is 12 seconds with at most one retry for transient failure.
- Cached snapshots older than six hours are not displayed.
- No new runtime dependencies are added to the browser or backend.
- Existing `/api/haoetf` fields remain backward compatible.

---

### Task 1: Shared fund rules and watchlist migration

**Files:**
- Create: `miniprogram/utils/fund-core.js`
- Create: `fund-core.test.js`
- Modify: `index.html`
- Modify: `mobile.html`
- Modify: `app.js`
- Modify: `mobile.js`
- Modify: `miniprogram/pages/index/fundMetrics.js`

**Interfaces:**
- Produces: `LOF_FUND_CORE` / CommonJS exports `OFFICIAL_FUND_NAMES`, `parsePercent`, `premiumPercent`, `isFreshEstimate`, `selectDisplayPremium`, `comparePremiumDesc`, `chooseSavedState`, and `mergePinnedFunds`.
- Consumes: normalized fund rows and saved watchlist objects.

- [ ] **Step 1: Write failing shared-rule tests**

Add Node tests asserting:

```js
test("stale estimate is rejected", () => {
  assert.equal(isFreshEstimate({ estimate: 2.1, estimateTime: "2026-07-09 15:00" }, new Date("2026-07-11T03:00:00Z")), false);
});

test("saved settings win over pinned defaults", () => {
  const result = mergePinnedFunds(
    [{ code: "513100", note: "我的备注", mode: "manual", nav: 2 }],
    [{ code: "513100", note: "默认", mode: "auto" }, { code: "501312" }],
  );
  assert.equal(result[0].note, "我的备注");
  assert.equal(result[0].mode, "manual");
  assert.equal(result.some((fund) => fund.code === "501312"), true);
});

test("newest savedAt wins during migration", () => {
  const chosen = chooseSavedState([
    { savedAt: "2026-07-01T00:00:00Z", funds: [{ code: "1" }, { code: "2" }] },
    { savedAt: "2026-07-02T00:00:00Z", funds: [{ code: "1" }] },
  ]);
  assert.equal(chosen.savedAt, "2026-07-02T00:00:00Z");
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test fund-core.test.js`

Expected: failure because `miniprogram/utils/fund-core.js` and its exports do not exist.

- [ ] **Step 3: Implement the shared UMD helper**

Implement the listed pure functions. `isFreshEstimate` must compare the China calendar date from `estimateTime` to the current China date and reject equal-to-NAV placeholder estimates. `mergePinnedFunds` must append missing defaults while preserving every saved field for duplicate codes.

- [ ] **Step 4: Wire the helper into all clients**

Load `./miniprogram/utils/fund-core.js` before `app.js` and `mobile.js`. Require the same physical file from `miniprogram/pages/index/fundMetrics.js` through `../../utils/fund-core`; do not keep a second copy.

- [ ] **Step 5: Run shared and existing tests**

Run: `node --test fund-core.test.js mobile-data.test.js miniprogram/pages/index/fundMetrics.test.js`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```powershell
git add fund-core.test.js index.html mobile.html app.js mobile.js miniprogram/utils/fund-core.js miniprogram/pages/index/fundMetrics.js
git commit -m "refactor: share fund display rules"
```

### Task 2: Robust HaoETF parser and response metadata

**Files:**
- Create: `tests/test_backend.py`
- Create: `backend_core.py`
- Modify: `cloudrun-flask/app.py`
- Modify: `server.py`

**Interfaces:**
- Produces: `parse_haoetf(html) -> {funds, sourceUpdatedAt, warnings}` and `build_response(data, stale, cache_age_seconds)`.
- Consumes: HaoETF HTML.

- [ ] **Step 1: Write failing parser tests**

Use small HTML fixtures for a QDII row and an ETF row. Assert core values and that link text cannot become `redeemFee`:

```python
def test_etf_row_does_not_shift_link_text_into_fee(self):
    data = parse_haoetf(ETF_HTML)
    row = data["funds"][0]
    self.assertEqual(row["code"], "513100")
    self.assertEqual(row["latestEstimate"], "2.0172")
    self.assertEqual(row["latestPremium"], "7.77%")
    self.assertNotIn("官网", row.get("redeemFee", ""))

def test_source_update_time_is_extracted(self):
    data = parse_haoetf('<p>数据更新时间：2026-07-11 10:58:24</p>' + ETF_HTML)
    self.assertEqual(data["sourceUpdatedAt"], "2026-07-11T10:58:24+08:00")
```

- [ ] **Step 2: Run tests and verify RED**

Run: `python -m unittest tests.test_backend -v`

Expected: import or assertion failures because `backend_core.py` is absent.

- [ ] **Step 3: Implement parser validation**

Move common parsing into `backend_core.py`. Validate code, NAV/estimate numeric shapes, percentage fields, and minimum core columns. Parse only fee fields proven by the current row shape; otherwise leave them empty and append a warning. Extract source update time with an Asia/Shanghai offset.

- [ ] **Step 4: Add response metadata**

Return top-level `source`, `generatedAt`, `sourceUpdatedAt`, `stale`, `cacheAgeSeconds`, and `warnings` while retaining `ok` and `data.funds`.

- [ ] **Step 5: Run backend tests and compilation**

Run: `python -m unittest tests.test_backend -v; python -m compileall -q backend_core.py server.py cloudrun-flask/app.py`

Expected: tests pass and compilation exits zero.

- [ ] **Step 6: Commit**

```powershell
git add backend_core.py tests/test_backend.py server.py cloudrun-flask/app.py
git commit -m "fix: validate fund source data"
```

### Task 3: Bounded cache and normalized 501312 fallback

**Files:**
- Modify: `tests/test_backend.py`
- Modify: `backend_core.py`
- Modify: `cloudrun-flask/app.py`
- Modify: `server.py`

**Interfaces:**
- Produces: `merge_extra_funds`, `is_cache_usable`, and a normalized `501312` row.
- Consumes: published NAV JSONP text and market quote JSON.

- [ ] **Step 1: Write failing cache and fallback tests**

```python
def test_cache_older_than_six_hours_is_rejected(self):
    self.assertFalse(is_cache_usable(updated_at=0, now=21601, max_age=21600))

def test_501312_uses_published_nav_not_stale_estimate(self):
    row = build_extra_fund_row(
        "501312",
        {"dwjz": "2.3699", "jzrq": "2026-07-10", "gsz": "2.1000", "gztime": "2026-07-09 15:00"},
        {"price": 2.367, "pct": 0.17, "name": "海外科技LOF"},
        now="2026-07-11T11:00:00+08:00",
    )
    self.assertEqual(row["latestEstimate"], "2.3699")
    self.assertEqual(row["realtimeEstimate"], "")
```

- [ ] **Step 2: Run tests and verify RED**

Run: `python -m unittest tests.test_backend -v`

Expected: missing helper failures.

- [ ] **Step 3: Implement bounded cache and fallback adapters**

Fetch HaoETF with a 12-second timeout and one retry. Cache only validated non-empty datasets. Append `501312` using its published NAV and market quote; leave realtime fields empty when the estimate timestamp is stale. Return stale cache only while age is at most `21600` seconds.

- [ ] **Step 4: Run tests and commit**

Run: `python -m unittest tests.test_backend -v`

```powershell
git add backend_core.py tests/test_backend.py server.py cloudrun-flask/app.py
git commit -m "feat: add bounded fund data fallback"
```

### Task 4: Resilient desktop client

**Files:**
- Create: `client-runtime.js`
- Create: `client-runtime.test.js`
- Modify: `index.html`
- Modify: `app.js`

**Interfaces:**
- Produces: `fetchJsonWithRetry(url, { timeoutMs, retries, fetchImpl })`, `loadSnapshot`, and `saveSnapshot`.
- Consumes: normalized backend response.

- [ ] **Step 1: Write failing timeout and snapshot tests**

Test that a transient first failure retries once, a timeout aborts, snapshots older than six hours are rejected, and stale responses expose a visible warning model.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test client-runtime.test.js`

Expected: missing module/functions.

- [ ] **Step 3: Implement runtime helpers**

Use `AbortController`; clear every timeout in `finally`; retry only network errors, timeout, `429`, and `5xx`. Snapshot records contain `{ savedAt, payload }` and are accepted only for six hours.

- [ ] **Step 4: Update desktop refresh and labels**

Add an in-flight guard, disable refresh while loading, use backend metadata, display a persistent stale/source warning, and keep previous visible rows on a failed refresh. Remove browser-side mass JSONP loading. Change the subtitle to `场内价格 + 基金净值/估值 + 美股夜盘参考 + 汇率参考` and label the estimate columns `T-1估值` and `T-1溢价`.

- [ ] **Step 5: Fix persistence migration using shared rules**

Select newest `savedAt` and merge pinned defaults without overwriting user fields.

- [ ] **Step 6: Run tests and commit**

Run: `node --test fund-core.test.js client-runtime.test.js`

```powershell
git add client-runtime.js client-runtime.test.js index.html app.js
git commit -m "fix: harden desktop data refresh"
```

### Task 5: Honest mobile web status, cache, and alerts

**Files:**
- Modify: `mobile.html`
- Modify: `mobile.js`
- Modify: `mobile-data.js`
- Modify: `mobile-data.test.js`
- Modify: `sw.js`

**Interfaces:**
- Consumes: shared core and client runtime helpers.
- Produces: foreground alert state persisted in `lof-mobile-settings-v2`.

- [ ] **Step 1: Write failing label and alert persistence tests**

Assert that the status metric is named `估值变动`, the fourth column says `T-1溢价/日期`, and saved settings include `lastAlertAt` plus `lastAlertSignature`.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test mobile-data.test.js`

Expected: assertions fail against current labels/settings model.

- [ ] **Step 3: Use one normalized backend request**

Remove the second HaoETF request and browser-side `501312` JSONP fallback. Apply timeout/retry, in-flight protection, snapshot fallback, stale warning, and source timestamp.

- [ ] **Step 4: Correct labels and alert behaviour**

Rename the misleading metrics, persist alert cooldown state, and explicitly say reminders work only while the page is open.

- [ ] **Step 5: Restrict service-worker caching**

Handle only same-origin GET requests whose normalized pathname is in the static asset allowlist. Do not cache query-string variants, APIs, navigation responses other than `mobile.html`, or third-party requests. Call `skipWaiting()` and `clients.claim()` during version upgrades.

- [ ] **Step 6: Run tests and commit**

Run: `node --test mobile-data.test.js client-runtime.test.js fund-core.test.js`

```powershell
git add mobile.html mobile.js mobile-data.js mobile-data.test.js sw.js
git commit -m "fix: make mobile fund status trustworthy"
```

### Task 6: Mini program parity and cloud function

**Files:**
- Create: `miniprogram/cloudfunctions/haoetf/index.js`
- Create: `miniprogram/cloudfunctions/haoetf/index.test.js`
- Modify: `miniprogram/pages/index/index.js`
- Modify: `miniprogram/pages/index/index.wxml`
- Modify: `miniprogram/pages/index/fundMetrics.js`
- Modify: `miniprogram/pages/index/fundMetrics.test.js`

**Interfaces:**
- Produces: cloud function response matching `/api/haoetf`.
- Consumes: `API_BASE` and normalized response metadata.

- [ ] **Step 1: Write failing cloud proxy tests**

Inject a request function and assert a successful JSON response is returned, a 12-second timeout rejects, and non-2xx responses produce a safe error object.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test miniprogram/cloudfunctions/haoetf/index.test.js miniprogram/pages/index/fundMetrics.test.js`

Expected: missing `index.js` failure.

- [ ] **Step 3: Implement the cloud function**

Use Node's `https` module and an explicit timer; do not require global `fetch`. Export the handler plus the injectable request helper for tests. Return `{ ok: false, error: "行情服务暂时不可用" }` without leaking raw infrastructure details.

- [ ] **Step 4: Update mini-program status and persistence**

Consume metadata, display stale/source warnings, use corrected labels, persist alert cooldown state, and retain public-request fallback.

- [ ] **Step 5: Run tests and commit**

Run: `node --test miniprogram/cloudfunctions/haoetf/index.test.js miniprogram/pages/index/fundMetrics.test.js fund-core.test.js`

```powershell
git add miniprogram/cloudfunctions/haoetf/index.js miniprogram/cloudfunctions/haoetf/index.test.js miniprogram/pages/index/index.js miniprogram/pages/index/index.wxml miniprogram/pages/index/fundMetrics.js miniprogram/pages/index/fundMetrics.test.js
git commit -m "fix: align mini program fund data"
```

### Task 7: Full verification and deployment handoff

**Files:**
- Modify: `README.md`
- Modify: `MOBILE_README.md`
- Modify: `cloudrun-flask/README.md`

**Interfaces:**
- Documents: source meanings, stale-data behaviour, foreground-only alerts, GitHub Pages URL, and separate CloudBase deployment requirement.

- [ ] **Step 1: Run the complete local suite**

```powershell
node --test fund-core.test.js client-runtime.test.js mobile-data.test.js miniprogram/pages/index/fundMetrics.test.js miniprogram/cloudfunctions/haoetf/index.test.js
python -m unittest discover -s tests -v
node --check app.js
node --check mobile.js
node --check miniprogram/utils/fund-core.js
node --check client-runtime.js
node --check sw.js
python -m compileall -q backend_core.py server.py cloudrun-flask/app.py
```

Expected: all tests pass and every syntax/compile command exits zero.

- [ ] **Step 2: Update documentation**

Document that formal NAV is published NAV, night data is reference-only, stale snapshots are labelled, and background notification is out of scope.

- [ ] **Step 3: Verify repository cleanliness and commit docs**

```powershell
git diff --check
git status --short
git add README.md MOBILE_README.md cloudrun-flask/README.md
git commit -m "docs: explain fund data reliability"
```

- [ ] **Step 4: Push frontend and verify GitHub Pages**

Push `main`, wait for Pages deployment, then verify `index.html`, `mobile.html`, script versions, corrected labels, and static service-worker cache version.

- [ ] **Step 5: Prepare CloudBase deployment**

Build the deployment package from `cloudrun-flask/app.py`, `backend_core.py`, `requirements.txt`, and `Dockerfile`. Deploy through the existing CloudBase service, then verify health, metadata, `501312`, stale fields, and response time. If console authentication prevents deployment, report the exact package path and remaining click sequence without claiming the backend is updated.
