"""SEDP — Sophisticated Multi-Algorithm Evaluation Dashboard.

Compares five prediction algorithms (EWMA+Trend, Holt, AR(3), Kalman, Linear
Regression) driving the PPEA partition engine, with:

  * a Monte-Carlo composite leaderboard (mean +/- std over seeds),
  * a full forecast-accuracy suite (MAE/RMSE/MAPE/sMAPE/R2/DirAcc/Theil/skill),
  * predicted-vs-actual overlays and a per-partition error matrix,
  * PPEA proactive lead-time + decision counts vs the reactive baseline,
  * a live concurrent API stress test,
  * live running-engine state.

User picks the active algorithm (and the comparison set) in the sidebar.

Run:  streamlit run src/sedp/eval_dashboard.py --server.port 8502
"""
import sys, os, time, json, random, statistics, urllib.request
from concurrent.futures import ThreadPoolExecutor

for cand in ("/app", os.getcwd(), os.path.dirname(os.path.dirname(os.path.dirname(__file__)))):
    if cand and cand not in sys.path:
        sys.path.insert(0, cand)

import streamlit as st
import pandas as pd
import altair as alt
from src.sedp.predictors import PREDICTORS, label, family
from src.sedp import evaluation as ev

# Reachable by compose service name on the shared network. host.docker.internal
# is Docker-Desktop-only DNS and isn't reachable from a plain Linux Docker
# Engine host, so it's not used as the default here.
API = os.environ.get("SEDP_API", "http://api:8000")
ALL = list(PREDICTORS.keys())

st.set_page_config(layout="wide", page_title="SEDP · Algorithm Evaluation")
st.title("🧪 SEDP — Multi-Algorithm Evaluation Dashboard")
st.caption("Six predictive algorithms (incl. our game-theoretic no-regret ensemble) × PPEA "
           "partition engine · Monte-Carlo scored · live load-tested")


# --------------------------------------------------------------- cached compute
@st.cache_data(show_spinner=False)
def cached_leaderboard(names, cycles, seeds):
    return ev.leaderboard(list(names), cycles, list(seeds))

@st.cache_data(show_spinner=False)
def cached_eval(name, cycles, seed):
    return ev.evaluate_predictor(name, ev.gen_workload(cycles, seed))

@st.cache_data(show_spinner=False)
def cached_workload(cycles, seed):
    return ev.gen_workload(cycles, seed)

def get_json(path):
    try:
        with urllib.request.urlopen(API + path, timeout=10) as r:
            return json.load(r)
    except Exception as e:
        return {"_error": str(e)}


# ------------------------------------------------------------------- sidebar
st.sidebar.header("⚙️ Configuration")
compare = st.sidebar.multiselect("Algorithms to compare", ALL, default=ALL,
                                 format_func=label)
if not compare:
    compare = ALL
active = st.sidebar.selectbox("Active algorithm (for decisions / live engine)",
                              compare, format_func=label)
st.sidebar.divider()
cycles = st.sidebar.slider("Workload cycles", 30, 150, 60, 10)
base_seed = st.sidebar.number_input("Base seed", value=1, step=1)
mc_runs = st.sidebar.slider("Monte-Carlo runs (seeds)", 1, 12, 5)
split_th = st.sidebar.number_input(
    "PPEA split_threshold", value=100.0, step=5000.0,
    help="PPS scales with load magnitude (often tens/hundreds of thousands here), so the "
         "default of 100 is trivially exceeded by every algorithm on cycle 0 -- that's why "
         "Lead-time & Decisions can look identical across algorithms until you raise this. "
         "Try 50,000+ to see real per-algorithm differences. You can also type an exact value "
         "directly into the box instead of using the +/- steppers.")
seeds = tuple(range(int(base_seed), int(base_seed) + mc_runs))
st.sidebar.divider()
st.sidebar.header("🔥 Stress test")
duration = st.sidebar.slider("Duration (s)", 5, 40, 12, 1)
workers = st.sidebar.slider("Concurrent workers", 4, 64, 24, 4)
run_stress = st.sidebar.button("▶ Run API stress test")

