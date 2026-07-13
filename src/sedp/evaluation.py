"""SEDP evaluation engine — algorithm comparison, scoring and ranking.

Pure stdlib. Used by both the CLI harness (host Python) and the Streamlit
evaluation dashboard (container). Provides:

  * a multi-regime synthetic workload generator (ramp+burst, random walk,
    step changes, diurnal) so different predictor families are stressed
    differently;
  * a rich forecast-accuracy metric suite (MAE, RMSE, MAPE, sMAPE, R2,
    directional accuracy, Theil's U2, skill);
  * PPEA proactive lead-time vs the reactive baseline;
  * Monte-Carlo evaluation across seeds (mean +/- std confidence);
  * a normalized composite score and leaderboard ranking.
"""
import math
import random
import statistics
import time
import platform
from datetime import datetime, timezone
from .predictors import make_predictor, PREDICTORS, label, family
from .ppea import PPEA

PARTITIONS = [0, 1, 2, 3]
DRAIN = 250000.0                 # consumer drain capacity (records/sec)
LAG_TH, LAT_TH = 100, 100        # reactive baseline thresholds (mirrors api.py)


# --------------------------------------------------------------------------- #
def gen_workload(cycles: int, seed: int):
    """Four partitions, four different dynamical regimes."""
    rng = random.Random(seed)
    wl = {p: [] for p in PARTITIONS}
    lag = {p: 0.0 for p in PARTITIONS}
    rw = 30000.0                                   # random-walk state for P1
    step = 20000.0                                 # step state for P2
    for t in range(cycles):
        for p in PARTITIONS:
            if p == 0:                             # ramp + mid-run burst + diurnal
                base = 60000 + 9000 * t
                base += 25000 * math.sin(t / 6.0)
                if 30 <= t <= 40:
                    base += 250000 * math.sin((t - 30) / 10 * math.pi)
                rps = base + rng.gauss(0, 15000)
            elif p == 1:                           # random walk
                rw = max(5000.0, rw + rng.gauss(0, 9000))
                rps = rw
            elif p == 2:                           # piecewise step changes
                if t % 15 == 0:
                    step = rng.choice([12000, 28000, 45000, 60000])
                rps = step + rng.gauss(0, 2500)
            else:                                  # steady + noise
                rps = 25000 + rng.gauss(0, 3000)
            rps = max(0.0, rps)
            lag[p] = max(0.0, lag[p] + (rps - DRAIN) * 0.02)
            latency = 5.0 + lag[p] / 200.0
            wl[p].append({"records_per_sec": round(rps, 1),
                          "consumer_lag": round(lag[p], 1),
                          "processing_latency_ms": round(latency, 1)})
    return wl


# --------------------------------------------------------------------------- #
def _accuracy(pairs, naive_pairs):
    """pairs / naive_pairs: list of (predicted, actual). Returns metric dict."""
    n = len(pairs)
    if n == 0:
        return {}
    ae = [abs(a - b) for a, b in pairs]
    se = [(a - b) ** 2 for a, b in pairs]
    ape = [abs(a - b) / b * 100 for a, b in pairs if b > 0]
    smape = [200 * abs(a - b) / (abs(a) + abs(b)) for a, b in pairs if (abs(a) + abs(b)) > 0]
    mae = statistics.mean(ae)
    rmse = math.sqrt(statistics.mean(se))
    mape = statistics.mean(ape) if ape else 0.0
    smap = statistics.mean(smape) if smape else 0.0
    # R^2 against actual variance
    actual = [b for _, b in pairs]
    mu = statistics.mean(actual)
    sst = sum((b - mu) ** 2 for b in actual)
    sse = sum(se)
    r2 = 1 - sse / sst if sst > 0 else 0.0
    # directional accuracy: did we predict the sign of change correctly?
    hits = 0
    for i in range(1, len(pairs)):
        pred_dir = pairs[i][0] - pairs[i - 1][1]
        act_dir = pairs[i][1] - pairs[i - 1][1]
        if pred_dir * act_dir > 0 or (pred_dir == 0 and act_dir == 0):
            hits += 1
    diracc = 100 * hits / (len(pairs) - 1) if len(pairs) > 1 else 0.0
    # Theil's U2 vs naive (next = current)
    naive_mae = statistics.mean(abs(a - b) for a, b in naive_pairs)
    naive_rmse = math.sqrt(statistics.mean((a - b) ** 2 for a, b in naive_pairs))
    theil = rmse / naive_rmse if naive_rmse > 0 else 0.0
    skill = (1 - mae / naive_mae) * 100 if naive_mae > 0 else 0.0
    return {"MAE": mae, "RMSE": rmse, "MAPE": mape, "sMAPE": smap, "R2": r2,
            "DirAcc": diracc, "TheilU2": theil, "skill": skill, "naiveMAE": naive_mae}


