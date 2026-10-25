// 研报侠交付引擎：预置完整成品 + 任意代码速览研报生成
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const { WORKBENCH, DATA_DIR } = require("./config");

const OUTPUT_DIR = path.join(WORKBENCH, "output");
const DELIVER_DIR = path.join(DATA_DIR, "deliverables");

function findDeepScript() {
  const cands = [path.join(WORKBENCH, "scripts", "deep_report.py"),
                 path.join(WORKBENCH, "deep_report.py"),
                 "/opt/workbench/scripts/deep_report.py"];
  return cands.find((c) => fs.existsSync(c));
}
function generateDeepReport(code, outTradeNo) {
  const script = findDeepScript();
  if (!script) return Promise.resolve({ ok: false, error: "deep_report.py 不在镜像中" });
  return new Promise((resolve) => {
    try {
      const outDir = path.join(DATA_DIR, "deliverables");
      fs.mkdirSync(outDir, { recursive: true });
      const outFile = path.join(outDir, `${outTradeNo}_deep.html`);
      execFile("python3", [script, code, "--out", outFile], { timeout: 120000, maxBuffer: 10 * 1024 * 1024, env: { ...process.env, ENGINE_WORKBENCH: WORKBENCH } }, (err, stdout, stderr) => {
        if (err) return resolve({ ok: false, error: `DEEP_FAILED: ${String(err.message || "").slice(0, 120)} | ${String(stderr || stdout || "").slice(-260)}` });
        if (!fs.existsSync(outFile)) return resolve({ ok: false, error: "DEEP_OUTPUT_MISSING" });
        return resolve({ ok: true, path: outFile });
      });
    } catch (e) { return resolve({ ok: false, error: "ENGINE_DEEP: " + e.message }); }
  });
}

// 预置完整成品（训练成果直接交付）
const PREBUILT = {
  "600519": { name: "贵州茅台", extraFiles: [
    { label: "研究报告（15页图文，docx）", file: "贵州茅台(600519)研究报告.docx" },
    { label: "DCF估值模型（Excel全公式，xlsx）", file: "贵州茅台(600519)估值模型.xlsx" },
  ]},
  "600315": { name: "上海家化", extraFiles: [
    { label: "投资价值研究报告（docx）", file: "上海家化(600315)投资价值研究报告.docx" },
  ]},
};

function isPrebuilt(code) { return !!PREBUILT[code]; }
function prebuiltFiles(code) {
  const p = PREBUILT[code];
  if (!p) return [];
  return p.extraFiles.map((f) => ({
    label: f.label,
    path: path.join(OUTPUT_DIR, f.file),
    filename: f.file,
  })).filter((f) => fs.existsSync(f.path));
}

