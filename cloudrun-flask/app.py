from urllib.request import Request, urlopen
import json
import os
import re
import time

from flask import Flask, jsonify, request
from backend_core import append_extra_funds, build_response, is_cache_usable, load_haoetf_source


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
        return jsonify(build_response(data))
    except Exception as exc:
        if HAOETF_CACHE["data"] and is_cache_usable(HAOETF_CACHE["updated_at"], time.time()):
            data = HAOETF_CACHE["data"].copy()
            if codes:
                data["funds"] = [row for row in data["funds"] if row.get("code") in codes]
            age = max(0, time.time() - HAOETF_CACHE["updated_at"])
            payload = build_response(data, stale=True, cache_age_seconds=age)
            payload["warnings"].append("上游暂时不可用，当前展示缓存数据")
            return jsonify(payload)
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
    data = append_extra_funds(load_haoetf_source(timeout=12, retries=1), timeout=12)
    if data["funds"]:
        HAOETF_CACHE["data"] = data
        HAOETF_CACHE["updated_at"] = time.time()
    return data


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "80"))
    app.run(host="0.0.0.0", port=port)