def evaluate_predictor(name: str, wl: dict):
    """One-step-ahead evaluation of a predictor across all partitions."""
    per_part = []
    all_pairs, all_naive = [], []
    for p in PARTITIONS:
        est = make_predictor(name)
        series = [c["records_per_sec"] for c in wl[p]]
        pairs, naive = [], []
        for i in range(len(series) - 1):
            pred = est.update_and_predict(series[i])["predicted"]
            pairs.append((pred, series[i + 1]))
            naive.append((series[i], series[i + 1]))
        m = _accuracy(pairs, naive)
        m["partition"] = p
        per_part.append(m)
        all_pairs += pairs
        all_naive += naive
    agg = _accuracy(all_pairs, all_naive)
    agg["algorithm"] = name
    agg["label"] = label(name)
    agg["family"] = family(name)
    return {"per_partition": per_part, "aggregate": agg}


def predicted_series(name: str, series):
    """Return one-step-ahead predictions aligned to actuals (for plotting)."""
    est = make_predictor(name)
    out = []
    for i in range(len(series) - 1):
        out.append((est.update_and_predict(series[i])["predicted"], series[i + 1]))
    return out


# --------------------------------------------------------------------------- #
def lead_time(name: str, wl: dict, split_threshold: float, partition: int = 0):
    """Cycle at which PPEA (predictive) vs reactive baseline first decide to split."""
    ppea = PPEA(split_threshold=float(split_threshold), log_csv=None)
    est = make_predictor(name)
    ppea_fire = react_fire = None
    pps_series = []
    for t, c in enumerate(wl[partition]):
        pred = est.update_and_predict(c["records_per_sec"])["predicted"]
        pps = ppea.compute_pps(pred, c["consumer_lag"], c["processing_latency_ms"])
        pps_series.append(pps)
        if ppea_fire is None and pps > float(split_threshold):
            ppea_fire = t
        if react_fire is None and (c["consumer_lag"] >= LAG_TH or c["processing_latency_ms"] >= LAT_TH):
            react_fire = t
    lead = (react_fire - ppea_fire) if (ppea_fire is not None and react_fire is not None) else None
    return {"ppea_fire": ppea_fire, "react_fire": react_fire, "lead": lead, "pps": pps_series}


def decision_counts(name: str, wl: dict, split_threshold: float, cycles: int):
    ppea = PPEA(split_threshold=float(split_threshold), log_csv=None)
    ests = {p: make_predictor(name) for p in PARTITIONS}
    pc = {"split": 0, "merge": 0, "reassign": 0}
    bc = {"split": 0}
    for t in range(cycles):
        pm = {}
        for p in PARTITIONS:
            c = wl[p][t]
            pred = ests[p].update_and_predict(c["records_per_sec"])["predicted"]
            pm[p] = {"predicted_load": pred, "consumer_lag": c["consumer_lag"],
                     "processing_latency": c["processing_latency_ms"]}
            if c["consumer_lag"] >= LAG_TH or c["processing_latency_ms"] >= LAT_TH:
                bc["split"] += 1
        actions, _, _ = ppea.decide(pm)
        for a, _, _ in actions:
            pc[a] = pc.get(a, 0) + 1
    return {"ppea": pc, "baseline": bc}


# --------------------------------------------------------------------------- #
def monte_carlo(name: str, cycles: int, seeds):
    """Aggregate metrics across many seeds -> mean & std (confidence)."""
    keys = ["MAE", "RMSE", "MAPE", "sMAPE", "R2", "DirAcc", "TheilU2", "skill"]
    acc = {k: [] for k in keys}
    for s in seeds:
        agg = evaluate_predictor(name, gen_workload(cycles, s))["aggregate"]
        for k in keys:
            acc[k].append(agg[k])
    out = {"algorithm": name, "label": label(name), "family": family(name), "runs": len(seeds)}
    for k in keys:
        out[k + "_mean"] = statistics.mean(acc[k])
        out[k + "_std"] = statistics.pstdev(acc[k]) if len(acc[k]) > 1 else 0.0
    return out


