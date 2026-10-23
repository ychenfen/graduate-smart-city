"""论文插图：读取 paper/figdata/*.json，输出 paper/figs/*.pdf
运行：.venv/bin/python tools/make_figs.py
"""
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
D = ROOT / "paper" / "figdata"
OUT = ROOT / "paper" / "figs"
OUT.mkdir(parents=True, exist_ok=True)

INK, GRAY, LIGHT, AMBER, RUST, GREEN, BLUE = "#1d1c1a", "#8d887c", "#cfc9bb", "#e0a100", "#b5531c", "#2f7d4f", "#3b6b8f"
plt.rcParams.update({
    "font.family": ["Hiragino Sans GB", "Heiti SC", "sans-serif"],
    "font.size": 9, "axes.titlesize": 9.5, "axes.labelsize": 9,
    "axes.spines.top": False, "axes.spines.right": False,
    "axes.edgecolor": INK, "axes.labelcolor": INK, "xtick.color": INK, "ytick.color": INK,
    "axes.unicode_minus": False, "pdf.fonttype": 42, "savefig.bbox": "tight", "savefig.pad_inches": 0.03,
})


def load(name):
    return json.loads((D / name).read_text(encoding="utf-8"))


def save(fig, name):
    fig.savefig(OUT / f"{name}.pdf")
    fig.savefig(OUT / f"{name}.png", dpi=200)
    plt.close(fig)


# ---------- 图：方案空间散点 ----------
def fig_cloud(cid, title):
    d = load(f"cloud_{cid}.json")
    cloud = d["cloud"]
    front = set(d["pareto"])
    rel = np.array([c[0] for c in cloud]); eu = np.array([c[1] for c in cloud])
    useful = eu[rel >= 0.1]
    xmax = max(useful.max(), d["exp"]["euac"]) * 1.05
    fig, ax = plt.subplots(figsize=(4.6, 3.1))
    m = np.array([c[3] not in front for c in cloud])
    ax.scatter(np.minimum(eu[m], xmax), rel[m], s=5, c=LIGHT, lw=0, label="可行方案", zorder=1)
    ax.scatter(eu[~m], rel[~m], s=14, c=INK, lw=0, label="Pareto 前沿", zorder=2)
    ax.axhline(d["target"], color=AMBER, ls="--", lw=1.2, zorder=0)
    ax.text(xmax, d["target"] + 0.015, "目标可靠度", ha="right", va="bottom", color="#7a5800", fontsize=8)
    rec = next(c for c in cloud if c[3] == d["rec"])
    ax.scatter([rec[1]], [rec[0]], marker="D", s=60, c=AMBER, edgecolors=INK, lw=0.8, zorder=4, label="本系统推荐")
    ax.scatter([d["exp"]["euac"]], [d["exp"]["reliability"]], marker="s", s=46, facecolors="none", edgecolors=RUST, lw=1.6, zorder=4, label="经验选型")
    ax.scatter([d["ws"]["euac"]], [d["ws"]["reliability"]], marker="^", s=46, facecolors="none", edgecolors=BLUE, lw=1.4, zorder=4, label="加权打分")
    ax.set_xlim(eu.min() - 0.3, xmax); ax.set_ylim(-0.03, 1.03)
    ax.set_xlabel("等额年值成本 / (元·m$^{-2}$·年$^{-1}$)"); ax.set_ylabel("全部指标同时达标的概率")
    ax.set_title(title, loc="left")
    ax.legend(frameon=False, fontsize=7.5, loc="lower right", ncol=2, handletextpad=0.3, columnspacing=0.8)
    save(fig, f"cloud_{cid}")


