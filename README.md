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

By the **no-regret guarantee** of Hedge, its cumulative error stays within
`O(√(T·log N))` of the *best expert in hindsight* — so it is **provably competitive with
whichever base method turns out best**, and it re-allocates weight within a few rounds when
the regime changes (calm ↔ burst), which no single fixed model can do.

**Result:** it ranks **#1** on the composite leaderboard and is the **only** algorithm with
**positive skill at 320k points** (i.e. the only one that beats the naive baseline at scale).
Its trade-off is speed — it internally evaluates all five experts every step.

---

## 3. Evaluation metrics (what the dashboard shows)

- **MAE / RMSE** — average forecast error (lower = better).
- **MAPE / sMAPE** — error as a percentage.
- **R²** — fraction of the pattern captured (closer to 1 = better).
- **Directional accuracy** — did it get *up vs down* right?
- **Skill** — did it beat the naive "next = current" baseline? (positive = yes)
- **Theil's U2** — RMSE vs naive (< 1 = beats naive).
- **Lead-time** — *the headline*: how many cycles **earlier** PPEA acts vs the reactive baseline.
- **Throughput** — points/sec processed (the large-scale benchmark).
- **Composite score** — normalized 0–100 blend used for ranking, with Monte-Carlo confidence over seeds.

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

**Composite leaderboard** (60 cycles, 5 seeds):

| # | Algorithm | Composite | MAPE | DirAcc | R² |
|---|-----------|-----------|------|--------|----|
| **1** | **Game-Theoretic Ensemble (ours)** | **~93** | 14.1% | 60% | 0.985 |
| 2 | Kalman | ~82 | 15.5% | 48% | 0.988 |
| 3 | EWMA + Trend | ~72 | 14.9% | 58% | 0.982 |
| 4 | Linear Regression | ~61 | 17.2% | 55% | 0.982 |
| 5 | Holt Linear | ~37 | 16.5% | 59% | 0.971 |
| 6 | AR(3) | ~15 | — | — | 0.978 |

**Large-scale benchmark — 320,000 data points** (4 partitions × 80,000 cycles): all six
algorithms processed the full dataset; throughput ranges from ~1.8M pts/s (EWMA/Holt) down to
~20k pts/s (our ensemble, which runs all five experts per step). Our ensemble is the **only**
one with **positive skill (+6.6%)** at scale. PPEA proactively issued 320k splits + 80k
reassigns over the run.

> Numbers vary slightly by machine/seed; reproduce with the commands in §5.

---

## 7. Notes & honest caveats
- The **lead-time** is identical across predictors in the current synthetic workload because
  `PPEA.split_threshold` (100) is tiny relative to the PPS magnitude — raise it in the
  dashboard sidebar to see calibrated, predictor-dependent behaviour.
- The game-theoretic algorithm's edge comes from **combining** the other five (the no-regret
  guarantee is the real theoretical contribution); it is the slowest by design.
- `evolution_engine.py` logs a warning and continues if no Kafka broker is present — the demo
  data path is the `/ingest` endpoint, not a live Kafka cluster.

See `paper.md` for the research write-up.
