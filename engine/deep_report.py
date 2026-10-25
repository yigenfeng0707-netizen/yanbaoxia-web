#!/usr/bin/env python3
"""研报侠 · 深度研报生成器（数据驱动，任意6位A股代码 → 多章节HTML深度报告）
依赖：仅Python3标准库。数据来自 collect_stock.py 生成的快照。
用法: python3 deep_report.py <6位股票代码>
"""
import html
import json
import os
import sys
from pathlib import Path

def esc(s):
    return str(s if s is not None else "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def find_snapshot(code):
    override = os.environ.get("COLLECT_SNAPSHOT_DIR")
    dirs = [Path(override)] if override else []
    wb = os.environ.get("ENGINE_WORKBENCH") or str(Path(__file__).resolve().parent.parent.parent / "投研工作台")
    dirs += [Path(wb) / "data" / "market" / "snapshots",
             Path(__file__).resolve().parent.parent / "data" / "market" / "snapshots",
             Path.cwd() / "data" / "market" / "snapshots"]
    cands = []
    for d in dirs:
        if d.exists():
            cands += [(f.stat().st_mtime, f) for f in d.glob(f"{code}_*.json")]
    if not cands:
        raise SystemExit(f"未找到 {code} 的快照，请先运行: python3 collect_stock.py {code}")
    return json.loads(Path(max(cands)[1]).read_text(encoding="utf-8"))

def fmt(v, suffix=""):
    return esc(v) + suffix if v is not None else "—"

def pct(v):
    if v is None: return "—"
    return f"{v:+.1f}%" if abs(v) >= 0.1 else "持平"

def trend_phrase(yoys):
    """由近几期营收同比生成趋势描述"""
    vals = [y for y in yoys if y is not None]
    if len(vals) < 2: return "增速数据待补充"
    latest, prev = vals[-1], vals[-2]
    if latest > 20: return "收入处于高增长区间"
    if latest > 8 and latest >= prev: return "收入稳健增长且边际提速"
    if latest > 0: return "收入保持正增长，弹性待释放"
    if latest > -10: return "收入小幅承压，关注拐点信号"
    return "收入明显下滑，反转需验证"

def profit_phrase(np_yoys):
    vals = [v for v in np_yoys if v is not None]
    if not vals: return "—"
    latest = vals[-1]
    if latest > 100: return "利润呈爆发式增长（注意低基数效应）"
    if latest > 30: return "利润高增，盈利弹性显著"
    if latest > 10: return "利润双位数增长，质量待现金流验证"
    if latest > 0: return "利润正增长，稳健修复中"
    if latest > -30: return "利润承压，关注减值与费用出清节奏"
    return "利润大幅下滑，反转信号待确认"

def render_deep(code, snap):
    r = snap.get("realtime") or {}
    t = snap.get("technicals") or {}
    fund = snap.get("fundamentals_latest") or []
    checks = snap.get("cross_checks") or []
    name = esc(snap.get("name") or code)
    asof = esc(snap.get("as_of") or "—")
    rev_yoys = [f.get("rev_yoy") for f in reversed(fund) if f.get("rev_yoy") is not None]
    np_yoys = [f.get("np_yoy") for f in reversed(fund) if f.get("np_yoy") is not None]
    rev_trend, np_trend = trend_phrase(rev_yoys), profit_phrase(np_yoys)
    # 位置判断
    w52 = f"{t.get('w52_low')} – {t.get('w52_high')}" if t.get("w52_high") else "—"
    pos = t.get("w52_pct")
    pos_txt = (f"当前价格位于52周区间的{float(pos)*100:.0f}%分位"
               + ("（低位区，向下空间相对有限，需右侧信号确认）" if float(pos) < 0.35
                  else "（中位区，趋势中性）" if float(pos) < 0.7
                  else "（高位区，注意拥挤度与回撤风险）")) if pos is not None else "—"
    ma_txt = []
    for n, v in ((20, t.get("ma20")), (60, t.get("ma60")), (120, t.get("ma120")), (250, t.get("ma250"))):
        if v and r.get("price"): ma_txt.append(f"MA{n} {v}（{'上方' if r['price'] >= v else '下方'}）")
    fin_rows = "".join(
        f"<tr><td>{esc(f.get('period'))}</td><td>{fmt(f.get('revenue_yi'))}</td>"
        f"<td>{pct(f.get('rev_yoy'))}</td><td>{fmt(f.get('np_yi'))}</td>"
        f"<td>{pct(f.get('np_yoy'))}</td><td>{fmt(f.get('roe'))}</td></tr>"
        for f in fund)
    kpi = [( "现价（元）", r.get("price")), ("总市值（亿元）", r.get("mcap_yi")),
           ("PE-TTM", r.get("pe_ttm")), ("PB", r.get("pb")),
           ("52周区间", f"{t.get('w52_low')}–{t.get('w52_high')}" if t.get("w52_high") else None),
           ("52周分位", f"{float(t.get('w52_pct',0))*100:.0f}%" if t.get("w52_pct") is not None else None)]
    kpi_html = "".join(f'<div class="kpi"><span>{esc(k)}</span><b>{esc(v)}</b></div>' for k, v in kpi if v is not None)
    chk_html = "".join(f'<li><b>{esc(x.get("metric"))}</b>：{esc(x.get("verdict"))}（{esc(x.get("detail"))}）</li>' for x in checks)
    return f"""<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<title>研报侠深度研报 · {name}（{esc(code)}）</title>
<style>body{{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;max-width:900px;margin:36px auto;padding:0 24px;color:#1c2330;line-height:1.85}}
h1{{border-bottom:3px solid #c9a84c;padding-bottom:10px}}h2{{border-left:4px solid #c9a84c;padding-left:10px;margin-top:34px}}
.tag{{color:#8a6d1f;font-size:12px;letter-spacing:2px}}.kpis{{display:flex;gap:12px;flex-wrap:wrap;margin:18px 0}}
.kpi{{background:#f6f4ee;border:1px solid #e3ddc9;border-radius:10px;padding:10px 16px;min-width:120px}}
.kpi b{{display:block;font-size:18px;color:#7a5c0e}}.kpi span{{font-size:11px;color:#7c8496}}
table{{border-collapse:collapse;width:100%;margin:10px 0}}th,td{{border:1px solid #ddd;padding:7px 10px;font-size:13.5px;text-align:center}}th{{background:#f0ede2}}
.note{{background:#fdf9ec;border-left:4px solid #c9a84c;padding:10px 14px;font-size:13px;color:#6b6146}}
ul li{{font-size:13.5px}}footer{{margin-top:30px;font-size:12px;color:#98a0ae;border-top:1px solid #eee;padding-top:12px}}
@media print{{body{{margin:12mm}}}}</style></head><body>
<div class="tag">YANBAOXIA DEEP REPORT · DATA-DRIVEN · AI GENERATED</div>
<h1>{name}（{esc(code)}）深度研究报告</h1>
<div class="kpis">{kpi_html}</div>
<h2>一、投资摘要</h2>
<p><b>收入端：</b>{rev_trend}。<b>利润端：</b>{np_trend}。<b>位置：</b>{pos_txt}。</p>
<p>均线结构：{'，'.join(ma_txt) if ma_txt else '数据待补充'}。估值方面，当前 PE-TTM {fmt(r.get('pe_ttm'))}、PB {fmt(r.get('pb'))}（多源校验口径）。</p>
<h2>二、财务表现（归母口径）</h2>
<table><tr><th>报告期</th><th>营收(亿)</th><th>同比</th><th>归母净利(亿)</th><th>同比</th><th>ROE</th></tr>{fin_rows}</table>
<h2>三、技术分析</h2>
<p>52周区间：{w52}；均线：{'，'.join(ma_txt) if ma_txt else '—'}。量价数据详见多源校验口径。</p>
<h2>四、估值分析</h2>
<p>PE-TTM {fmt(r.get('pe_ttm'))}、PB {fmt(r.get('pb'))}、总市值 {fmt(r.get('mcap_yi'))} 亿元。估值结论需结合行业中枢与自身历史分位（后续版本将接入历史分位序列）。</p>
<h2>五、多源数据交叉校验明细</h2>
<ul>{chk_html}</ul>
<div class="note">本报告由「研报侠」AI 引擎基于公开数据自动生成（数据时点 {asof}），叙事为数据驱动的规则化表述，非人工撰文；所有内容不构成投资建议。</div>
<footer>研报侠 · 支付宝AI付 PAYATHON 2026 参赛作品 | 六路数据源：东方财富/腾讯/新浪/网易/baostock/akshare | 生成于 {esc(snap.get("sources", {}).get("collected_at", "—"))}</footer>
</body></html>"""

if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        raise SystemExit("用法: python3 deep_report.py <6位股票代码> [--out 输出路径]")
    code = args[0]
    out = Path(f"{code}_深度研报.html")
    if "--out" in args:
        out = Path(args[args.index("--out") + 1])
        out.parent.mkdir(parents=True, exist_ok=True)
    snap = find_snapshot(code)
    out.write_text(render_deep(code, snap), encoding="utf-8")
    r = snap.get("realtime") or {}
    print(f"[OK] 已生成 {out}")
    print(f"  {snap.get('name', code)} 现价 {r.get('price')} | 校验 {len(snap.get('cross_checks') or [])} 项")