live_algo = get_json("/algorithm")
if "_error" not in live_algo:
    st.sidebar.success(f"Live API engine: **{live_algo.get('label')}**")
    if live_algo.get("key") != active:
        st.sidebar.caption(f"To make the live engine use **{label(active)}**, set "
                           f"`SEDP_PREDICTOR={active}` and restart the api service.")

tabs = st.tabs(["🏆 Leaderboard", "🎯 Accuracy", "⏱ Lead-time & Decisions",
                "🔥 Stress test", "📦 Large-Scale Benchmark", "📡 Live engine"])

# ============================================================ TAB 1: leaderboard
with tabs[0]:
    st.subheader("Composite leaderboard")
    st.caption(
        f"Monte-Carlo over {mc_runs} seed(s), {cycles} cycles. "
        "Composite = 0.5·accuracy + 0.2·directional + 0.3·efficiency (fixed absolute 0–100 scale each). "
        "MAPE/R²/TheilU2 are still shown below for transparency but are no longer part of the score — they're highly "
        "correlated with skill on this workload (|r| > 0.94) and R² in particular has ~2% dynamic "
        "range across all 6 algorithms, so they add redundancy rather than signal."
    )
    with st.spinner("Scoring algorithms… (includes a throughput timing pass per algorithm)"):
        board = cached_leaderboard(tuple(compare), cycles, seeds)
    lb = pd.DataFrame([{
        "rank": r["rank"], "algorithm": r["label"], "family": r["family"],
        "score": r["composite"],
        "accuracy": r["accuracy_score"], "directional": r["directional_score"],
        "efficiency": r["efficiency_score"],
        "skill%": round(r["skill_mean"], 1), "± skill": round(r["skill_std"], 1),
        "DirAcc%": round(r["DirAcc_mean"], 1),
        "throughput (pts/s)": r["throughput_pts_per_s"],
        "MAPE%": round(r["MAPE_mean"], 2), "R²": round(r["R2_mean"], 3),
        "Theil U2": round(r["TheilU2_mean"], 3),
    } for r in board])
    best = board[0]
    fastest = max(board, key=lambda r: r["throughput_pts_per_s"])
    most_accurate = max(board, key=lambda r: r["accuracy_score"])
    c1, c2, c3 = st.columns(3)
    c1.metric("🥇 Best composite", best["label"], f"score {best['composite']}")
    c2.metric("🎯 Best accuracy (risk-adj. skill)", most_accurate["label"],
              f"{most_accurate['accuracy_score']} pt")
    c3.metric("⚡ Fastest", fastest["label"], f"{fastest['throughput_pts_per_s']:,} pts/s")
    st.dataframe(lb, use_container_width=True)
    cc1, cc2 = st.columns(2)
    cc1.caption("Composite score (accuracy + directional + efficiency)")
    # st.bar_chart (not st.altair_chart) is avoided here: Streamlit's native
    # bar_chart/line_chart key their underlying Vega-Lite dataset by Python
    # object id() internally, which is a long-standing Streamlit bug ("Error:
    # Unrecognized data set: <id>") on back-to-back native charts in the same
    # run, especially on older Streamlit releases like the 1.22.0 pinned in
    # requirements.txt. Building the chart explicitly with altair sidesteps
    # that code path entirely (altair is already a bundled Streamlit
    # dependency, so this adds no new package).
    score_chart = alt.Chart(lb[["algorithm", "score"]]).mark_bar().encode(
        x=alt.X("algorithm:N", title=None, sort=None),
        y=alt.Y("score:Q", title="composite score"),
        tooltip=["algorithm", "score"],
    )
    cc1.altair_chart(score_chart, use_container_width=True)
    cc2.caption("Component breakdown")
    breakdown_long = lb[["algorithm", "accuracy", "directional", "efficiency"]].melt(
        id_vars="algorithm", var_name="component", value_name="value")
    breakdown_chart = alt.Chart(breakdown_long).mark_bar().encode(
        x=alt.X("algorithm:N", title=None, sort=None),
        y=alt.Y("value:Q", title="score", stack=True),
        color=alt.Color("component:N", title="component"),
        tooltip=["algorithm", "component", "value"],
    )
    cc2.altair_chart(breakdown_chart, use_container_width=True)
    if best["label"] != most_accurate["label"]:
        st.info(f"**{most_accurate['label']}** has the best raw accuracy, but **{best['label']}** wins "
                f"on the composite once throughput is weighed in. This trade-off mainly matters for "
                f"batch/backtest turnaround (e.g. the 300k+-point large-scale benchmark) — the *live* "
                f"engine calls a predictor once per partition per interval (default 5s), where even "
                f"the slowest algorithm here has huge headroom. Reweight `COMPOSITE_WEIGHTS` toward "
                f"`accuracy` in evaluation.py if only the live-engine cost applies to you.")
    st.success(f"Recommendation: **{best['label']}** ({best['family']} family) — "
               f"highest composite score across {mc_runs} randomized workloads.")

