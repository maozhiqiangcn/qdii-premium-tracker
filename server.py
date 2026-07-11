from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen
import json
import re
import time

from backend_core import build_response, parse_haoetf

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
            self.write_json(build_response(data))
        except Exception as exc:
            if HAOETF_CACHE["data"]:
                data = HAOETF_CACHE["data"].copy()
                if codes:
                    data["funds"] = [row for row in data["funds"] if row.get("code") in codes]
                age = max(0, time.time() - HAOETF_CACHE["updated_at"])
                payload = build_response(data, stale=True, cache_age_seconds=age)
                payload["warnings"].append("上游暂时不可用，当前展示缓存数据")
                self.write_json(payload)
                return
            self.write_json({"ok": False, "error": str(exc)}, 502)

    def write_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def load_haoetf():
    request = Request("https://www.haoetf.com/", headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(request, timeout=15) as response:
        html = response.read().decode("utf-8", errors="replace")
    data = parse_haoetf(html)
    if data["funds"]:
        HAOETF_CACHE["data"] = data
        HAOETF_CACHE["updated_at"] = time.time()
    return data


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 8766), Handler).serve_forever()
