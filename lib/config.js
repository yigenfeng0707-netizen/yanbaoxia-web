// 支付配置加载器：从项目根读取已验证的 .alipay-sandbox.json（禁止依赖 cwd）
// Node.js 语言规则：使用 appPrivatePkcsKey（PKCS#1 原始值，禁止任何格式加工）
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");

// env.production 由部署管线（GitHub Actions）注入到镜像，加载为运行时环境变量
(function loadEnvFile() {
  const f = path.join(PROJECT_ROOT, "env.production");
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
})();
const SANDBOX_CONFIG_PATH = path.join(PROJECT_ROOT, ".alipay-sandbox.json");

// 引擎工作台：默认为仓库旁的投研工作台；容器部署用 ENGINE_WORKBENCH 指向镜像内路径
const WORKBENCH = process.env.ENGINE_WORKBENCH
  ? path.resolve(process.env.ENGINE_WORKBENCH)
  : path.resolve(PROJECT_ROOT, "..", "投研工作台");

// 数据目录：魔搭创空间持久化目录优先（/mnt/workspace），本地退回项目 data/
const DATA_DIR = process.env.DATA_DIR
  || (fs.existsSync("/mnt/workspace") ? "/mnt/workspace/yanbaoxia-data" : path.join(PROJECT_ROOT, "data"));
const SANDBOX_GATEWAY = "https://openapi-sandbox.dl.alipaydev.com/gateway.do";

function loadAlipayConfig() {
  const raw = JSON.parse(fs.readFileSync(SANDBOX_CONFIG_PATH, "utf8"));
  const app = (raw.appIds || [])[0];
  if (!app || !app.appId || !app.appPrivatePkcsKey || !app.alipayPublicKey) {
    throw new Error("沙箱支付配置缺失关键字段（appId/appPrivatePkcsKey/alipayPublicKey）");
  }
  const partner = (raw.sandboxAccounts || {}).partner || {};
  return {
    appId: app.appId,
    privateKey: app.appPrivatePkcsKey, // PKCS#1，非 Java 语言专用字段
    alipayPublicKey: app.alipayPublicKey,
    gateway: process.env.ALIPAY_GATEWAY || SANDBOX_GATEWAY,
    signType: "RSA2",
    sellerId: partner.merchantId || null,
    sellerEmail: partner.email || null,
  };
}

const BASE_URL = (process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, "");
const NOTIFY_URL = (process.env.ALIPAY_NOTIFY_URL || "").trim(); // 无公网 HTTPS 时保持为空并整体省略

module.exports = { PROJECT_ROOT, SANDBOX_CONFIG_PATH, WORKBENCH, DATA_DIR, loadAlipayConfig, BASE_URL, NOTIFY_URL };
