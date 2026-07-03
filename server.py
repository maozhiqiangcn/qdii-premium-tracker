from html.parser import HTMLParser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen
import json
import re
import time

HAOETF_CACHE = {"data": None, "updated_at": 0}


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/sse-etf":
            self.handle_sse_etf(parsed)
            return
        if parsed.path == "/api/haoetf":
            self.handle_haoetf(parsed)
            return
        super().do_GET()

    def handle_sse_etf(self, parsed):
        code = parse_qs(parsed.query).get("code", [""])[0]
        if not re.fullmatch(r"\d{6}", code):
            self.write_json({"ok": False, "error": "invalid code"}, 400)
            return

        url = (
            "https://query.sse.com.cn/commonQuery.do"
            "?isPagination=false"
            f"&FUNDID2={code}"
            "&sqlId=COMMON_SSE_CP_JJLB_ETFJJGK_GGSGSHQD_JBXX_C"
            "&jsonCallBack=jsonpCallback"
        )
        request = Request(
            url,
            headers={
                "Referer": f"https://www.sse.com.cn/disclosure/fund/etflist/detail.shtml?etfClass=33&fundid={code}&type=254",
                "User-Agent": "Mozilla/5.0",
            },
        )

        try:
            with urlopen(request, timeout=10) as response:
                body = response.read().decode("utf-8", errors="replace")
            match = re.search(r"jsonpCallback\((.*)\)\s*$", body)
            payload = json.loads(match.group(1) if match else body)
            result = payload.get("result") or []
            row = result[0] if result else None
            self.write_json({"ok": True, "data": row})
        except Exception as exc:
            self.write_json({"ok": False, "error": str(exc)}, 502)

    def handle_haoetf(self, parsed):
        codes = {
            code
            for item in parse_qs(parsed.query).get("codes", [""])[0].split(",")
            for code in [item.strip()]
            if re.fullmatch(r"\d{6}", code)
        }

        request = Request("https://www.haoetf.com/", headers={"User-Agent": "Mozilla/5.0"})
        try:
            data = load_haoetf()
            if codes:
                data["funds"] = [row for row in data["funds"] if row.get("code") in codes]
            self.write_json({"ok": True, "data": data})
        except Exception as exc:
            if HAOETF_CACHE["data"]:
                data = HAOETF_CACHE["data"].copy()
                if codes:
                    data["funds"] = [row for row in data["funds"] if row.get("code") in codes]
                self.write_json({"ok": True, "stale": True, "error": str(exc), "data": data})
                return
            self.write_json({"ok": False, "error": str(exc)}, 502)

    def write_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class HaoEtfParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_row = False
        self.in_cell = False
        self.rows = []
        self.row = []
        self.cell = []

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self.in_row = True
            self.row = []
        elif tag == "td" and self.in_row:
            self.in_cell = True
            self.cell = []

    def handle_data(self, data):
        if self.in_cell:
            text = data.strip()
            if text:
                self.cell.append(text)

    def handle_endtag(self, tag):
        if tag == "td" and self.in_cell:
            self.row.append(" ".join(self.cell).strip())
            self.in_cell = False
        elif tag == "tr" and self.in_row:
            if self.row:
                self.rows.append(self.row)
            self.in_row = False


def parse_haoetf(html):
    parser = HaoEtfParser()
    parser.feed(html)
    funds = []
    for row in parser.rows:
        if len(row) < 18 or not re.fullmatch(r"\d{6}", row[0]):
            continue
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
                "purchaseLimit": clean_dash(row[16]),
                "purchaseFee": clean_dash(row[17]),
                "redeemFee": clean_dash(row[18]) if len(row) > 18 else "",
            }
        )
    return {"funds": funds}


def load_haoetf():
    request = Request("https://www.haoetf.com/", headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(request, timeout=15) as response:
        html = response.read().decode("utf-8", errors="replace")
    data = parse_haoetf(html)
    if data["funds"]:
        HAOETF_CACHE["data"] = data
        HAOETF_CACHE["updated_at"] = time.time()
    return data


def clean_dash(value):
    value = re.sub(r"\s+", " ", value or "").strip()
    return "" if value == "-" else value


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 8766), Handler).serve_forever()