def measure_throughput(name: str, n_points: int = 30_000, seed: int = 0, repeats: int = 5) -> float:
    """Timing pass (independent of the Monte-Carlo accuracy runs) -> points/sec.

    Not repeated per Monte-Carlo seed: algorithmic cost is ~deterministic
    given the implementation (input magnitude barely affects Python-level op
    count). It IS repeated `repeats` times, with GC disabled during each
    timed region, and the best (max throughput) run is kept -- a single
    GC-enabled pass was observed to vary 2-3x run-to-run purely from
    scheduling/GC jitter, enough to move an algorithm's efficiency_score (and
    thus composite) between otherwise-identical runs. This mirrors what
    `timeit` does internally: scheduling/GC pauses can only slow a run down,
    never make it artificially fast, so best-of-N with GC off is the closest
    cheap estimate of steady-state throughput.
    """
    import gc
    rng = random.Random(seed)
    series = [50_000.0]
    for _ in range(n_points - 1):
        series.append(max(0.0, series[-1] + rng.gauss(0, 4000)))

    best_dt = float("inf")
    for _ in range(repeats):
        est = make_predictor(name)
        gc.disable()
        try:
            t0 = time.perf_counter()
            for v in series:
                est.update_and_predict(v)
            best_dt = min(best_dt, time.perf_counter() - t0)
        finally:
            gc.enable()
    return n_points / best_dt if best_dt > 0 else float("inf")


# --------------------------------------------------------------------------- #
# Composite score v2.
#
# v1 blended 5 metrics (skill, MAPE, R2, DirAcc, TheilU2) with per-run min-max
# normalization. Two problems, confirmed empirically against this repo's own
# 6-algorithm Monte-Carlo run:
#
#   1. Redundancy: skill, MAPE, R2 and TheilU2 are all transforms of the same
#      "error relative to a baseline" construct (corr(skill,R2)=+0.94,
#      corr(skill,TheilU2)=-0.96, corr(R2,TheilU2)=-0.997). R2 especially has
#      ~2% dynamic range across all 6 algorithms (0.971-0.988) against
#      skill's ~33-point range, because SST here is dominated by the
#      workload's own trend/burst variance, not forecast error -- R2 stays
#      near 1.0 almost regardless of which algorithm is used. Weighting 4
#      near-collinear metrics ~equally quadruple-counts one signal while
#      DirAcc (the one genuinely different axis) gets a single vote.
#   2. Instability: min-max normalization is relative to whichever algorithms
#      happen to be in `names`. The same algorithm, byte-identical accuracy,
#      scored 61.0 when compared against all 6 algorithms but 35.0 against a
#      2-algorithm subset -- not a property a "score" should have.
#   3. Blind to cost: the composite ignored throughput entirely, despite the
#      large-scale benchmark (a stated core deliverable of this repo) showing
#      a ~90x throughput spread between algorithms.
#
# v2 uses three near-orthogonal components, each mapped to an ABSOLUTE [0,100]
# scale via fixed reference points instead of the comparison set:
#
#   accuracy    risk-adjusted skill = skill_mean - Z*skill_std (penalizes
#               algorithms that are only good on lucky seeds), mapped so 0%
#               skill (naive parity) = 50pts, +20% = 100pts, -40% = 0pts.
#   directional DirAcc mapped so 50% (coin-flip) = 0pts, 100% = 100pts.
#   efficiency  throughput (points/sec) on a log scale: 10k pts/s = 0pts,
#               1M pts/s = 100pts.
#
# composite = 0.5*accuracy + 0.2*directional + 0.3*efficiency
#
# Efficiency is weighted at 0.3, but note *why*: in the live engine
# (api.py's monitor_loop) each predictor runs once per partition per
# interval (default every 5s), so even the slowest algorithm here (~50us/call)
# has enormous headroom there -- throughput is NOT the live decision loop's
# bottleneck at the current interval/partition-count scale. It matters for
# (a) the 300k+-point large-scale benchmark's turnaround time, a headline
# feature of this repo, and (b) headroom if the system moves to finer-grained
# (per-record or sub-second-interval) scoring later. v1 had no way to express
# this cost dimension at all; weight it down via COMPOSITE_WEIGHTS if neither
# of those applies to your deployment.
#
# EFF_HI=1,000,000 (not the naive "2,000,000 pts/s, roughly what EWMA/Holt
# measured in the README" choice) is deliberate: on measurement, raw
# points/sec for cheap predictors like EWMA/Holt swings 2-4x run-to-run from
# ordinary OS/GC scheduling jitter (verified: 1.3M-4.9M pts/s across repeated
# measurements of the *same* algorithm, same process). An anchor sitting
# inside that noise band makes the composite non-reproducible for reasons
# that have nothing to do with the algorithm. 1,000,000 sits safely below the
# whole observed noise band for the fast tier (so they saturate to 100
# consistently) while still leaving room to separate the mid/slow algorithms
# (Kalman ~360k, linreg ~250k, AR ~34k, the ensemble ~16-20k).
SKILL_RISK_Z = 1.0
SKILL_LO, SKILL_HI = -40.0, 20.0           # skill% anchors -> 0pt / 100pt
EFF_LO, EFF_HI = 10_000.0, 1_000_000.0     # points/sec anchors -> 0pt / 100pt
COMPOSITE_WEIGHTS = {"accuracy": 0.5, "directional": 0.2, "efficiency": 0.3}