# ============================================================ TAB 2: accuracy
with tabs[1]:
    st.subheader("Forecast accuracy (one-step-ahead)")
    rows = []
    for n in compare:
        agg = cached_eval(n, cycles, int(base_seed))["aggregate"]
        rows.append({"algorithm": label(n), "family": family(n),
                     "MAE": round(agg["MAE"]), "RMSE": round(agg["RMSE"]),
                     "MAPE%": round(agg["MAPE"], 2), "sMAPE%": round(agg["sMAPE"], 2),
                     "R²": round(agg["R2"], 3), "DirAcc%": round(agg["DirAcc"], 1),
                     "skill%": round(agg["skill"], 1)})
    st.dataframe(pd.DataFrame(rows), use_container_width=True)

    st.markdown("**Predicted vs actual — hot partition (P0)**")
    wl = cached_workload(cycles, int(base_seed))
    series0 = [c["records_per_sec"] for c in wl[0]]
    chart = {"actual": series0[1:]}
    for n in compare:
        chart[label(n)] = [p for p, _ in ev.predicted_series(n, series0)]
    st.line_chart(pd.DataFrame(chart, index=list(range(1, len(series0)))))
    st.caption("Watch how Kalman / AR track the mid-run burst (cycles 30–40) versus the smoothing methods.")

    st.markdown("**Per-partition MAE matrix** (records/sec — lower is better)")
    mat = []
    for n in compare:
        pp = cached_eval(n, cycles, int(base_seed))["per_partition"]
        row = {"algorithm": label(n)}
        for d in pp:
            row[f"P{d['partition']}"] = round(d["MAE"])
        mat.append(row)
    mdf = pd.DataFrame(mat).set_index("algorithm")
    st.dataframe(mdf.style.background_gradient(cmap="RdYlGn_r", axis=None),
                 use_container_width=True)
    st.caption("Each partition is a different regime: P0 ramp+burst, P1 random walk, "
               "P2 step changes, P3 steady. No single method wins everywhere.")

# ============================================================ TAB 3: lead-time
with tabs[2]:
    st.subheader("PPEA proactive lead-time vs reactive baseline")
    wl = cached_workload(cycles, int(base_seed))
    lt_rows = []
    for n in compare:
        lt = ev.lead_time(n, wl, split_th)
        lt_rows.append({"algorithm": label(n), "PPEA split @cycle": lt["ppea_fire"],
                        "baseline split @cycle": lt["react_fire"],
                        "lead (cycles earlier)": lt["lead"]})
    st.dataframe(pd.DataFrame(lt_rows), use_container_width=True)
    lead_chart = pd.DataFrame(
        [{"algorithm": r["algorithm"], "lead": r["lead (cycles earlier)"] or 0} for r in lt_rows]
    ).set_index("algorithm")
    st.bar_chart(lead_chart["lead"])

    st.markdown(f"**PPS vs split threshold over time — {label(active)} (hot partition)**")
    lt = ev.lead_time(active, wl, split_th)
    st.line_chart(pd.DataFrame({"PPS": lt["pps"], "threshold": [float(split_th)] * len(lt["pps"])}))

    st.markdown(f"**Decision counts — {label(active)} (predictive) vs reactive baseline**")
    dc = ev.decision_counts(active, wl, split_th, cycles)
    dc_df = pd.DataFrame([
        {"action": "split", "PPEA": dc["ppea"]["split"], "baseline": dc["baseline"]["split"]},
        {"action": "reassign", "PPEA": dc["ppea"]["reassign"], "baseline": 0},
        {"action": "merge", "PPEA": dc["ppea"]["merge"], "baseline": 0},
    ]).set_index("action")
    c1, c2 = st.columns([3, 2])
    c1.bar_chart(dc_df)
    c2.dataframe(dc_df, use_container_width=True)
    if float(split_th) <= 1000:
        st.info("PPS scales with load magnitude, so a threshold ≪ 1000 makes PPEA over-eager "
                "(splits almost every cycle). Raise `split_threshold` in the sidebar to calibrate.")

