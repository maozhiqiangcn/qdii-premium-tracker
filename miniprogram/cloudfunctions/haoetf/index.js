const https = require("https");

const API_TIMEOUT_MS = 12_000;
const API_URL = "https://flask-7ux0-271799-9-1444624345.sh.run.tcloudbase.com/api/haoetf";

function requestJson(url = API_URL, timeoutMs = API_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { Accept: "application/json" } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`upstream status ${response.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error("invalid upstream JSON"));
        }
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error("upstream timeout")));
    request.on("error", reject);
  });
}

function createMain(requestImpl = requestJson) {
  return async function main() {
    try {
      return await requestImpl(API_URL, API_TIMEOUT_MS);
    } catch {
      return { ok: false, error: "行情服务暂时不可用" };
    }
  };
}

exports.API_TIMEOUT_MS = API_TIMEOUT_MS;
exports.createMain = createMain;
exports.requestJson = requestJson;
exports.main = createMain();
