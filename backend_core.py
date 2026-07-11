from datetime import datetime, timezone
from html.parser import HTMLParser
import re


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
