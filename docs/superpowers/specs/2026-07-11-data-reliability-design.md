# QDII/LOF Data Reliability Design

## Goal

Make the desktop page, mobile page, and WeChat mini program show the same trustworthy fund data, clearly distinguish published NAV from estimates, and remain understandable when upstream services are slow or unavailable.

## Product Rules

- A fund company's published NAV is the authoritative NAV.
- HaoETF's T-1 estimate may be displayed as `T-1估值` with its estimate date and source.
- A realtime estimate is displayed only when the upstream explicitly supplies it and its timestamp is fresh for the current China date.
- Nasdaq futures, Nasdaq 100, and USD/CNH are reference market signals. They are not used to manufacture a formal fund NAV without a maintained fund-specific model.
- Cached data must be visibly labelled `缓存数据` with the original source update time. Cached data must never be presented as realtime.
- Premium is always `market price / displayed NAV or estimate - 1`. The denominator and its date must be visible.

## Architecture

The Flask backend remains the single normalization boundary. It fetches and validates HaoETF data, appends configured non-HaoETF funds such as `501312`, and returns a normalized response with source and freshness metadata. The local Python server mirrors the same response contract for development.

The three clients consume the normalized contract. Shared browser/mini-program calculation helpers provide official names, percentage parsing, freshness decisions, sorting, and summary logic. Clients may retain the last successful response locally for degraded read-only display, but they do not silently recalculate stale values as realtime.

## Backend Contract

`GET /api/haoetf` continues to return `ok` and `data.funds` for compatibility. It additionally returns:

- `source`: upstream source identifier.
- `generatedAt`: backend response time in ISO 8601.
- `sourceUpdatedAt`: timestamp parsed from the source when available.
- `stale`: whether the response came from cache.
- `cacheAgeSeconds`: age of the cached snapshot when stale.
- `warnings`: validation or fallback messages safe for display.

Each fund row retains existing display fields and adds source metadata when the row comes from a fallback source. Rows that fail structural validation are omitted and reported in `warnings` rather than returned with shifted columns.

The backend keeps a bounded in-memory snapshot. A stale snapshot is usable for at most six hours. Upstream requests use explicit timeouts. The endpoint never labels an arbitrarily old snapshot as successful realtime data.

## Non-HaoETF Funds

`501312` is part of the normalized backend result even though HaoETF does not list it. Its published NAV comes from the public fund estimate endpoint and its market price comes from the market quote endpoint. If only the published NAV is trustworthy, `realtimeEstimate` and `realtimePremium` remain empty while `latestPremium` is calculated from market price and published NAV.

## Client Behaviour

- Network requests time out after 12 seconds and retry once for transient failures.
- A refresh already in progress cannot overlap with another refresh.
- On success, the response and metadata are saved as the last successful snapshot.
- On failure, the last snapshot may be rendered with a persistent `缓存数据` warning and source time. With no snapshot, the page shows a concise error.
- The desktop heading describes night-session and FX values as reference signals.
- `系统误差` becomes `估值变动` because it measures the difference between realtime and T-1 premiums.
- The mobile `溢价天数` label becomes `T-1溢价/日期` because that is what the row displays.
- Alert signature and last alert time are persisted so reloading does not repeat the same alert immediately.
- The service worker caches only the explicit static asset allowlist and does not cache dynamic or third-party requests.

## Watchlist Persistence

Saved fund settings win over defaults for matching codes. Defaults add missing pinned funds without overwriting the user's note, target, mode, or manual values. When migrating old storage keys, the newest valid `savedAt` wins; fund count is only a fallback when timestamps are absent.

## Mini Program

The missing `cloudfunctions/haoetf/index.js` is added as a small proxy with a bounded timeout. The mini program uses the same normalized response contract and shows the same freshness warning and labels as the mobile web page. Public-request fallback remains available when the cloud function is unavailable.

## Testing

- Python parser tests cover both HaoETF table shapes, malformed rows, metadata extraction, stale-cache limits, and `501312` fallback normalization.
- JavaScript tests cover freshness decisions, shared official names, premium calculation, timeout/retry helpers, snapshot fallback, sorting, labels, and watchlist migration.
- Existing mobile and mini-program tests remain green.
- Verification includes JavaScript syntax checks, Python compilation/tests, and live endpoint checks after deployment.

## Deployment

Frontend changes are published through the existing GitHub Pages `main` branch. The Flask service requires a separate CloudBase deployment because pushing to GitHub does not update the running container. Until that deployment is performed, frontend compatibility with the current response shape is preserved.

## Out Of Scope

- A fund-specific holdings model for calculating an independent realtime NAV.
- Guaranteed background push while the mobile web page or mini program is closed.
- Trading, subscription, redemption, or account integration.
