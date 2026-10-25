# 研报侠 · yanbaoxia-web（支付宝AI付 PAYATHON 2026 参赛站点）

AI 网页应用收款（webpay）沙箱集成：`alipay.trade.page.pay` 下单 + 查询/退款/退款查询/关闭 + 异步通知。

## 运行

```bash
npm install
npm start          # http://localhost:3000
```

沙箱凭据由 alipay-aipay Skill 自动写入项目根 `.alipay-sandbox.json`（已加入 .gitignore，勿提交）。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | 3000 | 服务端口 |
| `BASE_URL` | http://localhost:3000 | 同步回跳 return_url 的基地址，部署后改为公网地址 |
| `ALIPAY_NOTIFY_URL` | 空 | 公网 HTTPS 异步通知地址；为空时整体省略 notify_url，以交易查询兜底 |

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/pay | 下单，返回 paymentHtml（前端渲染并自动提交） |
| GET | /api/order/:outTradeNo/status | 交易查询（状态映射 PAID/PENDING_PAYMENT/CLOSED/UNKNOWN） |
| POST | /api/order/:outTradeNo/refund | 退款 `{refundAmount, reason}`，校验累计不超实付 |
| GET | /api/order/:outTradeNo/refund/:outRequestNo | 退款查询（建议距退款 ≥10 秒） |
| POST | /api/order/:outTradeNo/close | 关闭未支付订单 |
| POST | /alipay/notify | 异步通知（表单验签+业务校验+幂等，回 success/fail） |
| GET | /return | 同步回跳结果页（不信任回跳参数，以服务端查询为准） |

## 沙箱买家账号

沙箱配置中的买家账号（user）用于在支付宝沙箱收银台完成付款测试；账号信息见 `.alipay-sandbox.json`（沙箱专用，勿外传生产密钥）。

## 交付引擎（lib/engine.js）

付款成功后自动履约：

- **预置成品**：标的 `600519` 额外交付 15 页完整研报 docx + DCF 估值模型 xlsx（来自投研工作台 output/）；
- **任意代码**：调用投研工作台 `collect_stock.py` 采集实时多源数据（东财/腾讯/新浪/baostock 交叉校验），渲染速览研报 HTML；
- **交付端点**：`GET /api/order/:no/deliverables`（校验订单已支付）→ 文件列表；`GET /api/order/:no/file/:idx` → 校验后下载；
- 支付结果确认依赖异步通知/交易查询（本地沙箱以查询兜底），未支付订单访问交付一律 403。