def _clip01(x):
    return 0.0 if x < 0 else (1.0 if x > 1 else x)


def _lerp_clip(x, lo, hi):
    if hi <= lo:
        return 100.0
    return 100.0 * _clip01((x - lo) / (hi - lo))


def leaderboard(names, cycles, seeds, weights=None):
    """Composite, absolute-scale 0-100 score across algorithms (Monte-Carlo means).

    Unlike v1, this does NOT normalize relative to `names`: a given
    algorithm's composite is the same number regardless of which other
    algorithms it happens to be compared against (see rationale above
    COMPOSITE_WEIGHTS).
    """
    w = weights or COMPOSITE_WEIGHTS
    rows = [monte_carlo(n, cycles, seeds) for n in names]
    for r in rows:
        risk_adj_skill = r["skill_mean"] - SKILL_RISK_Z * r["skill_std"]
        accuracy = _lerp_clip(risk_adj_skill, SKILL_LO, SKILL_HI)
        directional = _lerp_clip(r["DirAcc_mean"], 50.0, 100.0)
        thr = measure_throughput(r["algorithm"])
        efficiency = _lerp_clip(math.log10(max(thr, 1.0)), math.log10(EFF_LO), math.log10(EFF_HI))
        r["throughput_pts_per_s"] = round(thr)
        r["accuracy_score"] = round(accuracy, 1)
        r["directional_score"] = round(directional, 1)
        r["efficiency_score"] = round(efficiency, 1)
        r["composite"] = round(w["accuracy"] * accuracy + w["directional"] * directional
                                + w["efficiency"] * efficiency, 1)
    rows.sort(key=lambda r: r["composite"], reverse=True)
    for rank, r in enumerate(rows, 1):
        r["rank"] = rank
    return rows