# ---------- 图：案例对比 ----------
def fig_cases():
    rows = load("case_compare.json")
    cases = sorted({r["case"] for r in rows})
    methods = [("ours", "本系统", INK), ("experience", "经验选型", RUST), ("weighted", "加权打分", BLUE), ("cheapest", "最低造价", LIGHT)]
    get = {(r["case"], r["method"]): r for r in rows}
    fig, axes = plt.subplots(1, 2, figsize=(6.6, 2.6))
    x = np.arange(len(cases)); wbar = 0.2
    for i, (k, name, col) in enumerate(methods):
        axes[0].bar(x + (i - 1.5) * wbar, [get[(c, k)]["rel"] for c in cases], wbar, color=col, label=name)
        if k != "cheapest":
            axes[1].bar(x + (i - 1) * wbar, [get[(c, k)]["euac"] for c in cases], wbar, color=col, label=name)
    axes[0].set_ylabel("达标可靠度"); axes[0].set_ylim(0, 1.05)
    axes[1].set_ylabel("等额年值成本 / (元·m$^{-2}$·年$^{-1}$)")
    for ax in axes:
        ax.set_xticks(x); ax.set_xticklabels(cases)
    axes[1].set_ylim(5, None)
    axes[0].legend(frameon=False, fontsize=7.5, ncol=2, loc="upper left", bbox_to_anchor=(0, 1.22))
    fig.tight_layout(w_pad=2.5)
    save(fig, "case_compare")


# ---------- 图：施工气温扫描 ----------
def fig_ambient():
    d = load("ambient_sweep.json")
    names = {
        "AC16/SBS110_5/lime/antirut/warm/R0/basalt": ("AC-16 + SBS(110#基) + 抗车辙剂 + 温拌", AMBER, "-"),
        "AC16/SBS110_5/lime/antirut/none/R0/basalt": ("同上配方 · 热拌", INK, "--"),
        "SMA13/SBS90_5/lime/antirut/warm/R0/basalt": ("SMA-13 + SBS(90#基) + 温拌", BLUE, "-."),
        "AC13/SBS110_5/none/none/none/R0/none": ("经验选型 AC-13 + SBS(110#基)", RUST, ":"),
    }
    fig, ax = plt.subplots(figsize=(4.6, 2.8))
    T = [r["T"] for r in d["rows"]]
    for p in d["plans"]:
        lab, col, ls = names[p]
        y = [np.nan if r[p] is None else r[p] for r in d["rows"]]
        ax.plot(T, y, color=col, ls=ls, lw=1.6, label=lab)
    ax.axvspan(8, 10, color=AMBER, alpha=0.12, lw=0)
    ax.text(9, 0.02, "案例C2\n施工气温", ha="center", va="bottom", fontsize=7.5, color="#7a5800")
    ax.set_xlabel("施工期日均气温 / ℃"); ax.set_ylabel("达标可靠度"); ax.set_ylim(0, 1)
    ax.legend(frameon=False, fontsize=7.2, loc="center right", bbox_to_anchor=(1.0, 0.45))
    ax.set_title("哈尔滨主干路：同一配方，热拌与温拌的可铺筑窗口和可靠度", loc="left", fontsize=8.5)
    save(fig, "ambient_sweep")


# ---------- 图：反馈收敛 ----------
def fig_feedback():
    d = load("feedback.json")
    conv = d["conv"]
    n = [c["n"] for c in conv]
    fig, axes = plt.subplots(1, 2, figsize=(6.6, 2.5))
    ax = axes[0]
    ax.fill_between(n, [c["lo"] for c in conv], [c["hi"] for c in conv], color=LIGHT, alpha=0.7, lw=0, label="200 次重复的 95% 区间")
    for t in d["track"][:3]:
        ax.plot(range(len(t)), t, color=GRAY, lw=0.7)
    ax.plot(n, [c["mean"] for c in conv], color=INK, lw=1.6, label="后验均值（平均）")
    ax.axhline(d["truth"], color=AMBER, ls="--", lw=1.2, label="真实偏差 0.88")
    ax.set_xlabel("回流监测路段数"); ax.set_ylabel("水稳定性 实测/预测")
    ax.legend(frameon=False, fontsize=7.2, loc="upper right")
    ax = axes[1]
    st = d["switchTrack"]
    ax.step([s["n"] for s in st], [s["rel"] for s in st], where="post", color=INK, lw=1.4, label="推荐方案可靠度")
    ax2 = ax.twinx()
    ax2.step([s["n"] for s in st], [s["euac"] for s in st], where="post", color=AMBER, lw=1.4, label="推荐方案年值成本")
    ax2.spines["top"].set_visible(False)
    ax.set_xlabel("回流监测路段数"); ax.set_ylabel("可靠度"); ax2.set_ylabel("年值成本", color="#7a5800")
    ax.set_ylim(0.7, 0.95)
    ax.annotate("SBS + RAP30 → 橡胶沥青", xy=(2, 0.878), xytext=(6, 0.74), fontsize=7.5, arrowprops=dict(arrowstyle="->", color=INK, lw=0.8))
    fig.tight_layout(w_pad=2.5)
    save(fig, "feedback")


