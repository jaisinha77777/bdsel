# SEDP — Self-Evolving Data Partitioning for Kafka-based Streaming

**Predict partition overload *before* it happens, and rebalance the topology proactively** —
instead of reacting after consumer lag has already built up.

This repo contains the predictive engine (PPEA), **six** interchangeable forecasting
algorithms (including our own **game-theoretic no-regret ensemble**), a FastAPI service,
two Streamlit dashboards, a stress-test harness, and a **300k+ point large-scale benchmark**.

---

## 1. The idea in plain English

A streaming system (Kafka) splits incoming data across **partitions** — think of them as
checkout lanes in a supermarket. Data is rarely spread evenly, so one lane gets slammed
(**data skew**) while others sit idle. The overloaded lane's queue backs up
(**consumer lag**), and the whole pipeline slows down.

Traditional systems are **reactive**: they add a lane only *after* it's already jammed.
SEDP is **predictive**: it forecasts each lane's load, scores how stressed it is, and acts
early — **splitting** a hot partition, **merging** idle ones, or **reassigning** a partition
to a less busy machine. It then checks whether the action helped and adapts its own
decision weights (the *self-evolving* part).

```
Stream → Load Monitor → Predictor → PPEA (decide) → Evolution Engine (split/merge/reassign)
            ▲                                                                  │
            └──────────────────── Feedback Controller ◄────────────────────────┘
```

### The decision rule (PPEA)
For every partition it computes one **Partition Pressure Score**:

```
PPS = w1 · predicted_load  +  w2 · consumer_lag  +  w3 · processing_latency
```

High PPS → **split**; two neighbouring low-PPS partitions → **merge**; large imbalance
across partitions → **reassign** the hottest one. The weights `w1,w2,w3` auto-adjust:
if an action fails to cut lag by ≥10% over 3 cycles, the weight of the metric that best
predicted the failure is increased.

---

## 2. The six prediction algorithms

All implement one interface — `update_and_predict(value) -> {"predicted": ...}` — and are
**pure stdlib** (no numpy/sklearn), so the comparison is apples-to-apples.

| Key | Algorithm | Family | One-line idea |
|-----|-----------|--------|---------------|
| `ewma_trend` | EWMA + Trend | Smoothing | Smoothed recent average, extended along its recent slope. |
| `holt` | Holt Linear (double exp. smoothing) | Smoothing | Tracks *level* and *slope* separately. |
| `ar` | Autoregressive **AR(3)** | Time-series | Next value = fitted formula of the last few values (least-squares). |
| `kalman` | **Kalman filter** (constant-velocity) | State-space | Self-correcting filter balancing prediction vs measurement (as in GPS). |
| `linreg` | Linear Regression (sliding window) | Regression | Best-fit line through recent points, extrapolated one step. |
| `game` | **Game-Theoretic Ensemble** ⭐ *(ours)* | Game-theory | The five above are **rival experts in a repeated game**; no-regret learning backs whoever is currently winning. |

### Our algorithm: the game-theoretic ensemble (⭐)
We treat the five base forecasters as **competing players**. Each round they all predict;
once the true value is revealed, each incurs a loss (its error) and weights update by the
**Multiplicative-Weights / Hedge** rule:

```
w_i  ←  w_i · exp(−η · loss_i)        (then renormalize)
final_prediction = Σ w_i · prediction_i
```

By the **no-regret guarantee** of Hedge (in the idealized fixed-loss-range setting; our
per-round loss normalization is an adaptive variant of that setting, see the docstring in
`predictors.py`), its cumulative error is motivated to stay close to the *best expert in
hindsight* — and it re-allocates weight within a few rounds when the regime changes
(calm ↔ burst), which no single fixed model can do.

**Result:** it has the **best raw accuracy** of the six (highest risk-adjusted skill) and is
the **only** algorithm with **positive skill at 320k points** (i.e. the only one that beats
the naive baseline at scale) — but it does **not** win the composite leaderboard, because it's
also the **slowest by ~90x** (it internally evaluates all five experts every step) and the
composite explicitly weighs throughput. Best accuracy and best overall pick are different
questions; see §6.

---

## 3. Evaluation metrics (what the dashboard shows)

