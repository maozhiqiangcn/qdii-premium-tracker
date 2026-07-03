from html.parser import HTMLParser
from urllib.request import Request, urlopen
import json
import os
import re
import time

from flask import Flask, jsonify, request


app = Flask(__name__)
HAOETF_CACHE = {"data": None, "updated_at": 0}


@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


@app.get("/")
def health():
    return jsonify({"ok": True, "service": "qdii-premium-api"})


@app.get("/api/haoetf")
def haoetf():
    codes = {
        code
        for item in request.args.get("codes", "").split(",")
        for code in [item.strip()]
        if re.fullmatch(r"\d{6}", code)
    }

    try:
        data = load_haoetf()
        if codes:
            data["funds"] = [row for row in data["funds"] if row.get("code") in codes]
        return jsonify({"ok": True, "data": data})
    except Exception as exc:
        if HAOETF_CACHE["data"]:
            data = HAOETF_CACHE["data"].copy()
            if codes:
                data["funds"] = [row for row in data["funds"] if row.get("code") in codes]
            return jsonify({"ok": True, "stale": True, "error": str(exc), "data": data})
        return jsonify({"ok": False, "error": str(exc)}), 502


@app.get("/api/sse-etf")
def sse_etf():
    code = request.args.get("code", "")
    if not re.fullmatch(r"\d{6}", code):
        return jsonify({"ok": False, "error": "invalid code"}), 400

    url = (
        "https://query.sse.com.cn/commonQuery.do"
        "?isPagination=false"
        f"&FUNDID2={code}"
        "&sqlId=COMMON_SSE_CP_JJLB_ETFJJGK_GGSGSHQD_JBXX_C"
        "&jsonCallBack=jsonpCallback"
    )
    upstream_request = Request(
        url,
        headers={
            "Referer": f"https://www.sse.com.cn/disclosure/fund/etflist/detail.shtml?etfClass=33&fundid={code}&type=254",
            "User-Agent": "Mozilla/5.0",
        },
    )

    try:
        with urlopen(upstream_request, timeout=10) as response:
            body = response.read().decode("utf-8", errors="replace")
        match = re.search(r"jsonpCallback\((.*)\)\s*$", body)
        payload = json.loads(match.group(1) if match else body)
        result = payload.get("result") or []
        return jsonify({"ok": True, "data": result[0] if result else None})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 502


def load_haoetf():
    upstream_request = Request("https://www.haoetf.com/", headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(upstream_request, timeout=15) as response:
        html = response.read().decode("utf-8", errors="replace")
    data = parse_haoetf(html)
    if data["funds"]:
        HAOETF_CACHE["data"] = data
        HAOETF_CACHE["updated_at"] = time.time()
    return data


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


def clean_dash(value):
    value = re.sub(r"\s+", " ", value or "").strip()
    return "" if value == "-" else value


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "80"))
    app.run(host="0.0.0.0", port=port)
