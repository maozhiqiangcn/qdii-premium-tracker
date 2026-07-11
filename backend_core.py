from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
import json
import re
import time
from urllib.request import Request, urlopen


NUMBER_PATTERN = re.compile(r"^-?\d+(?:\.\d+)?$")
PERCENT_PATTERN = re.compile(r"^[+-]?\d+(?:\.\d+)?%$")
SOURCE_TIME_PATTERN = re.compile(r"数据更新时间[：:]\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})")


class HaoEtfParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_row = False
        self.in_cell = False
        self.rows = []
        self.row = []
        self.cell = []
        self.document_text = []

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self.in_row = True
            self.row = []
        elif tag == "td" and self.in_row:
            self.in_cell = True
            self.cell = []

    def handle_data(self, data):
        text = data.strip()
        if text:
            self.document_text.append(text)
        if self.in_cell and text:
            self.cell.append(text)

    def handle_endtag(self, tag):
        if tag == "td" and self.in_cell:
            self.row.append(" ".join(self.cell).strip())
            self.in_cell = False
        elif tag == "tr" and self.in_row:
            if self.row:
                self.rows.append(self.row)
            self.in_row = False


def clean_dash(value):
    value = re.sub(r"\s+", " ", value or "").strip()
    value = re.sub(r"\s*测$", "", value).strip()
    return "" if value == "-" else value


def _valid_number(value, allow_empty=True):
    value = clean_dash(value)
    return (allow_empty and not value) or bool(NUMBER_PATTERN.fullmatch(value))


def _valid_percent(value, allow_empty=True):
    value = clean_dash(value)
    return (allow_empty and not value) or bool(PERCENT_PATTERN.fullmatch(value))


def _source_updated_at(text):
    match = SOURCE_TIME_PATTERN.search(text)
    if not match:
        return None
    return f"{match.group(1)}T{match.group(2)}+08:00"


def parse_haoetf(html):
    parser = HaoEtfParser()
    parser.feed(html)
    funds = []
    warnings = []

    for row in parser.rows:
        if len(row) < 18 or not re.fullmatch(r"\d{6}", row[0]):
            continue
        if not (
            _valid_number(row[2])
            and _valid_percent(row[3])
            and _valid_number(row[4])
            and _valid_percent(row[5])
            and _valid_number(row[7])
            and _valid_percent(row[8])
            and _valid_number(row[12])
            and _valid_percent(row[13])
            and _valid_percent(row[15])
        ):
            warnings.append(f"已忽略结构异常的基金行：{row[0]}")
            continue

        if len(row) >= 20:
            purchase_limit = clean_dash(row[16])
            purchase_fee = clean_dash(row[17])
            redeem_fee = clean_dash(row[18])
        else:
            purchase_limit = ""
            purchase_fee = clean_dash(row[16])
            redeem_fee = clean_dash(row[17])

        funds.append(
            {
                "code": row[0],
                "name": row[1],
                "realtimeEstimate": clean_dash(row[2]),
                "realtimePremium": clean_dash(row[3]),
                "latestEstimate": clean_dash(row[4]),
                "latestPremium": clean_dash(row[5]),
                "estimateDate": clean_dash(row[6]),
                "price": clean_dash(row[7]),
                "pricePct": clean_dash(row[8]),
                "turnoverWan": clean_dash(row[9]),
                "sharesWan": clean_dash(row[10]),
                "newSharesWan": clean_dash(row[11]),
                "nav": clean_dash(row[12]),
                "navPct": clean_dash(row[13]),
                "navDate": clean_dash(row[14]),
                "indexPct": clean_dash(row[15]),
                "purchaseLimit": purchase_limit,
                "purchaseFee": purchase_fee,
                "redeemFee": redeem_fee,
                "source": "HaoETF",
            }
        )

    return {
        "funds": funds,
        "sourceUpdatedAt": _source_updated_at(" ".join(parser.document_text)),
        "warnings": warnings,
    }


def build_response(data, stale=False, cache_age_seconds=0, now=None):
    generated_at = (now or datetime.now(timezone.utc)).isoformat().replace("+00:00", "Z")
    return {
        "ok": True,
        "data": {"funds": list(data.get("funds") or [])},
        "source": "HaoETF",
        "generatedAt": generated_at,
        "sourceUpdatedAt": data.get("sourceUpdatedAt"),
        "stale": bool(stale),
        "cacheAgeSeconds": max(0, int(cache_age_seconds or 0)),
        "warnings": list(data.get("warnings") or []),
    }


def is_cache_usable(updated_at, now, max_age=21600):
    try:
        age = float(now) - float(updated_at)
    except (TypeError, ValueError):
        return False
    return 0 <= age <= max_age


