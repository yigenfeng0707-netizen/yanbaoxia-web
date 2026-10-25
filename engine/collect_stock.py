#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
collect_stock.py — 投研工作台·多源行情采集与交叉校验

用法:
    python3 scripts/collect_stock.py              # 跑 config/watchlist.json 全部标的
    python3 scripts/collect_stock.py 600315       # 单标的
    python3 scripts/collect_stock.py 600315 --quick   # 只拉实时快照，不拉历史K/财务

数据源(均可独立失效，互为备份):
    EM   东方财富 push2(实时) / datacenter(业绩报表序列)
    TX   腾讯行情 qt.gtimg.cn(实时)
    SINA akshare 新浪源 stock_zh_a_daily(历史K，前复权)
    BS   baostock(历史K + PE-TTM/PB 估值序列)

规范(AGENTS.md "凡数必源"的升级版——凡数双源):
    价格/市值/PE/PB 必须至少两个独立来源一致(相对差 ≤ 0.5%)才判 PASS；
    单源可得标 SINGLE，双源不一致(>0.5%且≤2%)标 WARN，>2% 标 CONFLICT 并退出码 2。

输出:
    data/market/snapshots/{code}_{yyyymmdd}.json   # 每字段带 sources
    控制台校验报告
"""
import io
import json
import re
import sys
import time
import urllib.request
from contextlib import redirect_stdout
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SNAP_DIR = ROOT / "data" / "market" / "snapshots"
SNAP_DIR.mkdir(parents=True, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "Referer": "https://quote.eastmoney.com/"}
PRICE_TOL, WARN_TOL = 0.005, 0.02


def _get(url, headers=None, timeout=12):
    req = urllib.request.Request(url, headers={**UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def _secid(code: str) -> str:
    return ("1." if code[0] in "69" else "0.") + code


# ---------------- 数据源 ----------------

def em_realtime(code):
    """东方财富实时快照: 价格/昨收/市值/PE-TTM/PB/股本。push2集群会按IP临时限流，多域名轮询重试。"""
    import urllib.error
    fields = ("f43,f44,f45,f46,f47,f48,f57,f58,f60,f84,f116,f162,f164,f167,f169,f170")
    last_err = None
    for rnd in range(2):
        for host in ("push2.eastmoney.com", "push2delay.eastmoney.com", "82.push2.eastmoney.com"):
            url = f"https://{host}/api/qt/stock/get?secid={_secid(code)}&fields={fields}"
            try:
                d = json.loads(_get(url))["data"]
                return {"name": d["f58"], "price": d["f43"] / 100, "prev_close": d["f60"] / 100,
                        "mcap_yi": round(d["f116"] / 1e8, 2), "pe_ttm": d["f164"] / 100,
                        "pb": d["f167"] / 100, "shares_yi": round(d["f84"] / 1e8, 3),
                        "chg_pct": d["f170"] / 100, "ts": time.strftime("%Y-%m-%d %H:%M:%S")}
            except Exception as e:
                last_err = e
                time.sleep(0.6)
    raise last_err


def tx_realtime(code):
    """腾讯行情快照: GBK字符串，只取稳定字段(名称/现价/昨收/总市值/PB)"""
    raw = _get(f"https://qt.gtimg.cn/q=sh{code}" if code[0] in "69" else f"https://qt.gtimg.cn/q=sz{code}")
    f = raw.decode("gbk", "ignore").split("~")
    return {"name": f[1], "price": float(f[3]), "prev_close": float(f[4]),
            "mcap_yi": float(f[45]), "pb": float(f[46]) if f[46] else None}


def ak_hist_sina(code, days=450):
    """akshare新浪源日K(前复权)"""
    import akshare as ak
    sym = ("sh" if code[0] in "69" else "sz") + code
    df = ak.stock_zh_a_daily(symbol=sym, start_date=(date.today() - timedelta(days=days)).strftime("%Y%m%d"),
                             end_date=date.today().strftime("%Y%m%d"), adjust="qfq")
    return [{"date": str(r.date), "close": float(r.close), "high": float(r.high), "low": float(r.low)}
            for r in df.itertuples()]


def bs_daily(code, days=450):
    """baostock日K+估值(PE-TTM/PB)，返回与ak_hist同构(外加估值列)"""
    import baostock as bs
    buf = io.StringIO()
    with redirect_stdout(buf):
        bs.login()
        rs = bs.query_history_k_data_plus(
            ("sh." if code[0] in "69" else "sz.") + code, "date,close,high,low,peTTM,pbMRQ",
            start_date=(date.today() - timedelta(days=days)).isoformat(), frequency="d", adjustflag="2")
        rows = []
        while rs.error_code == "0" and rs.next():
            rows.append(rs.get_row_data())
        bs.logout()
    out = []
    for d, c, h, l, pe, pb in rows:
        out.append({"date": d, "close": float(c), "high": float(h), "low": float(l),
                    "pe_ttm": float(pe) if pe else None, "pb": float(pb) if pb else None})
    return out


def tx_kline(code, days=450):
    """腾讯日K前复权（纯stdlib）；baostock/akshare 不可用时的历史K来源"""
    mkt = "sh" if code[0] in "69" else "sz"
    start = (date.today() - timedelta(days=days)).isoformat()
    url = (f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get"
           f"?param={mkt}{code},day,{start},{date.today().isoformat()},420,qfq")
    d = json.loads(_get(url))
    data = (d.get("data") or {}).get(f"{mkt}{code}") or {}
    rows = data.get("qfqday") or data.get("day") or []
    out = []
    for r in rows:
        try:
            out.append({"date": r[0], "close": float(r[2]), "high": float(r[3]), "low": float(r[4])})
        except (ValueError, IndexError, TypeError):
            continue
    return out


def em_fundamentals(code):
    """东方财富业绩报表序列(报告期/营收/归母/同比)"""
    url = ("https://datacenter.eastmoney.com/api/data/v1/get?reportName=RPT_LICO_FN_CPD"
           "&columns=SECURITY_CODE,REPORTDATE,TOTAL_OPERATE_INCOME,YSTZ,PARENT_NETPROFIT,SJLTZ"
           f"&filter=(SECURITY_CODE%3D%22{code}%22)&pageNumber=1&pageSize=12"
           "&sortColumns=REPORTDATE&sortTypes=-1&source=WEB&client=WEB")
    d = json.loads(_get(url, {"Referer": "https://data.eastmoney.com/"}))
    rows = (d.get("result") or {}).get("data") or []
    return [{"period": r["REPORTDATE"][:10], "revenue_yi": round(r["TOTAL_OPERATE_INCOME"] / 1e8, 2),
             "rev_yoy": round(r["YSTZ"], 2) if r.get("YSTZ") is not None else None,
             "np_yi": round(r["PARENT_NETPROFIT"] / 1e8, 2),
             "np_yoy": round(r["SJLTZ"], 1) if r.get("SJLTZ") is not None else None} for r in rows]


# ---------------- 校验与加工 ----------------

def cross_check(metric, pairs, tol=PRICE_TOL):
    """pairs: [(source, value)] → 一致性判定"""
    vals = [(s, v) for s, v in pairs if v is not None]
    if len(vals) == 0:
        return {"metric": metric, "verdict": "MISSING", "detail": "无来源"}
    if len(vals) == 1:
        return {"metric": metric, "verdict": "SINGLE", "detail": f"仅{vals[0][0]}: {vals[0][1]}"}
    nums = [v for _, v in vals]
    spread = (max(nums) - min(nums)) / max(abs(n) for n in nums)
    if spread <= tol:
        return {"metric": metric, "verdict": "PASS", "detail": f"{vals} 相对差{spread:.4%}"}
    if spread <= WARN_TOL:
        return {"metric": metric, "verdict": "WARN", "detail": f"{vals} 相对差{spread:.4%}"}
    return {"metric": metric, "verdict": "CONFLICT", "detail": f"{vals} 相对差{spread:.4%}"}


def technicals(klines):
    """52周区间/分位/均线；klines 任一源的按日序列"""
    if not klines:
        return {}
    closes = [k["close"] for k in klines]
    px = closes[-1]
    cutoff = (date.today() - timedelta(days=365)).isoformat()
    w52 = [k for k in klines if k["date"] >= cutoff] or klines
    hi, lo = max(k["high"] for k in w52), min(k["low"] for k in w52)
    t = {"price": px, "w52_high": hi, "w52_low": lo, "w52_pct": round((px - lo) / (hi - lo), 3)}
    for n in (20, 60, 120, 250):
        if len(closes) >= n:
            t[f"ma{n}"] = round(sum(closes[-n:]) / n, 2)
    return t


def ttm_consistency(fund, mcap_yi, pe_ttm):
    """内部一致性: 市值/PE-TTM 隐含TTM净利 vs 财报序列滚动加总"""
    if not fund or not mcap_yi or not pe_ttm:
        return None
    latest = fund[0]
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", latest["period"])
    if not m:
        return None
    yr, mon = int(m.group(1)), latest["period"][5:7]
    annual = next((f for f in fund if f["period"].startswith(str(yr - 1)) and f["period"][5:7] == "12"), None)
    if annual is None or mon == "12":
        return None  # 最新已是年报则无需滚动
    prior = next((f for f in fund if f["period"].startswith(str(yr - 1)) and f["period"][5:7] == mon), None)
    if prior is None:
        return None
    ttm = annual["np_yi"] + latest["np_yi"] - prior["np_yi"]
    implied = mcap_yi / pe_ttm
    if ttm <= 0 or implied <= 0:
        return None
    return {"ttm_from_reports": round(ttm, 2), "ttm_implied_by_mcap_over_pe": round(implied, 2),
            "rel_diff": round(abs(ttm - implied) / max(abs(ttm), abs(implied)), 4)}


def level_alerts(px, levels):
    out = []
    for kind, arr in (("压力", levels.get("resistance", [])), ("支撑", levels.get("support", []))):
        for lv in arr:
            if abs(px - lv) / lv <= 0.01:
                out.append(f"距{kind}位 {lv} 仅 {abs(px/lv-1):.1%}")
    sl = levels.get("stop_loss")
    if sl and px <= sl * 1.02:
        out.append(f"⚠ 接近/跌破止损位 {sl}")
    return out


# ---------------- 主流程 ----------------

def run_stock(cfg, quick=False):
    code = cfg["code"]
    checks = []

    # 1) baostock 历史K+估值（先拉：EM限流时兜底提供PE/PB）
    bs_rows = []
    if not quick:
        try:
            bs_rows = bs_daily(code)
        except Exception as e:
            print(f"  [BS 失效] {type(e).__name__}: {str(e)[:80]}")
    bs_last = bs_rows[-1] if bs_rows else None

    # 2) 实时源 EM / TX
    em = tx = None
    try:
        em = em_realtime(code)
    except Exception as e:
        print(f"  [EM 失效] {type(e).__name__}: {str(e)[:80]}")
    time.sleep(0.5)
    try:
        tx = tx_realtime(code)
    except Exception as e:
        print(f"  [TX 失效] {type(e).__name__}: {str(e)[:80]}")

    px = (em or tx or bs_last or {}).get("price") or (bs_last and bs_last.get("close"))
    if px is None:
        print(f"✗ {code} 全部来源失效，跳过")
        return 2

    pe = (em and em["pe_ttm"]) or (bs_last and bs_last.get("pe_ttm"))
    pb = (em and em["pb"]) or (tx and tx.get("pb")) or (bs_last and bs_last.get("pb"))
    mcap = (em and em["mcap_yi"]) or (tx and tx.get("mcap_yi"))

    # 3) 交叉校验（凡数双源）
    bs_note = f"BS@{bs_last['date']}" if bs_last else "BS"
    for m, pairs, tol in (
        ("价格", [("EM", em and em["price"]), ("TX", tx and tx["price"]), (bs_note, bs_last and bs_last["close"])], PRICE_TOL),
        ("昨收", [("EM", em and em["prev_close"]), ("TX", tx and tx["prev_close"])], PRICE_TOL),
        ("总市值(亿)", [("EM", em and em["mcap_yi"]), ("TX", tx and tx["mcap_yi"])], PRICE_TOL),
        ("PE-TTM", [("EM", em and em["pe_ttm"]), (bs_note, bs_last and bs_last.get("pe_ttm"))], 0.01),
        ("PB", [("EM", em and em["pb"]), ("TX", tx and tx.get("pb")), (bs_note, bs_last and bs_last.get("pb"))], 0.01),
    ):
        checks.append(cross_check(m, pairs, tol))

    snap = {"code": code, "name": (em or tx or {}).get("name") or cfg.get("name", code),
            "as_of": (em and em.get("ts")) or (bs_last and bs_last["date"]),
            "realtime": {"price": px, "prev_close": (em or tx or {}).get("prev_close"),
                         "chg_pct": em and em.get("chg_pct"), "mcap_yi": mcap,
                         "pe_ttm": pe, "pb": pb, "shares_yi": em and em.get("shares_yi")},
            "cross_checks": checks}

    # 持仓盈亏（watchlist 配置了 cost_basis 与 shares 时自动计算）
    cb, sh = cfg.get("cost_basis"), cfg.get("shares")
    if cb and sh and px:
        snap["position"] = {"cost_basis": cb, "shares": sh,
                            "market_value": round(px * sh, 2),
                            "pnl": round((px - cb) * sh, 2),
                            "pnl_pct": round(px / cb - 1, 4),
                            "breakeven_gain_pct": round(cb / px - 1, 4)}
        if abs(px / cb - 1) <= 0.02:
            snap["position"]["note"] = "距成本线±2%以内"

    # 4) akshare 新浪源历史K（技术面第二源）
    if not quick:
        try:
            ak_rows = ak_hist_sina(code)
            checks.append(cross_check("AK新浪收盘 vs 其他源", [("AK", ak_rows[-1]["close"]), (bs_note, bs_last and bs_last["close"]), ("EM", em and em["price"]), ("TX", tx and tx["price"])], PRICE_TOL))
        except Exception as e:
            print(f"  [AK 失效] {type(e).__name__}: {str(e)[:80]}")
            ak_rows = []
        tx_rows = []
        try:
            tx_rows = tx_kline(code)
            if tx_rows:
                checks.append(cross_check("TXK腾讯日K收盘 vs 其他源", [("TXK", tx_rows[-1]["close"]), (bs_note, bs_last and bs_last["close"]), ("EM", em and em["price"]), ("TX", tx and tx["price"])], PRICE_TOL))
        except Exception as e:
            print(f"  [TXK 失效] {type(e).__name__}: {str(e)[:80]}")
        snap["technicals"] = technicals(bs_rows or ak_rows or tx_rows)
        try:
            fund = em_fundamentals(code)
            snap["fundamentals_latest"] = fund[:6]
            if mcap and pe:
                ttm = ttm_consistency(fund, mcap, pe)
                if ttm:
                    snap["ttm_consistency"] = ttm
                    checks.append({"metric": "TTM净利(财报加总 vs 市值/PE)", "verdict":
                                   "PASS" if ttm["rel_diff"] <= 0.03 else "WARN", "detail": str(ttm)})
        except Exception as e:
            print(f"  [业绩序列失效] {type(e).__name__}: {str(e)[:80]}")

    # 5) 关键位提醒
    if cfg.get("levels"):
        snap["level_alerts"] = level_alerts(px, cfg["levels"])

    # 6) 落盘
    snap["sources"] = {"EM": "东方财富push2(多域名)/datacenter", "TX": "腾讯qt.gtimg.cn",
                       "SINA": "akshare新浪源", "BS": "baostock(估值为收盘口径)",
                       "collected_at": time.strftime("%Y-%m-%d %H:%M:%S")}
    out = SNAP_DIR / f"{code}_{date.today():%Y%m%d}.json"
    out.write_text(json.dumps(snap, ensure_ascii=False, indent=2), encoding="utf-8")

    icon = {"PASS": "✅", "SINGLE": "🔸", "WARN": "⚠️", "CONFLICT": "❌", "MISSING": "⬜"}
    print(f"\n■ {code} {snap['name']}  现价 {px}  市值 {mcap}亿  (口径时点 {snap.get('as_of')})")
    pos = snap.get("position")
    if pos:
        print(f"  💼 持仓 {pos['shares']}股 成本{pos['cost_basis']} → 浮动盈亏 {pos['pnl_pct']:+.1%} ({pos['pnl']:+,.0f}元, 市值{pos['market_value']:,.0f}元, 回本需涨{pos['breakeven_gain_pct']:+.1%})")
    for c in checks:
        print(f"  {icon[c['verdict']]} {c['metric']}: {c['verdict']}  {c['detail']}")
    t = snap.get("technicals")
    if t:
        print(f"  52周 {t.get('w52_low')}-{t.get('w52_high')} 分位{t.get('w52_pct', 0):.0%} | MA20 {t.get('ma20')} MA60 {t.get('ma60')} MA120 {t.get('ma120')} MA250 {t.get('ma250')}")
    for a in snap.get("level_alerts", []):
        print(f"  🎯 {a}")
    print(f"  快照 → {out.relative_to(ROOT)}")
    return 1 if any(c["verdict"] == "CONFLICT" for c in checks) else 0


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    quick = "--quick" in sys.argv
    cfg_path = ROOT / "config" / "watchlist.json"
    wl = json.loads(cfg_path.read_text(encoding="utf-8"))["stocks"] if cfg_path.exists() else []
    stocks = [s for s in wl if s["code"] in args] if args else wl
    if args:
        known = {s["code"] for s in stocks}
        for a in args:
            if a not in known:
                stocks.append({"code": a})  # 监控清单之外的临时代码：仅采集行情与财务，无关键位提醒
    rc = 0
    for s in stocks:
        rc |= run_stock(s, quick=quick)
        time.sleep(1)
    sys.exit(rc)


if __name__ == "__main__":
    main()