- **MAE / RMSE** — average forecast error (lower = better).
- **MAPE / sMAPE** — error as a percentage. Reported for transparency; not part of the composite
  (see below).
- **R²** — fraction of the pattern captured (closer to 1 = better). Reported for transparency
  only — on this workload R² is nearly flat across all six algorithms (≈0.97–0.99, ~2% of its own
  range) because the trend/burst variance in the workload dominates SST, so it barely
  discriminates between algorithms; it is **not** part of the composite.
- **Directional accuracy** — did it get *up vs down* right? (50% = coin-flip, 100% = perfect.)
- **Skill** — did it beat the naive "next = current" baseline? (positive = yes)
- **Theil's U2** — RMSE vs naive (< 1 = beats naive). Reported for transparency; not part of the
  composite — it's 94–99%+ correlated with skill/R² on this workload (same underlying signal,
  different norm), so including all four would just count that one signal several times.
- **Lead-time** — how many cycles **earlier** PPEA acts vs the reactive baseline.
- **Throughput** — points/sec processed. Now part of the composite (see below), not just the
  large-scale benchmark, since it's what actually limits which algorithm can run live.
- **Composite score** — `composite = 0.5·accuracy + 0.2·directional + 0.3·efficiency` (each on a
  fixed absolute 0–100 scale). See the docstring above `COMPOSITE_WEIGHTS` in `evaluation.py` for
  the full rationale.

---

## 4. Project layout

```
src/sedp/
  predictors.py       # the 6 forecasting algorithms + registry + make_predictor()
  predictor.py        # original EWMA / EWMA+Trend estimators
  ppea.py             # Partition Pressure Score + split/merge/reassign decision logic
  load_monitor.py     # rolling per-partition metrics
  evolution_engine.py # Kafka split/merge/reassign (degrades gracefully w/o a broker)
  feedback.py         # measures whether actions helped (adaptive weights)
  evaluation.py       # metrics, multi-regime workload, Monte-Carlo, leaderboard, large benchmark
  api.py              # FastAPI service (honours SEDP_PREDICTOR; exposes /algorithm,/pps,/comparison,…)
  streamlit_app.py    # live operations dashboard (port 8501)
  eval_dashboard.py   # multi-algorithm evaluation dashboard (port 8502)
scripts/
  evaluate.py         # tiny PPEA demo
  large_benchmark.py  # runs the 300k+ point benchmark → benchmarks/large_scale_benchmark.json
benchmarks/
  large_scale_benchmark.json   # persisted large-scale results (shown on the dashboard)
docker-compose.yml    # api + dashboards (+ optional kafka/zookeeper/spark)
```

---

## 5. How to run

### Option A — Docker (recommended)
Requires Docker Desktop.

```bash
# build & start the API + both dashboards (skips heavy Kafka/Spark images)
docker compose up --build -d api streamlit eval-dashboard
```

Then open:
| URL | What |
|-----|------|
| http://localhost:8000/docs | FastAPI (engine, `/algorithm`, `/pps`, `/comparison`, `/events`) |
| http://localhost:8501 | Live operations dashboard |
| **http://localhost:8502** | **Multi-algorithm evaluation dashboard** (leaderboard, accuracy, lead-time, stress test, large-scale benchmark) |

**Choose the live engine's algorithm** (default `ewma_trend`):
```bash
SEDP_PREDICTOR=game docker compose up -d --force-recreate api   # or kalman / ar / holt / linreg
```

**Feed it data** (the API is fed via HTTP `/ingest`):
```bash
curl -X POST http://localhost:8000/ingest -H "Content-Type: application/json" \
  -d '{"partition":0,"metrics":{"records_per_sec":900000,"consumer_lag":12000,"processing_latency_ms":60}}'
```
…or just press **▶ Run API stress test** on the 8502 dashboard.

### Option B — Local Python (no Docker)
The evaluation engine and benchmark are pure stdlib and run on plain Python (3.10+):

```bash
# 6-algorithm comparison + leaderboard (prints a table)
python -m src.sedp.evaluation

# 300k+ point large-scale benchmark → benchmarks/large_scale_benchmark.json
python scripts/large_benchmark.py 320000

# tiny PPEA decision demo
python scripts/evaluate.py
```
> The API + dashboards need `pip install -r requirements.txt` (best in the Docker image, since
> `pandas`/`numpy` pins target Python 3.10).

