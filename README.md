# 研报侠 · yanbaoxia-web

> 支付宝 AI 付 PAYATHON 2026 参赛作品（Skill Pay 赛道）— 输入股票代码，AI 生成投资研究报告，支付宝付款即交付。

[![Status](https://img.shields.io/badge/%E9%AD%94%E6%90%AD%E5%88%9B%E7%A9%BA%E9%97%B4-Running-2ea44f)](https://www.modelscope.cn/studios/gsym236998/yanbaoxia)
[![SkillPay](https://img.shields.io/badge/SkillPay-%E9%94%80%E5%94%AE%E4%B8%AD-c9a84c)](https://skillpay.alipay.com)
[![Revenue](https://img.shields.io/badge/%E9%A6%96%E6%97%A5%E7%9C%9F%E5%AE%9E%E8%90%A5%E6%94%B6-%C2%A519.80-2ea44f)](#成绩单)

**线上体验**：https://www.modelscope.cn/studios/gsym236998/yanbaoxia （Docker 公网运行中）

## 产品能力

- 输入任意 6 位 A 股代码 → 五源采集（东方财富/腾讯/新浪/baostock）→ 交叉校验 → 图文 HTML 速览研报
- 预置标的（600519）附 15 页完整研报 docx + DCF 估值模型 xlsx
- 支付宝 AI 网页应用收款全链路：下单 → 沙箱收银台 → RSA2 签名回跳 → 异步通知(公网) → 交易查询兜底 → 自动履约交付
- 商户订单查询页；未支付订单访问交付一律 403

## 架构

```
GitHub (push)
  └─ GitHub Actions：注入支付配置Secrets → 推送魔搭创空间仓库
       └─ 魔搭自动构建 Dockerfile (Node20+Python3, :7860)
            └─ 公网 Running（ms.show 直连 + 空间页嵌入）
Express 服务
  ├─ /api/pay                 下单（alipay.trade.page.pay, pageExec）
  ├─ /api/order/:no/status    交易查询（状态映射+履约触发）
  ├─ /api/order/:no/refund[/query] 退款/退款查询（十进制金额+幂等）
  ├─ /api/order/:no/close     关闭交易
  ├─ /alipay/notify           异步通知（验签+业务校验+幂等→success/fail）
  ├─ /return                  同步回跳（Cookie会话绑定查单，不信任URL参数）
  └─ lib/engine.js            交付引擎（预置成品+实时速览研报）
```

## 成绩单（2026-10-25 上线首日）

- ✅ 支付宝三协议签署（SkillPay / AI 按量付费 / 即刻收），应用 2021006171661005 绑定
- ✅ 沙箱全链路真实支付闭环（公网下单→收银台→确认→交付）
- ✅ SkillPay 上架 **yanbaoxia-research**（买断制 ¥9.9）→ **首日 2 单真实成交 ¥19.80**（两个独立账号）
- ✅ 魔搭创空间 Docker 公网 Running，CI/CD 全自动（自动建空间/推代码/构建）

## 快速开始

```bash
npm install && npm start   # http://localhost:3000
```

沙箱凭据由 [alipay-aipay Skill](https://skillpay.alipay.com) 写入 `.alipay-sandbox.json`（不入库）。环境变量见 deploy.md。

## 目录

`routes/payment.js` 支付全接口 · `lib/engine.js` 交付引擎 · `lib/store.js` 持久化订单 · `engine/` 容器内数据脚本 · `deploy.md` 部署指南 · `DEMO.md` 演示脚本

## 免责

本项目为 PAYATHON 2026 参赛作品与研究练习，所有数据来自公开渠道，输出不构成投资建议。
