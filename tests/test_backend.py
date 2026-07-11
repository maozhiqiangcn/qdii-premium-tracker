import unittest

from backend_core import (
    build_extra_fund_row,
    build_response,
    is_cache_usable,
    parse_haoetf,
    parse_jsonp_payload,
)


QDII_HTML = """
<html><body>
<p>数据更新时间：2026-07-11 10:58:24</p>
<table><tr>
<td>161130</td><td>纳指LOF</td><td>-</td><td>-</td>
<td>4.4895</td><td>2.95%</td><td>07-09</td><td>4.622</td><td>0.35%</td>
<td>3611.34</td><td>-</td><td>-</td><td>4.4895</td><td>1.48%</td>
<td>07-09</td><td>1.62%</td><td>暂停申购</td><td>1.2%</td><td>1.5%</td>
<td>官网 天天</td>
</tr></table>
</body></html>
"""

ETF_HTML = """
<table><tr>
<td>513100</td><td>纳指ETF</td><td>-</td><td>-</td>
<td>2.0172</td><td>7.77%</td><td>07-09</td><td>2.174</td><td>0.37%</td>
<td>40172.94</td><td>-</td><td>-</td><td>2.0172</td><td>1.56%</td>
<td>07-09</td><td>1.62%</td><td>0.5%</td><td>0.5%</td><td>官网 天天</td>
</tr></table>
"""

MALFORMED_HTML = """
<table><tr>
<td>513100</td><td>纳指ETF</td><td>-</td><td>-</td>
<td>官网</td><td>不是百分比</td><td>07-09</td><td>错误价格</td>
<td>0.37%</td><td>40172.94</td><td>-</td><td>-</td><td>2.0172</td>
<td>1.56%</td><td>07-09</td><td>1.62%</td><td>0.5%</td><td>0.5%</td>
</tr></table>
"""

MEASURED_HTML = ETF_HTML.replace("<td>-</td><td>-</td>", "<td>2.0200 测</td><td>0.40% 测</td>", 1)


class BackendParserTests(unittest.TestCase):
    def test_qdii_row_keeps_purchase_limit_and_fees(self):
        data = parse_haoetf(QDII_HTML)
        row = data["funds"][0]
        self.assertEqual(row["purchaseLimit"], "暂停申购")
        self.assertEqual(row["purchaseFee"], "1.2%")
        self.assertEqual(row["redeemFee"], "1.5%")

    def test_etf_row_does_not_shift_link_text_into_fee(self):
        data = parse_haoetf(ETF_HTML)
        row = data["funds"][0]
        self.assertEqual(row["code"], "513100")
        self.assertEqual(row["latestEstimate"], "2.0172")
        self.assertEqual(row["latestPremium"], "7.77%")
        self.assertEqual(row["purchaseLimit"], "")
        self.assertEqual(row["purchaseFee"], "0.5%")
        self.assertEqual(row["redeemFee"], "0.5%")
        self.assertNotIn("官网", row["redeemFee"])

    def test_source_update_time_is_extracted(self):
        data = parse_haoetf(QDII_HTML)
        self.assertEqual(data["sourceUpdatedAt"], "2026-07-11T10:58:24+08:00")

    def test_malformed_core_row_is_omitted_with_warning(self):
        data = parse_haoetf(MALFORMED_HTML)
        self.assertEqual(data["funds"], [])
        self.assertEqual(len(data["warnings"]), 1)

    def test_known_measurement_marker_is_cleaned(self):
        data = parse_haoetf(MEASURED_HTML)
        self.assertEqual(data["funds"][0]["realtimeEstimate"], "2.0200")
        self.assertEqual(data["funds"][0]["realtimePremium"], "0.40%")

    def test_response_metadata_remains_backward_compatible(self):
        parsed = parse_haoetf(QDII_HTML)
        response = build_response(parsed, stale=False, cache_age_seconds=0)
        self.assertTrue(response["ok"])
        self.assertIn("funds", response["data"])
        self.assertEqual(response["source"], "HaoETF")
        self.assertFalse(response["stale"])
        self.assertEqual(response["cacheAgeSeconds"], 0)

    def test_cache_older_than_six_hours_is_rejected(self):
        self.assertTrue(is_cache_usable(updated_at=1, now=21601, max_age=21600))
        self.assertFalse(is_cache_usable(updated_at=1, now=21602, max_age=21600))

    def test_501312_uses_published_nav_not_stale_estimate(self):
        row = build_extra_fund_row(
            "501312",
            {
                "fundcode": "501312",
                "name": "海外科技LOF",
                "dwjz": "2.3699",
                "jzrq": "2026-07-10",
                "gsz": "2.1000",
                "gztime": "2026-07-09 15:00",
            },
            {"price": 2.367, "pct": 0.17, "turnoverWan": 100, "name": "海外科技LOF"},
            now="2026-07-11T11:00:00+08:00",
        )
        self.assertEqual(row["latestEstimate"], "2.3699")
        self.assertEqual(row["realtimeEstimate"], "")
        self.assertEqual(row["realtimePremium"], "")
        self.assertEqual(row["latestPremium"], "-0.12%")
        self.assertFalse(row["realtimeFresh"])

    def test_same_day_501312_estimate_may_be_displayed_as_realtime(self):
        row = build_extra_fund_row(
            "501312",
            {
                "fundcode": "501312",
                "name": "海外科技LOF",
                "dwjz": "2.3000",
                "jzrq": "2026-07-10",
                "gsz": "2.3500",
                "gztime": "2026-07-11 10:30",
            },
            {"price": 2.367, "pct": 0.17, "turnoverWan": 100, "name": "海外科技LOF"},
            now="2026-07-11T11:00:00+08:00",
        )
        self.assertEqual(row["realtimeEstimate"], "2.3500")
        self.assertEqual(row["realtimePremium"], "0.72%")
        self.assertTrue(row["realtimeFresh"])

    def test_fund_jsonp_payload_is_parsed_without_executing_script(self):
        payload = parse_jsonp_payload('jsonpgz({"fundcode":"501312","dwjz":"2.3699"});', "jsonpgz")
        self.assertEqual(payload["fundcode"], "501312")
        self.assertEqual(payload["dwjz"], "2.3699")


if __name__ == "__main__":
    unittest.main()