# ============================================================ TAB 4: stress
with tabs[3]:
    st.subheader("Live API stress test — POST /ingest")
    st.caption("Fires concurrent ingest requests at the running API and measures throughput + latency percentiles.")
    if run_stress:
        wl = cached_workload(cycles, int(base_seed))
        bodies = [{"partition": p, "metrics": dict(c)} for p in ev.PARTITIONS for c in wl[p]]

        def fire():
            payload = json.dumps(random.choice(bodies)).encode()
            req = urllib.request.Request(API + "/ingest", data=payload,
                                         headers={"Content-Type": "application/json"})
            t0 = time.perf_counter()
            try:
                with urllib.request.urlopen(req, timeout=10) as r:
                    r.read()
                return (time.perf_counter() - t0) * 1000, True
            except Exception:
                return (time.perf_counter() - t0) * 1000, False

        lats = []
        stats = {"ok": 0, "fail": 0}
        stop_at = time.time() + duration
        start = time.time()
        prog = st.progress(0.0, text="Stressing API…")

        def worker():
            while time.time() < stop_at:
                ms, good = fire()
                lats.append(ms)
                stats["ok" if good else "fail"] += 1

        with ThreadPoolExecutor(max_workers=workers) as exr:
            futs = [exr.submit(worker) for _ in range(workers)]
            while any(not f.done() for f in futs):
                prog.progress(min(1.0, (time.time() - start) / duration), text="Stressing API…")
                time.sleep(0.2)
        prog.progress(1.0, text="Done")

        elapsed = time.time() - start
        ok, fail = stats["ok"], stats["fail"]
        total = ok + fail
        if total:
            lats.sort()
            pct = lambda q: lats[min(len(lats) - 1, int(q * len(lats)))]
            a, b, c, d = st.columns(4)
            a.metric("Throughput", f"{total/elapsed:,.0f} req/s")
            b.metric("Success", f"{100*ok/total:.1f}%", delta=f"{fail} failed" if fail else "0 failed")
            c.metric("Latency p50", f"{pct(.50):.0f} ms")
            d.metric("Latency p99", f"{pct(.99):.0f} ms")
            st.bar_chart(pd.DataFrame({"latency_ms": [pct(.50), pct(.90), pct(.99), max(lats)]},
                                      index=["p50", "p90", "p99", "max"]))
            st.caption(f"{total} requests over {elapsed:.1f}s · mean {statistics.mean(lats):.0f} ms · "
                       f"{workers} workers")
    else:
        st.info("Configure duration / workers in the sidebar, then press **▶ Run API stress test**.")

