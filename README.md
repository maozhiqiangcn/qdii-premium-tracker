# QDII Premium Tracker

一个用于跟踪国内 QDII / LOF 基金估值与溢价的小工具，数据口径参考 HaoETF。

## 数据口径

- 基金公司公布的净值是正式净值。
- `T-1估值` 和 `T-1溢价` 来自公开估值数据，并显示对应日期。
- 实时估值只有在数据源明确提供且时间有效时才展示；否则显示 `--`。
- 纳斯达克100、纳指期货/夜盘和 USD/CNH 仅作为参考行情，不参与正式净值计算。
- 上游失败时最多使用六小时内的上次成功数据，并明确标注为 `缓存数据`。
- 溢价率统一按 `场内价格 / 对应净值或估值 - 1` 计算。

## 内容

- `index.html`：桌面网页版本。
- `mobile.html`：手机网页版本。
- `server.py`：本地开发服务，提供 HaoETF 数据转发接口。
- `cloudrun-flask/`：微信云托管 Flask 后端。
- `miniprogram/`：微信小程序前端。

## 本地运行

```powershell
python server.py
```

然后打开：

```text
http://127.0.0.1:8766/index.html
```

手机网页版本：

```text
http://127.0.0.1:8766/mobile.html
```

## 小程序

用微信开发者工具导入：

```text
miniprogram
```

当前小程序默认请求微信云托管公网接口。正式发布前建议绑定自定义域名并在小程序后台配置 `request 合法域名`。

网页和小程序提醒都只在页面处于打开状态时工作，不是后台推送。

## 测试

```powershell
node --test fund-core.test.js client-runtime.test.js mobile-data.test.js miniprogram/pages/index/fundMetrics.test.js miniprogram/cloudfunctions/haoetf/index.test.js
python -m unittest discover -s tests -v
```

## 免责声明

数据仅用于个人观察和研究参考，不构成投资建议。
