// 文件持久化订单与通知事件存储（生产建议替换为数据库；本存储保证原子写与幂等）
const fs = require("fs");
const path = require("path");

const { DATA_DIR } = require("./config");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const EVENTS_FILE = path.join(DATA_DIR, "notify_events.json");

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function writeJson(file, obj) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

const orders = readJson(ORDERS_FILE, {});
const events = readJson(EVENTS_FILE, {});

function saveOrders() { writeJson(ORDERS_FILE, orders); }
function saveEvents() { writeJson(EVENTS_FILE, events); }

function createOrder({ outTradeNo, subject, totalAmount, createdAt, meta }) {
  orders[outTradeNo] = { outTradeNo, subject, totalAmount, status: "PENDING_PAYMENT", tradeNo: null, paidAt: null, closedAt: null, refunds: [], events: [], createdAt, meta: meta || {} };
  saveOrders();
  return orders[outTradeNo];
}
function listOrders() {
  return Object.values(orders)
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
    .map((o) => ({ outTradeNo: o.outTradeNo, subject: o.subject, totalAmount: o.totalAmount, status: o.status,
                   stockCode: o.meta && o.meta.stockCode, deliverable: o.deliverable ? { status: o.deliverable.status, note: o.deliverable.note || null,
                   files: (o.deliverable.files || []).map((f, i) => ({ index: i, label: f.label, url: `/api/order/${o.outTradeNo}/file/${i}` })) } : null }));
}
function updateOrder(no, mut) {
  const o = orders[no];
  if (!o) return null;
  mut(o);
  saveOrders();
  return o;
}
function findByOutTradeNo(no) { return orders[no] || null; }
function markPaidIdempotently(no, tradeNo, paidAt) {
  const o = orders[no];
  if (!o || o.status === "PAID") return o;
  o.status = "PAID"; o.tradeNo = tradeNo || o.tradeNo; o.paidAt = paidAt || o.paidAt;
  saveOrders();
  return o;
}
function recordNonPaidTradeEvent(no, tradeStatus) {
  const o = orders[no];
  if (!o) return;
  o.events.push({ type: "NON_PAID_NOTIFY", tradeStatus, at: new Date().toISOString() });
  if (tradeStatus === "TRADE_CLOSED" && o.status === "PENDING_PAYMENT") { o.status = "CLOSED"; o.closedAt = new Date().toISOString(); }
  saveOrders();
}
function closeOrder(no) {
  const o = orders[no];
  if (o && o.status === "PENDING_PAYMENT") { o.status = "CLOSED"; o.closedAt = new Date().toISOString(); saveOrders(); }
  return o;
}
function addRefundRecord(no, rec) {
  const o = orders[no];
  if (!o) return null;
  o.refunds.push(rec);
  saveOrders();
  return rec;
}
function updateRefund(no, outRequestNo, patch) {
  const o = orders[no];
  if (!o) return null;
  const r = o.refunds.find((x) => x.outRequestNo === outRequestNo);
  if (r) Object.assign(r, patch);
  saveOrders();
  return r;
}
// 通知幂等：同一 notify_id 只处理一次；缺失时用 trade_no+out_trade_no+tradeStatus 复合键
function insertNotifyOnce({ notifyId, tradeNo, outTradeNo, tradeStatus }) {
  const key = notifyId || `${tradeNo || ""}|${outTradeNo || ""}|${tradeStatus || ""}`;
  if (events[key]) return false;
  events[key] = { at: new Date().toISOString() };
  saveEvents();
  return true;
}
function markRefunded(no) {
  const o = orders[no];
  if (o) { o.status = "REFUNDED"; saveOrders(); }
  return o;
}
module.exports = { createOrder, updateOrder, listOrders, findByOutTradeNo, markPaidIdempotently, recordNonPaidTradeEvent, closeOrder, addRefundRecord, updateRefund, insertNotifyOnce };