# ============================================================ TAB 5: large-scale
with tabs[4]:
    st.subheader("📦 Large-Scale Benchmark — 300k+ data points")
    st.caption("Streams a very large synthetic dataset through all five algorithms + PPEA. "
               "Results are persisted to benchmarks/large_scale_benchmark.json and shown here.")

    bench = None
    for cand in ("/app/benchmarks/large_scale_benchmark.json",
                 os.path.join(os.getcwd(), "benchmarks", "large_scale_benchmark.json"),
                 os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
                              "benchmarks", "large_scale_benchmark.json")):
        if os.path.exists(cand):
            try:
                with open(cand) as f:
                    bench = json.load(f)
                break
            except Exception:
                pass

    colA, colB = st.columns([3, 2])
    with colB:
        st.markdown("**Re-run benchmark**")
        n_pts = st.number_input("Data points", min_value=50_000, max_value=2_000_000,
                                value=320_000, step=10_000)
        if st.button("▶ Run large-scale benchmark"):
            prog = st.progress(0.0, text="Starting…")
            bench = ev.large_scale_benchmark(
                n_points=int(n_pts), seed=7,
                progress=lambda fr, msg: prog.progress(min(1.0, fr), text=msg))
            try:
                outdir = "/app/benchmarks" if os.path.isdir("/app") else os.path.join(os.getcwd(), "benchmarks")
                os.makedirs(outdir, exist_ok=True)
                with open(os.path.join(outdir, "large_scale_benchmark.json"), "w") as f:
                    json.dump(bench, f, indent=2)
            except Exception as e:
                st.caption(f"(could not persist: {e})")
            st.success("Benchmark complete.")

    if not bench:
        colA.warning("No benchmark file yet. Run `python scripts/large_benchmark.py` "
                     "or press the button on the right.")
    else:
        with colA:
            verdict = "✅ PASSED" if bench["data_points"] >= 300_000 else "ℹ️"
            st.markdown(f"### {verdict} — tested on **{bench['data_points']:,} data points**")
            m1, m2, m3, m4 = st.columns(4)
            m1.metric("Data points", f"{bench['data_points']:,}")
            m2.metric("Partitions × cycles",
                      f"{bench['partitions']} × {bench['cycles_per_partition']:,}")
            m3.metric("Most accurate (R²)", bench["best_by_r2"])
            m4.metric("Best composite", bench.get("best_by_composite", "n/a (older benchmark file)"),
                      help="accuracy+directional+efficiency composite computed from this run's own "
                           "at-scale throughput -- see evaluation.py COMPOSITE_WEIGHTS")
            st.caption(f"Generated {bench['generated_utc']} · "
                       f"Python {bench['environment']['python']} · {bench['environment']['platform']}")

        rdf = pd.DataFrame([{
            "algorithm": r["label"], "family": r["family"],
            "throughput (pts/s)": r["throughput_pts_per_s"],
            "time (s)": r["time_s"], "µs/point": r["us_per_point"],
            "MAE": r["MAE"], "RMSE": r["RMSE"], "R²": r["R2"], "skill%": r["skill"],
            "composite": r.get("composite", None),
        } for r in bench["results"]]).sort_values("throughput (pts/s)", ascending=False)
        st.markdown("**Per-algorithm performance at scale**")
        st.dataframe(rdf, use_container_width=True)
        c1, c2 = st.columns(2)
        c1.caption("Throughput (points/sec) — higher is better")
        c1.bar_chart(rdf.set_index("algorithm")["throughput (pts/s)"])
        c2.caption("Total processing time (s) — lower is better")
        c2.bar_chart(rdf.set_index("algorithm")["time (s)"])
        st.markdown("**PPEA partition decisions over the full large dataset** "
                    f"(using {bench['best_by_r2']})")
        st.write({"PPEA": bench["ppea_decisions"], "baseline (reactive)": bench["baseline_decisions"]})
        st.caption(f"Workload generation: {bench['gen_time_s']}s · "
                   f"total prediction: {bench['total_predict_time_s']}s · "
                   f"PPEA decision pass: {bench['ppea_decision_time_s']}s")

# ============================================================ TAB 6: live engine
with tabs[5]:
    st.subheader("Live running engine")
    algo = get_json("/algorithm")
    pps = get_json("/pps").get("pps", {})
    events = get_json("/events").get("events", [])
    if "_error" in algo:
        st.warning(f"API not reachable at {API}. Start the api service to populate live metrics.")
    else:
        st.metric("Active prediction algorithm (live)", algo.get("label", "?"))
        if isinstance(pps, dict) and pps:
            c1, c2 = st.columns([3, 2])
            c1.caption("Current PPS per partition")
            c1.bar_chart(pd.DataFrame([{"partition": int(k), "PPS": v} for k, v in pps.items()]
                                      ).set_index("partition")["PPS"])
            from collections import Counter
            c2.write("**Event breakdown** (total {}):".format(len(events)))
            c2.write(dict(Counter(e.get("action") for e in events)))
        if events:
            st.dataframe(pd.DataFrame(events[-60:]), use_container_width=True)
        else:
            st.caption("No events yet — feed the API via /ingest (or run the stress test).")
