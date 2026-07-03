# 微信云托管 Flask 后端

这个目录用于部署微信云托管后端，提供小程序接口：

- `GET /api/haoetf?codes=513100,161130,161125`
- `GET /api/sse-etf?code=513100`
- `GET /` 健康检查

## 在微信云托管页面怎么选

你截图里的模板页请选择：

```text
Flask
```

创建完成后，把这个目录里的文件上传/替换到云托管服务代码中：

```text
cloudrun-flask/app.py
cloudrun-flask/requirements.txt
cloudrun-flask/Dockerfile
```

如果控制台支持直接从本地目录上传，选择 `cloudrun-flask` 目录即可。

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