---

## 6. Headline results

**Composite leaderboard v2** (60 cycles, 5 seeds; `composite = 0.5·accuracy + 0.2·directional +
0.3·efficiency`, all on a fixed absolute 0–100 scale — see §3):

| # | Algorithm | Composite | accuracy | directional | efficiency | skill% | throughput (pts/s) |
|---|-----------|-----------|----------|--------------|------------|--------|---------------------|
| **1** | **EWMA + Trend** | **43.9** | 22 | 15 | 100 | -22.2% | ~3.3M |
| 2 | Kalman | 43.1 | 43 | 0 | 72 | -10.7% | ~270k |
| 3 | Holt Linear | 33.8 | 0 | 19 | 100 | -38.9% | ~2.5M |
| 4 | Game-Theoretic Ensemble (ours) | 30.7 | **53** | 18 | 1 | **-3.7%** | ~10k |
| 5 | Linear Regression | 26.2 | 15 | 10 | 55 | -25.7% | ~127k |
| 6 | AR(3) | 21.8 | 28 | 7 | 21 | -18.6% | ~27k |

Note the composite winner (EWMA + Trend) and the most *accurate* algorithm (the game-theoretic
ensemble — highest `accuracy` score and only positive skill) are different algorithms. That's
intentional, not a contradiction: the ensemble is ~90x slower (it runs all five other predictors
internally every step). Whether that matters depends on the deployment: it's essentially free for
the *live* engine (api.py's monitor_loop calls each predictor once per partition per interval,
default 5s — even the ensemble's ~50µs/call is negligible against that budget), but it directly
sets the turnaround time of the 300k+-point large-scale benchmark, a headline feature of this
repo, where the ensemble takes ~90x longer than EWMA/Holt to process the same dataset. If your use
case is purely the live engine at a similar partition count/interval, reweight
`COMPOSITE_WEIGHTS` in `evaluation.py` toward `accuracy` — the ensemble wins outright once
efficiency is weighted near zero, reproducing the old (v1) leaderboard's conclusion. Numbers vary
slightly by machine/seed (throughput especially — see the `measure_throughput` docstring for how
that's mitigated); reproduce with `python -m src.sedp.evaluation`.

**Large-scale benchmark — 320,000 data points** (4 partitions × 80,000 cycles): all six
algorithms processed the full dataset; throughput ranges from ~1.8M pts/s (EWMA/Holt) down to
~20k pts/s (our ensemble, which runs all five experts per step). Our ensemble is the **only**
one with **positive skill (+6.6%)** at scale — the accuracy result still stands, it's the
efficiency cost that the composite now makes explicit. PPEA proactively issued 320k splits +
80k reassigns over the run.

> Numbers vary slightly by machine/seed; reproduce with the commands in §5.

---

## 7. Notes & honest caveats
- The **lead-time** is identical across predictors in the current synthetic workload because
  `PPEA.split_threshold` (100) is tiny relative to the PPS magnitude — raise it in the
  dashboard sidebar to see calibrated, predictor-dependent behaviour.
- The game-theoretic algorithm's accuracy edge comes from **combining** the other five (it has
  strictly more information per step than any single component), so it winning on accuracy
  metrics is close to guaranteed by construction, not purely a property of Hedge. Its no-regret
  motivation is also for the idealized fixed-loss-range Hedge setting; this implementation
  rescales losses by each round's own max error (necessary since forecast error has no known
  a-priori bound), which is closer to an adaptive-Hedge variant than the textbook bound — see
  the docstring on `GameTheoreticEnsemble` in `predictors.py`. It is the slowest algorithm by
  design (runs all five experts every step), which the composite score now accounts for.
- `evolution_engine.py` logs a warning and continues if no Kafka broker is present — the demo
  data path is the `/ingest` endpoint, not a live Kafka cluster.
- All six predictors' core math (AR's OLS solver, the Kalman filter's matrix updates, the
  linear-regression closed form) has been checked against independent numpy/textbook
  reimplementations and matches to floating-point precision. There are still no automated
  regression tests for any of this in the repo — the checks above were done ad hoc, not added
  as a `tests/` suite.

See `paper.md` for the research write-up.