def _number(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number


def _format_number(value, digits):
    return f"{value:.{digits}f}" if value is not None else ""


def _format_percent(value, signed=False):
    if value is None:
        return ""
    prefix = "+" if signed and value > 0 else ""
    return f"{prefix}{value:.2f}%"


def _premium(price, nav):
    if price is None or nav in (None, 0):
        return None
    return (price / nav - 1) * 100


def _china_date(now):
    if isinstance(now, str):
        return now[:10]
    if isinstance(now, datetime):
        return now.astimezone(timezone(timedelta(hours=8))).strftime("%Y-%m-%d")
    return datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%d")


def build_extra_fund_row(code, estimate, quote, now=None):
    nav = _number(estimate.get("dwjz"))
    estimated_nav = _number(estimate.get("gsz"))
    price = _number(quote.get("price"))
    estimate_time = str(estimate.get("gztime") or "")
    realtime_fresh = (
        estimated_nav is not None
        and estimate_time[:10] == _china_date(now)
        and (nav is None or abs(estimated_nav - nav) >= 0.000001)
    )
    realtime_nav = estimated_nav if realtime_fresh else None
    nav_date = str(estimate.get("jzrq") or "")

    return {
        "code": str(code),
        "name": quote.get("name") or estimate.get("name") or str(code),
        "realtimeEstimate": _format_number(realtime_nav, 4),
        "realtimePremium": _format_percent(_premium(price, realtime_nav)),
        "latestEstimate": _format_number(nav, 4),
        "latestPremium": _format_percent(_premium(price, nav)),
        "estimateDate": nav_date[5:10] if len(nav_date) >= 10 else nav_date,
        "price": _format_number(price, 3),
        "pricePct": _format_percent(_number(quote.get("pct")), signed=True),
        "turnoverWan": _format_number(_number(quote.get("turnoverWan")), 2),
        "sharesWan": "",
        "newSharesWan": "",
        "nav": _format_number(nav, 4),
        "navPct": "",
        "navDate": nav_date[5:10] if len(nav_date) >= 10 else nav_date,
        "indexPct": "",
        "purchaseLimit": "",
        "purchaseFee": "",
        "redeemFee": "",
        "source": f"天天基金/{quote.get('source') or '东方财富'}",
        "realtimeFresh": realtime_fresh,
        "estimateTime": estimate_time,
    }


def parse_jsonp_payload(text, callback):
    pattern = rf"^\s*{re.escape(callback)}\s*\((.*)\)\s*;?\s*$"
    match = re.match(pattern, text or "", re.DOTALL)
    if not match:
        raise ValueError("invalid JSONP payload")
    return json.loads(match.group(1))


def _fetch_text(url, timeout=12, headers=None, encoding="utf-8"):
    request_headers = {"User-Agent": "Mozilla/5.0"}
    request_headers.update(headers or {})
    request = Request(url, headers=request_headers)
    with urlopen(request, timeout=timeout) as response:
        return response.read().decode(encoding, errors="replace")


def load_with_retry(loader, retries=1, delay=0.2):
    last_error = None
    for attempt in range(retries + 1):
        try:
            return loader()
        except Exception as exc:
            last_error = exc
            if attempt < retries and delay:
                time.sleep(delay)
    raise last_error


def load_haoetf_source(url="https://www.haoetf.com/", timeout=12, retries=1):
    return load_with_retry(lambda: parse_haoetf(_fetch_text(url, timeout=timeout)), retries=retries)


def load_extra_fund(code="501312", timeout=12, now=None):
    estimate_text = _fetch_text(f"https://fundgz.1234567.com.cn/js/{code}.js?rt={int(time.time() * 1000)}", timeout)
    estimate = parse_jsonp_payload(estimate_text, "jsonpgz")
    secid = f"{'1' if str(code).startswith('5') else '0'}.{code}"
    quote_url = (
        "https://push2.eastmoney.com/api/qt/ulist.np/get"
        f"?fltt=2&secids={secid}&fields=f12,f14,f2,f3,f4,f6&_={int(time.time() * 1000)}"
    )
    try:
        quote_payload = json.loads(_fetch_text(quote_url, timeout))
        raw_quote = (quote_payload.get("data") or {}).get("diff") or []
        if not raw_quote:
            raise ValueError(f"market quote missing: {code}")
        raw_quote = raw_quote[0]
        quote = {
            "name": raw_quote.get("f14"),
            "price": raw_quote.get("f2"),
            "pct": raw_quote.get("f3"),
            "turnoverWan": _number(raw_quote.get("f6")) / 10000 if _number(raw_quote.get("f6")) is not None else None,
            "source": "东方财富",
        }
    except Exception:
        market = "sh" if str(code).startswith("5") else "sz"
        sina_text = _fetch_text(
            f"https://hq.sinajs.cn/list={market}{code}",
            timeout,
            headers={"Referer": "https://finance.sina.com.cn/"},
            encoding="gbk",
        )
        quote = parse_sina_quote(sina_text, code)
    return build_extra_fund_row(code, estimate, quote, now=now or datetime.now(timezone(timedelta(hours=8))))


def parse_sina_quote(text, code):
    match = re.search(r'="(.*)";?\s*$', text or "")
    if not match:
        raise ValueError(f"Sina quote missing: {code}")
    fields = match.group(1).split(",")
    if len(fields) < 10:
        raise ValueError(f"Sina quote incomplete: {code}")
    previous_close = _number(fields[2])
    price = _number(fields[3])
    turnover = _number(fields[9])
    pct = _premium(price, previous_close)
    return {
        "name": fields[0],
        "price": price,
        "pct": pct,
        "turnoverWan": turnover / 10000 if turnover is not None else None,
        "source": "新浪财经",
    }


def append_extra_funds(data, codes=("501312",), timeout=12):
    funds = list(data.get("funds") or [])
    warnings = list(data.get("warnings") or [])
    existing = {str(row.get("code") or "") for row in funds}
    for code in codes:
        if str(code) in existing:
            continue
        try:
            funds.append(load_with_retry(lambda: load_extra_fund(str(code), timeout=timeout), retries=1))
        except Exception:
            warnings.append(f"{code} 补充数据暂时不可用")
    return {**data, "funds": funds, "warnings": warnings}
