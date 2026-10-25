// 十进制定点金额工具：以"分"为单位的 BigInt 运算，禁止浮点直接比较
function toCents(value) {
  if (value == null) return null;
  const m = String(value).trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  return BigInt(m[1]) * 100n + BigInt((m[2] || "").padEnd(2, "0"));
}
function centsToText(cents) {
  const neg = cents < 0n ? "-" : "";
  const abs = neg ? -cents : cents;
  return `${neg}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}
function amountEquals(expected, actual) {
  const a = toCents(expected), b = toCents(actual);
  return a !== null && b !== null && a === b;
}
module.exports = { toCents, centsToText, amountEquals };
