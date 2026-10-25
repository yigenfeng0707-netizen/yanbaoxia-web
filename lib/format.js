// 支付宝要求 yyyy-MM-dd HH:mm:ss（禁止 ISO 格式）
function formatAlipayTimestamp(date = new Date()) {
  const pad = (n) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
module.exports = { formatAlipayTimestamp };
