# QDII Premium Tracker

一个用于跟踪国内 QDII / LOF 基金估值与溢价的小工具，数据口径参考 HaoETF。

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

## 免责声明

数据仅用于个人观察和研究参考，不构成投资建议。