function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// 从 collect_stock.py 快照渲染速览研报 HTML
function renderQuickHtml(code, snap) {
  const r = snap.realtime || {};
  const t = snap.technicals || {};
  const fund = snap.fundamentals_latest || [];
  const rows = fund.slice(0, 6).map((f) =>
    `<tr><td>${esc(f.period)}</td><td>${esc(f.revenue_yi)}</td><td>${f.rev_yoy == null ? "—" : esc(f.rev_yoy) + "%"}</td><td>${esc(f.np_yi)}</td><td>${f.np_yoy == null ? "—" : esc(f.np_yoy) + "%"}</td></tr>`).join("");
  const checks = (snap.cross_checks || []).map((c) =>
    `<li><b>${esc(c.metric)}</b>：${esc(c.verdict)}（${esc(c.detail)}）</li>`).join("");
  const w52 = t.w52_high ? `<span>${esc(t.w52_low)} – ${esc(t.w52_high)}</span>（现价分位 ${(Number(t.w52_pct) * 100).toFixed(0)}%）` : "—";
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>研报侠速览 · ${esc(snap.name || code)}（${esc(code)}）</title>
<style>body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;max-width:860px;margin:32px auto;padding:0 20px;color:#1c2330;line-height:1.8}
h1{border-bottom:3px solid #c9a84c;padding-bottom:8px}.tag{color:#8a6d1f;font-size:13px;letter-spacing:2px}
.kpis{display:flex;gap:14px;flex-wrap:wrap;margin:18px 0}.kpi{background:#f6f4ee;border:1px solid #e3ddc9;border-radius:10px;padding:12px 18px;min-width:130px}
.kpi b{display:block;font-size:20px;color:#7a5c0e}.kpi span{font-size:12px;color:#7c8496}
table{border-collapse:collapse;width:100%;margin:10px 0}th,td{border:1px solid #ddd;padding:7px 10px;font-size:14px}th{background:#f0ede2}
.note{background:#fdf9ec;border-left:4px solid #c9a84c;padding:10px 14px;font-size:13px;color:#6b6146}
footer{margin-top:28px;font-size:12px;color:#98a0ae;border-top:1px solid #eee;padding-top:12px}</style></head><body>
<div class="tag">YANBAOXIA QUICK REPORT · AI GENERATED</div>
<h1>${esc(snap.name || code)}（${esc(code)}）投资速览研报</h1>
<div class="kpis">
  <div class="kpi"><span>现价（元）</span><b>${esc(r.price)}</b></div>
  <div class="kpi"><span>总市值（亿元）</span><b>${esc(r.mcap_yi)}</b></div>
  <div class="kpi"><span>PE-TTM</span><b>${esc(r.pe_ttm) || "—"}</b></div>
  <div class="kpi"><span>PB</span><b>${esc(r.pb)}</b></div>
</div>
<h3>技术面</h3>
<p>52周区间：${w52}；MA20 ${esc(t.ma20) || "—"} / MA60 ${esc(t.ma60) || "—"} / MA120 ${esc(t.ma120) || "—"} / MA250 ${esc(t.ma250) || "—"}</p>
<h3>近期业绩（归母口径，亿元）</h3>
<table><tr><th>报告期</th><th>营收</th><th>同比</th><th>归母净利</th><th>同比</th></tr>${rows}</table>
<h3>多源数据交叉校验（凡数双源）</h3><ul>${checks}</ul>
<div class="note">本速览由「研报侠」AI 引擎基于公开行情与财报接口自动生成（数据时点 ${esc(snap.as_of || "—")}），完整版机构级研报（15页图文+DCF估值模型）可联系我们定制。所有内容不构成投资建议。</div>
<footer>研报侠 · 支付宝AI付 PAYATHON 2026 参赛作品 | 数据源：东方财富/腾讯/新浪/网易/baostock 五源交叉校验 | 生成时间 ${esc(snap.sources && snap.sources.collected_at)}</footer>
</body></html>`;
}

// 生成速览研报（阻塞式，供 fulfillment 异步调用）
function generateQuickReport(code, outTradeNo) {
  return new Promise((resolve) => {
    try {
    fs.mkdirSync(DELIVER_DIR, { recursive: true });
    const outFile = path.join(DELIVER_DIR, `${outTradeNo}_quick.html`);
    const script = path.join(WORKBENCH, "scripts", "collect_stock.py");
    execFile("python3", [script, code], { timeout: 150000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      // 脚本退出码 1 仅代表存在 CONFLICT 校验，快照可能仍可用
      const snapDir = process.env.COLLECT_SNAPSHOT_DIR
        ? path.resolve(process.env.COLLECT_SNAPSHOT_DIR)
        : path.join(WORKBENCH, "data", "market", "snapshots");
      let snap = null;
      try {
        const cands = fs.readdirSync(snapDir).filter((f) => f.startsWith(`${code}_`) && f.endsWith(".json"))
          .map((f) => ({ f, m: fs.statSync(path.join(snapDir, f)).mtimeMs })).sort((a, b) => b.m - a.m);
        if (cands.length) snap = JSON.parse(fs.readFileSync(path.join(snapDir, cands[0].f), "utf8"));
      } catch {}
      if (!snap) {
        const tail = ((err && (err.stderr || String(err.message || ""))) + " | stdout:" + (stdout || "")).slice(-400);
        return resolve({ ok: false, error: `SNAPSHOT_NOT_FOUND${tail ? ": " + tail : ""}` });
      }
      try {
        fs.writeFileSync(outFile, renderQuickHtml(code, snap));
        return resolve({ ok: true, path: outFile });
      } catch (e) {
        return resolve({ ok: false, error: "RENDER_FAILED: " + e.message });
      }
    });
  } catch (e) {
    return resolve({ ok: false, error: "ENGINE_SETUP_FAILED: " + e.message });
  }
  });
}

module.exports = { PREBUILT, isPrebuilt, prebuiltFiles, generateQuickReport, generateDeepReport, DELIVER_DIR };
