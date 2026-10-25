# 公网部署方案（含 notify_url 联调）

## 部署前必改
| 项 | 现值（沙箱） | 生产 |
|---|---|---|
| 网关 | https://openapi-sandbox.dl.alipaydev.com/gateway.do | https://openapi.alipay.com/gateway.do（config.js 沙箱常量处） |
| appId/私钥/支付宝公钥 | .alipay-sandbox.json | 应用 2021006171661005 的生产密钥（同一套，勿混用；Node.js 用 PKCS#1） |
| BASE_URL | http://localhost:3000 | 公网 https 域名 |
| ALIPAY_NOTIFY_URL | 空（省略） | 公网 HTTPS 地址，如 https://your-domain.com/alipay/notify |

## 方案A：云服务器（推荐，最贴合 notify_url 要求）
1. 任一云厂商轻量服务器（2C2G 起步），安装 Node ≥18 与 pm2
2. `pm2 start server.js --name yanbaoxia`；Nginx 反代 443 → 3000，配 HTTPS 证书（certbot）
3. 设环境变量 `BASE_URL=https://your-domain` `ALIPAY_NOTIFY_URL=https://your-domain/alipay/notify`
4. 重启后下真实订单：支付宝服务器将回调 notify_url → 验签/幂等/success 回写已在代码内实现
5. 验收：订单状态由异步通知更新；后台日志出现 `[notify]` 成功记录

## 方案B：Serverless/容器平台（快速上线）
- 部署到支持长连接 Node 的平台（如 Rainbond/1Panel/宝塔容器），注意：
  - `.alipay-sandbox.json`/生产密钥用平台密钥管理注入，不进镜像
  - `data/` 订单存储挂持久卷（当前文件存储，生产建议换 SQLite/MySQL）

## 方案C：内网穿透（仅临时演示，不可用于生产 notify_url）
```bash
npx localtunnel --port 3000   # 或 cpolar/frp
BASE_URL=https://xxx.loca.lt npm start
```
限制：免费隧道不稳定，支付宝可能拒绝回调——正式收款必须方案 A/B。

## 上线前检查（对照集成 checklist）
- [ ] 生产密钥三件套同属应用 2021006171661005，私钥为 PKCS#1 原始字符串（无 PEM 头尾）
- [ ] 公网 HTTPS notify_url 联调通过（验签/幂等/success）
- [ ] 数据库替换文件存储（幂等与订单持久化）
- [ ] 移除商户侧 /orders 页或加访问控制（演示页无鉴权）
- [ ] 人工代码审查（支付宝安全红线）

## 方案D：魔搭创空间 Docker 部署（已实施 ✅ 当前主线）

GitHub 仓库：https://github.com/yigenfeng0707-netizen/yanbaoxia-web

**管线**：本地/云端改代码 → `python3 tools/push-github.py "msg"`（gh api Git Data API，绕开 git https 干扰）→ GitHub Actions 自动触发 → 注入沙箱配置 Secret + 公网地址 → git 强推魔搭创空间仓库 → 魔搭自动构建 Dockerfile（监听 7860）→ 公网链接。

**创空间配置文件**（已在仓库内）：
- `ms_deploy.json`：`{"sdk_type":"docker","resource_configuration":"platform/2v-cpu-16g-mem","port":7860}`
- `Dockerfile`：node:20-slim + python3，容器内 ENGINE_WORKBENCH=/opt/workbench，数据写入魔搭持久目录 /mnt/workspace

**你需要在魔搭侧完成的 3 步**：
1. modelscope.cn → 创空间 → 创建：类型选 **Docker**，名称如 `yanbaoxia`（Docker 空间需实名认证）
2. 个人中心 → 访问令牌 → 创建读写 Token
3. 把 Token 给 Agent 设置两个 GitHub Secrets（或自行执行）：
   ```bash
   gh secret set MODELSCOPE_TOKEN --repo yigenfeng0707-netizen/yanbaoxia-web --body "<你的魔搭Token>"
   gh secret set MODELSCOPE_STUDIO --repo yigenfeng0707-netizen/yanbaoxia-web --body "<魔搭用户名>/yanbaoxia"
   ```
4. （上线后）拿到创空间公网地址再设 `PUBLIC_BASE_URL`（支付同步回跳用），再触发一次部署。

**容器内降级说明**：镜像未装 pandas 系依赖，baostock/akshare 两个源自动失效，技术面由新增的腾讯日K源（纯标准库）承担，多源校验仍成立。
