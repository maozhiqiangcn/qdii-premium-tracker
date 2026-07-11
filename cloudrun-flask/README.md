# 微信云托管 Flask 后端

这个目录用于部署微信云托管后端，提供小程序接口：

- `GET /api/haoetf?codes=513100,161130,161125`
- `GET /api/sse-etf?code=513100`
- `GET /` 健康检查

`/api/haoetf` 会返回 `sourceUpdatedAt`、`generatedAt`、`stale`、`cacheAgeSeconds` 和 `warnings`。接口会补充 HaoETF 未收录的 `501312`，其正式净值来自公开基金净值接口。

## 在微信云托管页面怎么选

你截图里的模板页请选择：

```text
Flask
```

创建完成后，从仓库根目录构建，确保公共解析模块一起进入镜像：

```text
cloudrun-flask/app.py
backend_core.py
cloudrun-flask/requirements.txt
cloudrun-flask/Dockerfile
```

本地构建命令：

```powershell
docker build -f cloudrun-flask/Dockerfile .
```

如果使用压缩包上传，需要把 `backend_core.py` 和 `cloudrun-flask` 目录一起放进压缩包，构建上下文选择压缩包根目录。

## 部署完成后

云托管会给你一个访问域名或服务路径。先测试：

```text
https://你的云托管域名/api/haoetf?codes=513100
```

能返回 `{"ok": true, ...}` 后，再修改小程序：

```js
// miniprogram/config.js
const API_BASE = "https://你的云托管域名";
```

然后在微信开发者工具里重新编译、上传。
