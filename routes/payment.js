// AI网页应用收款（webpay）全部适用接口：下单/查询/退款/退款查询/关闭 + 异步通知
const express = require("express");
const { loadAlipayConfig, BASE_URL, NOTIFY_URL } = require("../lib/config");
const { getAlipaySdk } = require("../lib/alipay");
const store = require("../lib/store");
const { formatAlipayTimestamp } = require("../lib/format");
const { toCents, centsToText, amountEquals } = require("../lib/amount");
const engine = require("../lib/engine");

const router = express.Router();
const cfg = loadAlipayConfig();

function genId(prefix) {
  return `${prefix}${Date.now()}${Math.floor(1000 + Math.random() * 9000)}`;
}

// ---- 下单：alipay.trade.page.pay（页面跳转类，必须 pageExec + POST）----
router.post("/api/pay", (req, res) => {
  try {
    const sku = req.body && req.body.sku === "report_pro" ? "report_pro" : "report_std";
    const spec = {
      report_std: { subject: "研报侠·单篇AI研究报告（示例）", amount: "9.90" },
      report_pro: { subject: "研报侠·深度研报+估值模型（示例）", amount: "19.90" },
    }[sku];
    const outTradeNo = genId("YBX");
    const stockCode = String((req.body && req.body.stockCode) || "").trim();
    if (!/^\d{6}$/.test(stockCode)) return res.status(400).json({ error: "INVALID_STOCK_CODE", message: "请输入6位股票代码" });
    store.createOrder({ outTradeNo, subject: `${spec.subject} · ${stockCode}`, totalAmount: spec.amount, createdAt: formatAlipayTimestamp(), meta: { stockCode, sku } });

    const requestOptions = {
      returnUrl: `${BASE_URL}/return`, // 默认同步回跳，指向本项目真实 GET 路由
      bizContent: {
        out_trade_no: outTradeNo,
        total_amount: spec.amount,
        subject: spec.subject,
        product_code: "FAST_INSTANT_TRADE_PAY",
      },
    };
    if (NOTIFY_URL) requestOptions.notifyUrl = NOTIFY_URL; // 无公网 HTTPS 时整体省略，不传空值

    const paymentHtml = getAlipaySdk().pageExec("alipay.trade.page.pay", "POST", requestOptions);
    // 会话绑定：回跳页只信任服务端 Cookie 中的订单标识，不信任可篡改的 URL 参数
    res.setHeader("Set-Cookie", `ybx_order=${outTradeNo}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
    res.json({ outTradeNo, paymentHtml });
  } catch (e) {
    res.status(500).json({ error: "CREATE_PAY_FAILED", message: e.message });
  }
});

// ---- 交易查询：alipay.trade.query（服务端主动核实，回跳参数不作数）----
const TRADE_STATE_MAP = { TRADE_SUCCESS: "PAID", TRADE_FINISHED: "PAID", WAIT_BUYER_PAY: "PENDING_PAYMENT", TRADE_CLOSED: "CLOSED" };
router.get("/api/order/:outTradeNo/status", async (req, res) => {
  const order = store.findByOutTradeNo(req.params.outTradeNo);
  if (!order) return res.status(404).json({ error: "ORDER_NOT_FOUND" });
  try {
    const result = await getAlipaySdk().exec("alipay.trade.query", { bizContent: { out_trade_no: order.outTradeNo } });
    if (result.code !== "10000") {
      if (order.status === "PAID") ensureFulfillment(order.outTradeNo);
      return res.json({ orderStatus: order.status, alipayStatus: "UNKNOWN", message: result.sub_msg || result.msg || "查询未返回业务状态" });
    }
    const alipayStatus = result.trade_status || result.tradeStatus || "UNKNOWN";
    const mapped = TRADE_STATE_MAP[alipayStatus] || "UNKNOWN";
    if (mapped === "PAID") store.markPaidIdempotently(order.outTradeNo, result.trade_no || result.tradeNo, formatAlipayTimestamp());
    if (store.findByOutTradeNo(order.outTradeNo).status === "PAID") ensureFulfillment(order.outTradeNo);
    res.json({ orderStatus: mapped === "UNKNOWN" ? order.status : mapped, alipayStatus, tradeNo: result.trade_no || result.tradeNo || order.tradeNo });
  } catch (e) {
    res.json({ orderStatus: order.status, alipayStatus: "UNKNOWN", message: e.message });
  }
});

// ---- 会话绑定查单：回跳页专用（不信任 URL 参数）----
function readCookie(req, name) {
  const h = req.headers.cookie || "";
  for (const part of h.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}
router.get("/api/my/order/status", async (req, res) => {
  const no = readCookie(req, "ybx_order");
  if (!no) return res.status(404).json({ error: "NO_SESSION_ORDER" });
  const order = store.findByOutTradeNo(no);
  if (!order) return res.status(404).json({ error: "ORDER_NOT_FOUND" });
  try {
    const result = await getAlipaySdk().exec("alipay.trade.query", { bizContent: { out_trade_no: order.outTradeNo } });
    if (result.code !== "10000") {
      if (order.status === "PAID") ensureFulfillment(order.outTradeNo);
      return res.json({ outTradeNo: order.outTradeNo, orderStatus: order.status, alipayStatus: "UNKNOWN" });
    }
    const alipayStatus = result.trade_status || result.tradeStatus || "UNKNOWN";
    const mapped = TRADE_STATE_MAP[alipayStatus] || "UNKNOWN";
    if (mapped === "PAID") store.markPaidIdempotently(order.outTradeNo, result.trade_no || result.tradeNo, formatAlipayTimestamp());
    if (store.findByOutTradeNo(order.outTradeNo).status === "PAID") ensureFulfillment(order.outTradeNo);
    res.json({ outTradeNo: order.outTradeNo, orderStatus: mapped === "UNKNOWN" ? order.status : mapped, alipayStatus });
  } catch (e) {
    res.json({ outTradeNo: order.outTradeNo, orderStatus: order.status, alipayStatus: "UNKNOWN" });
  }
});

// ---- 退款：alipay.trade.refund（累计退款不得超实付；新退款用新 out_request_no，重试复用）----
router.post("/api/order/:outTradeNo/refund", async (req, res) => {
  const order = store.findByOutTradeNo(req.params.outTradeNo);
  if (!order) return res.status(404).json({ error: "ORDER_NOT_FOUND" });
  if (order.status !== "PAID") return res.status(409).json({ error: "ORDER_NOT_PAID" });

  const refundCents = toCents(req.body.refundAmount);
  if (refundCents === null || refundCents <= 0n) return res.status(400).json({ error: "INVALID_REFUND_AMOUNT" });
  const refunded = (order.refunds || []).filter((r) => r.status === "SUCCESS").reduce((s, r) => s + toCents(r.amount), 0n);
  if (refunded + refundCents > toCents(order.totalAmount)) {
    return res.status(400).json({ error: "REFUND_EXCEEDS_PAID", refundedSoFar: centsToText(refunded) });
  }
  const outRequestNo = genId("R");
  try {
    const result = await getAlipaySdk().exec("alipay.trade.refund", {
      bizContent: { out_trade_no: order.outTradeNo, refund_amount: centsToText(refundCents), refund_reason: req.body.reason || "用户申请退款", out_request_no: outRequestNo },
    });
    if (result.code === "10000") {
      const fundChanged = (result.fund_change || result.fundChange) === "Y";
      store.addRefundRecord(order.outTradeNo, { outRequestNo, amount: centsToText(refundCents), reason: req.body.reason || "用户申请退款", status: fundChanged ? "SUCCESS" : "PENDING", at: formatAlipayTimestamp() });
      if (fundChanged && refunded + refundCents === toCents(order.totalAmount)) {
        store.markRefunded(order.outTradeNo);
      }
      return res.json({ outRequestNo, accepted: true, fundChange: fundChanged ? "Y" : "N", message: fundChanged ? "退款成功" : "退款受理成功，资金变化待确认，请稍后用退款查询核实" });
    }
    res.status(502).json({ error: "REFUND_FAILED", message: result.sub_msg || result.msg });
  } catch (e) {
    res.status(500).json({ error: "REFUND_EXCEPTION", message: e.message });
  }
});

// ---- 退款查询：alipay.trade.fastpay.refund.query（建议距退款 ≥10 秒）----
router.get("/api/order/:outTradeNo/refund/:outRequestNo", async (req, res) => {
  const order = store.findByOutTradeNo(req.params.outTradeNo);
  if (!order) return res.status(404).json({ error: "ORDER_NOT_FOUND" });
  try {
    const result = await getAlipaySdk().exec("alipay.trade.fastpay.refund.query", {
      bizContent: { out_trade_no: order.outTradeNo, out_request_no: req.params.outRequestNo },
    });
    if (result.code === "10000" && (result.refund_status || result.refundStatus) === "REFUND_SUCCESS") {
      store.updateRefund(order.outTradeNo, req.params.outRequestNo, { status: "SUCCESS" });
      return res.json({ refundStatus: "REFUND_SUCCESS" });
    }
    res.json({ refundStatus: result.refund_status || "UNKNOWN", message: result.sub_msg || result.msg });
  } catch (e) {
    res.status(500).json({ error: "REFUND_QUERY_EXCEPTION", message: e.message });
  }
});

// ---- 关闭交易：alipay.trade.close（仅未支付订单）----
router.post("/api/order/:outTradeNo/close", async (req, res) => {
  const order = store.findByOutTradeNo(req.params.outTradeNo);
  if (!order) return res.status(404).json({ error: "ORDER_NOT_FOUND" });
  try {
    const result = await getAlipaySdk().exec("alipay.trade.close", { bizContent: { out_trade_no: order.outTradeNo } });
    if (result.code === "10000") { store.closeOrder(order.outTradeNo); return res.json({ closed: true }); }
    res.status(502).json({ error: "CLOSE_FAILED", message: result.sub_msg || result.msg });
  } catch (e) {
    res.status(500).json({ error: "CLOSE_EXCEPTION", message: e.message });
  }
});

// ---- 商户侧订单列表（演示用，不含敏感数据）----
router.get("/api/orders", (_req, res) => {
  res.json(store.listOrders());
});

// ---- 履约：PAID 后触发研报交付（预置成品 + 实时数据速览研报）----
const fulfillmentMemory = new Set();
function ensureFulfillment(outTradeNo) {
  const order = store.findByOutTradeNo(outTradeNo);
  if (!order || order.status !== "PAID") return;
  if (order.deliverable && order.deliverable.status === "READY") return; // GENERATING 可能是重启遗留的孤儿状态，由 fulfillmentMemory 防并发重入
  if (fulfillmentMemory.has(outTradeNo)) return;
  fulfillmentMemory.add(outTradeNo);
  const code = (order.meta && order.meta.stockCode) || "";
  const files = engine.prebuiltFiles(code).map((f) => ({ label: f.label, path: f.path, filename: f.filename }));
  store.updateOrder(outTradeNo, (o) => { o.deliverable = { status: "GENERATING", files, generatedAt: formatAlipayTimestamp() }; });
  console.log(`[fulfillment] start code=${code} order=${outTradeNo}`);
  engine.generateQuickReport(code, outTradeNo).then((r) => {
    console.log(`[fulfillment] done order=${outTradeNo} ok=${r.ok} ${r.error || ""}`);
    store.updateOrder(outTradeNo, (o) => {
      if (r.ok) {
        o.deliverable.files.push({ label: "速览研报（实时多源数据，HTML）", path: r.path, filename: `${code}_速览研报.html` });
        o.deliverable.status = "READY";
      } else if (o.deliverable.files.length > 0) {
        o.deliverable.status = "READY";
        o.deliverable.note = "速览报告生成失败：" + r.error;
      } else {
        o.deliverable.status = "FAILED";
        o.deliverable.note = "生成失败：" + r.error;
      }
    });
    fulfillmentMemory.delete(outTradeNo);
  }).catch((e) => {
    console.log(`[fulfillment] exception order=${outTradeNo}:`, e && e.message);
    store.updateOrder(outTradeNo, (o) => { if (!o.deliverable || o.deliverable.status === "GENERATING") { o.deliverable = o.deliverable || { files: [] }; o.deliverable.status = o.deliverable.files.length ? "READY" : "FAILED"; o.deliverable.note = "生成异常：" + (e && e.message); } });
    fulfillmentMemory.delete(outTradeNo);
  });
}

router.get("/api/order/:outTradeNo/deliverables", (req, res) => {
  const order = store.findByOutTradeNo(req.params.outTradeNo);
  if (!order) return res.status(404).json({ error: "ORDER_NOT_FOUND" });
  if (order.status !== "PAID") return res.status(403).json({ error: "ORDER_NOT_PAID" });
  if (!order.deliverable) return res.json({ status: "PENDING", files: [] });
  res.json({ status: order.deliverable.status, note: order.deliverable.note || null, stockCode: order.meta && order.meta.stockCode,
             files: (order.deliverable.files || []).map((f, i) => ({ index: i, label: f.label, filename: f.filename, url: `/api/order/${order.outTradeNo}/file/${i}` })) });
});

router.get("/api/order/:outTradeNo/file/:idx", (req, res) => {
  const order = store.findByOutTradeNo(req.params.outTradeNo);
  if (!order) return res.status(404).json({ error: "ORDER_NOT_FOUND" });
  if (order.status !== "PAID") return res.status(403).json({ error: "ORDER_NOT_PAID" });
  const f = order.deliverable && order.deliverable.files && order.deliverable.files[Number(req.params.idx)];
  if (!f || !require("fs").existsSync(f.path)) return res.status(404).json({ error: "FILE_NOT_READY" });
  res.download(f.path, f.filename);
});

// ---- 异步通知：POST 表单 + SDK 验签 + 业务校验 + 幂等 + success/fail 纯文本 ----
router.post("/alipay/notify", express.urlencoded({ extended: false }), async (req, res) => {
  const params = { ...req.body };
  const fail = (msg) => { console.warn("[notify:fail]", msg); return res.type("text/plain").send("fail"); };
  try {
    const sdk = getAlipaySdk();
    if (typeof sdk.checkNotifySignV2 !== "function") return fail("SDK 未暴露 checkNotifySignV2");
    if (!sdk.checkNotifySignV2(params)) return fail("验签失败");

    if (params.app_id !== cfg.appId) return fail("app_id 不匹配");
    const order = store.findByOutTradeNo(params.out_trade_no);
    if (!order) return fail("订单不存在");
    if (!amountEquals(order.totalAmount, params.total_amount)) return fail("金额不一致");
    if (!((cfg.sellerId && params.seller_id === cfg.sellerId) || (cfg.sellerEmail && params.seller_email === cfg.sellerEmail))) {
      return fail("卖家身份不一致");
    }
    if (!store.insertNotifyOnce({ notifyId: params.notify_id, tradeNo: params.trade_no, outTradeNo: params.out_trade_no, tradeStatus: params.trade_status })) {
      return res.type("text/plain").send("success"); // 重复通知直接确认
    }
    const isPaid = (params.trade_status === "TRADE_SUCCESS" || params.trade_status === "TRADE_FINISHED") && !params.out_biz_no && !params.gmt_refund && !params.refund_fee;
    if (isPaid) {
      store.markPaidIdempotently(params.out_trade_no, params.trade_no, formatAlipayTimestamp());
      ensureFulfillment(params.out_trade_no);
    }
    else store.recordNonPaidTradeEvent(params.out_trade_no, params.trade_status);
    res.type("text/plain").send("success");
  } catch (e) {
    console.warn("[notify:exception]", e.message);
    res.type("text/plain").send("fail");
  }
});

module.exports = router;