# --------------------------------------------------------------------------- #
def large_scale_benchmark(n_points: int = 320_000, seed: int = 7,
                          split_threshold: float = 100.0, progress=None):
    """Stream a very large synthetic dataset (>= n_points) through every
    predictor + PPEA, measuring throughput, latency and accuracy at scale.

    Returns a JSON-serializable record (persisted by scripts/large_benchmark.py
    and rendered on the dashboard) proving the system was exercised on a large
    dataset. `progress(frac, msg)` is an optional callback for UI updates.
    """
    parts = PARTITIONS
    cycles = math.ceil(n_points / len(parts))
    total_points = cycles * len(parts)

    if progress:
        progress(0.05, f"Generating {total_points:,} data points…")
    t_gen0 = time.perf_counter()
    wl = gen_workload(cycles, seed)
    gen_time = time.perf_counter() - t_gen0
    series = {p: [c["records_per_sec"] for c in wl[p]] for p in parts}

    results = []
    names = list(PREDICTORS.keys())
    for idx, name in enumerate(names):
        if progress:
            progress(0.1 + 0.7 * idx / len(names), f"Benchmarking {label(name)}…")
        all_pairs, all_naive = [], []
        t0 = time.perf_counter()
        for p in parts:
            est = make_predictor(name)
            s = series[p]
            for i in range(len(s) - 1):
                pred = est.update_and_predict(s[i])["predicted"]
                all_pairs.append((pred, s[i + 1]))
                all_naive.append((s[i], s[i + 1]))
        dt = time.perf_counter() - t0
        m = _accuracy(all_pairs, all_naive)
        n_pred = len(all_pairs)
        throughput = n_pred / dt if dt > 0 else 0.0
        # Same absolute-scale composite as leaderboard() (see COMPOSITE_WEIGHTS
        # above), reusing this run's own real throughput instead of a separate
        # measure_throughput() timing pass. No risk-adjustment term here (that
        # needs a skill std across Monte-Carlo seeds; this is a single seed at
        # full scale, not repeated seeds).
        accuracy_score = _lerp_clip(m["skill"], SKILL_LO, SKILL_HI)
        directional_score = _lerp_clip(m["DirAcc"], 50.0, 100.0)
        efficiency_score = _lerp_clip(math.log10(max(throughput, 1.0)),
                                       math.log10(EFF_LO), math.log10(EFF_HI))
        composite = (COMPOSITE_WEIGHTS["accuracy"] * accuracy_score
                     + COMPOSITE_WEIGHTS["directional"] * directional_score
                     + COMPOSITE_WEIGHTS["efficiency"] * efficiency_score)
        results.append({
            "algorithm": name, "label": label(name), "family": family(name),
            "points_processed": n_pred,
            "time_s": round(dt, 3),
            "throughput_pts_per_s": round(throughput) if dt > 0 else 0,
            "us_per_point": round(dt / n_pred * 1e6, 3) if n_pred else 0,
            "MAE": round(m["MAE"], 1), "RMSE": round(m["RMSE"], 1),
            "MAPE": round(m["MAPE"], 2), "R2": round(m["R2"], 4),
            "skill": round(m["skill"], 1), "DirAcc": round(m["DirAcc"], 1),
            "accuracy_score": round(accuracy_score, 1),
            "directional_score": round(directional_score, 1),
            "efficiency_score": round(efficiency_score, 1),
            "composite": round(composite, 1),
        })

    # R2 is reported below (best_by_r2) for transparency, but it's not used to
    # pick which algorithm drives the PPEA decision pass: at full 320k scale
    # R2 rounds to 1.0000 for all six algorithms (SST is dominated by the
    # workload's own trend, not forecast error -- same degeneracy documented
    # on COMPOSITE_WEIGHTS above), so max(results, key=R2) just returns
    # whichever algorithm happens to be first among ties, not a real choice.
    # composite doesn't degenerate the same way, so it drives the pass instead.
    most_accurate_by_r2 = max(results, key=lambda r: r["R2"])
    best = max(results, key=lambda r: r["composite"])
    if progress:
        progress(0.85, f"Running PPEA decisions at scale ({best['label']})…")
    t0 = time.perf_counter()
    dc = decision_counts(best["algorithm"], wl, split_threshold, cycles)
    ppea_time = time.perf_counter() - t0

    if progress:
        progress(1.0, "Done")
    total_pred_time = sum(r["time_s"] for r in results)
    return {
        "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
        "data_points": total_points,
        "partitions": len(parts),
        "cycles_per_partition": cycles,
        "seed": seed,
        "split_threshold": split_threshold,
        "gen_time_s": round(gen_time, 3),
        "total_predict_time_s": round(total_pred_time, 3),
        "ppea_decision_time_s": round(ppea_time, 3),
        "environment": {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "processor": platform.processor() or "n/a",
        },
        "best_by_r2": most_accurate_by_r2["label"],
        "best_by_composite": best["label"],
        "ppea_decisions": dc["ppea"],
        "baseline_decisions": dc["baseline"],
        "results": results,
    }


# --------------------------------------------------------------------------- #
def cli_report(cycles=60, seeds=(1, 2, 3, 4, 5), split_threshold=100.0):
    names = list(PREDICTORS.keys())
    print(f"\nSEDP ALGORITHM COMPARISON  (cycles={cycles}, seeds={len(seeds)}, split_th={split_threshold})")
    print("=" * 92)
    board = leaderboard(names, cycles, list(seeds))
    print("composite = 0.5*accuracy(risk-adj. skill) + 0.2*directional(DirAcc) + 0.3*efficiency(throughput),"
          " each on a fixed absolute 0-100 scale (see evaluation.py docstring above COMPOSITE_WEIGHTS)")
    print(f"{'#':>2}  {'algorithm':<26}{'family':<13}{'skill%':>8}{'DirAcc%':>9}"
          f"{'pts/s':>10}{'acc':>6}{'dir':>6}{'eff':>6}{'score':>8}")
    for r in board:
        print(f"{r['rank']:>2}  {r['label']:<26}{r['family']:<13}"
              f"{r['skill_mean']:>8.1f}{r['DirAcc_mean']:>9.1f}"
              f"{r['throughput_pts_per_s']:>10,}{r['accuracy_score']:>6.0f}"
              f"{r['directional_score']:>6.0f}{r['efficiency_score']:>6.0f}{r['composite']:>8.1f}")
    wl = gen_workload(cycles, seeds[0])
    print("\nProactive lead-time vs reactive baseline (hot partition, single seed):")
    for n in names:
        lt = lead_time(n, wl, split_threshold)
        print(f"  {label(n):<26} PPEA@{lt['ppea_fire']}  baseline@{lt['react_fire']}  "
              f"lead={lt['lead']} cycles")
    print("\nBest overall:", board[0]["label"], f"(score {board[0]['composite']})")
    return board


if __name__ == "__main__":
    cli_report()