# ---------- 图：城市需求包络 ----------
def fig_city():
    rows = load("city_envelope.json")
    rows = sorted(rows, key=lambda r: r["pavLow98"])
    fig, ax = plt.subplots(figsize=(6.4, 2.9))
    y = np.arange(len(rows))
    for i, r in enumerate(rows):
        ax.plot([r["pavLow98"], r["pavHigh98"]], [i, i], color=INK, lw=3, solid_capstyle="butt")
        ax.text(r["pavHigh98"] + 1, i, f'{r["zone"]}  {r["pg"]}', va="center", fontsize=7.5)
    ax.set_yticks(y); ax.set_yticklabels([r["name"] for r in rows])
    ax.axvline(0, color=LIGHT, lw=0.8)
    ax.set_xlabel("98% 可靠度下的路面设计温度区间 / ℃")
    ax.set_xlim(-38, 88)
    save(fig, "city_envelope")


# ---------- 图：先验扰动稳定性 ----------
def fig_stability():
    rows = load("prior_stability.json")
    fig, ax = plt.subplots(figsize=(4.6, 2.4))
    x = np.arange(len(rows)); wbar = 0.36
    ax.bar(x - wbar / 2, [r["sameExact"] for r in rows], wbar, color=GRAY, label="配方完全一致")
    ax.bar(x + wbar / 2, [r["sameFamily"] for r in rows], wbar, color=INK, label="级配类型+结合料类别一致")
    for i, r in enumerate(rows):
        ax.text(i, max(r["sameFamily"], r["sameExact"]) + 0.03, f'损失{r["euacRegretMedian"]:.2f}', ha="center", fontsize=6.8, color="#7a5800")
    ax.set_xticks(x); ax.set_xticklabels([r["case"] for r in rows]); ax.set_ylim(0, 1.12)
    ax.set_ylabel("40 次扰动中的比例")
    ax.legend(frameon=False, fontsize=7.5, loc="upper left", bbox_to_anchor=(0, 1.2), ncol=2)
    save(fig, "prior_stability")


# ---------- 图：样本数收敛 ----------
def fig_mc():
    rows = [r for r in load("mc_convergence.json") if r["case"] == "C1"]
    fig, ax = plt.subplots(figsize=(3.4, 2.3))
    n = [r["n"] for r in rows]
    ax.errorbar(n, [r["relMean"] for r in rows], yerr=[1.96 * r["relSd"] for r in rows], fmt="o-", color=INK, ms=3.5, lw=1.2, capsize=2.5)
    ax.axhline(rows[0]["truthRel"], color=AMBER, ls="--", lw=1.1)
    ax.axvline(400, color=LIGHT, lw=0.8)
    ax.set_xscale("log"); ax.set_xticks(n); ax.set_xticklabels(n)
    ax.set_xlabel("每方案抽样次数 N"); ax.set_ylabel("推荐方案可靠度估计")
    save(fig, "mc_convergence")


if __name__ == "__main__":
    fig_cloud("C1", "C1 海南洋浦疏港道路（992 个可行方案）")
    fig_cloud("C2", "C2 哈尔滨主干路晚秋施工")
    fig_cloud("C5", "C5 乌鲁木齐国道（高低温双约束）")
    fig_cases(); fig_ambient(); fig_feedback(); fig_city(); fig_stability(); fig_mc()
    print("figs ->", OUT, sorted(p.name for p in OUT.glob("*.pdf")))
