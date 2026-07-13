from fastapi import FastAPI
from pydantic import BaseModel
from typing import Dict, List
from .load_monitor import LoadMonitor
from .predictors import make_predictor, DEFAULT_PREDICTOR, label
from .ppea import PPEA
from .evolution_engine import EvolutionEngine
from .feedback import FeedbackController
import os
import threading
import time
import copy
import json
import logging
from collections import defaultdict

logger = logging.getLogger("sedp.api")

app = FastAPI()
monitor = LoadMonitor()

# Active prediction algorithm for the live engine (configurable via env).
ACTIVE_PREDICTOR = os.environ.get("SEDP_PREDICTOR", DEFAULT_PREDICTOR)

# PPEA and helpers
ppea = PPEA(log_csv="sedp_actions.csv")
KAFKA_BOOTSTRAP = os.environ.get("SEDP_KAFKA", "localhost:9092")
MAX_PARTITIONS = int(os.environ.get("SEDP_MAX_PARTITIONS", "16"))
evolution = EvolutionEngine(kafka_bootstrap_servers=KAFKA_BOOTSTRAP, max_partitions=MAX_PARTITIONS,
                             initial_partitions=4)
feedback = FeedbackController(log_csv="sedp_feedback.csv")

# per-partition predictors (instances of the active algorithm). Accessed both
# from request handlers (main asyncio thread) and monitor_loop (background
# thread), so get-or-create must be atomic -- a race here can silently
# reinitialize a partition's forecasting state mid-stream.
predictors: Dict[int, object] = {}
predictors_lock = threading.Lock()


def get_predictor(partition: int):
    with predictors_lock:
        if partition not in predictors:
            predictors[partition] = make_predictor(ACTIVE_PREDICTOR)
        return predictors[partition]


@app.get("/algorithm")
async def algorithm():
    """Which prediction algorithm the live engine is currently using."""
    return {"key": ACTIVE_PREDICTOR, "label": label(ACTIVE_PREDICTOR)}

# in-memory event log
events: List[Dict] = []
recent_action_times: Dict[str, float] = {}
ACTION_COOLDOWN_SECONDS = 30

# pending evaluations: list of {id, action, partition, before_snapshot, collected_after: []}
pending_evals: List[Dict] = []

class Sample(BaseModel):
    partition: int
    metrics: Dict[str, float]


@app.post("/ingest")
async def ingest(sample: Sample):
    monitor.add_sample(sample.partition, sample.metrics)

    print("INGESTED:", sample.partition)
    print("PARTITIONS:", monitor.partitions())

    return {
        "status": "ok",
        "partitions": monitor.partitions()
    }


@app.get("/partitions")
async def partitions():
    return {"partitions": monitor.partitions()}


@app.get("/metrics/{partition}")
async def metrics(partition: int):
    # return latest metrics for partition
    return {
        "records_per_sec": monitor.latest(partition, "records_per_sec"),
        "consumer_lag": monitor.latest(partition, "consumer_lag"),
        "processing_latency": monitor.latest(partition, "processing_latency_ms"),
        "queue_depth": monitor.latest(partition, "queue_depth"),
        "bytes_per_sec": monitor.latest(partition, "bytes_per_sec"),
    }


@app.get("/timeseries/{partition}/{metric}")
async def timeseries(partition: int, metric: str):
    """Return the rolling timeseries for a given partition and metric."""
    ts = monitor.get_timeseries(partition, metric)
    # convert tuples to lists for JSON
    return {"timeseries": [[t, v] for t, v in ts]}


@app.get("/pps")
async def get_pps():
    # compute PPS using latest predictor states (best-effort)
    parts = monitor.partitions()
    pps_map = {}
    for p in parts:
        # use latest records_per_sec
        r = monitor.latest(p, "records_per_sec")
        pred = get_predictor(p).update_and_predict(r)["predicted"]
        lag = monitor.latest(p, "consumer_lag")
        lat = monitor.latest(p, "processing_latency_ms")
        pps_map[p] = ppea.compute_pps(pred, lag, lat)
    return {"pps": pps_map}


@app.get("/events")
async def get_events():
    # return recent evolution events
    return {"events": events[-200:]}


@app.get("/comparison")
async def comparison():
    """Compare reactive baseline decisions with PPEA predictive decisions."""
    parts = monitor.partitions()
    partition_metrics = {}
    rows = []

    for p in parts:
        records_per_sec = monitor.latest(p, "records_per_sec")
        lag = monitor.latest(p, "consumer_lag")
        latency = monitor.latest(p, "processing_latency_ms")
        predicted = get_predictor(p).update_and_predict(records_per_sec)["predicted"]

        partition_metrics[p] = {
            "predicted_load": predicted,
            "consumer_lag": lag,
            "processing_latency": latency,
        }

    predictive_actions, pps_map, _ = ppea.decide(partition_metrics)

    # Baseline is reactive: it acts only after current lag or latency is already high.
    baseline_actions = []
    for p in parts:
        records_per_sec = monitor.latest(p, "records_per_sec")
        lag = monitor.latest(p, "consumer_lag")
        latency = monitor.latest(p, "processing_latency_ms")

        if lag >= 100 or latency >= 100:
            baseline_actions.append(("split", p, max(lag, latency)))

        if records_per_sec <= 10 and lag <= 5 and latency <= 5:
            baseline_actions.append(("merge_candidate", p, records_per_sec))

    predictive_by_partition = {}
    for action, target, score in predictive_actions:
        if isinstance(target, tuple):
            for p in target:
                predictive_by_partition[p] = action
        else:
            predictive_by_partition[target] = action

    baseline_by_partition = {}
    for action, target, _ in baseline_actions:
        if isinstance(target, tuple):
            for p in target:
                baseline_by_partition[p] = action
        else:
            baseline_by_partition[target] = action

    for p in parts:
        rows.append({
            "partition": p,
            "records_per_sec": monitor.latest(p, "records_per_sec"),
            "consumer_lag": monitor.latest(p, "consumer_lag"),
            "processing_latency_ms": monitor.latest(p, "processing_latency_ms"),
            "predicted_pps": pps_map.get(p, 0.0),
            "baseline_reactive_decision": baseline_by_partition.get(p, "no_action"),
            "ppea_predictive_decision": predictive_by_partition.get(p, "no_action"),
        })

    return {
        "baseline_rule": "split only when current lag >= 100 or latency >= 100",
        "predictive_rule": "use EWMA trend prediction and PPS thresholds",
        "rows": rows,
    }


def _monitor_cycle():
    """One monitor_loop iteration. Raises on failure; monitor_loop is responsible
    for catching that so a single bad cycle (e.g. a transient CSV write error)
    can't permanently kill the background engine thread."""
    parts = monitor.partitions()
    partition_metrics = {}
    # snapshot before decisions
    snapshot = {}
    for p in parts:
        latest_r = monitor.latest(p, "records_per_sec")
        pred = get_predictor(p).update_and_predict(latest_r)["predicted"]
        lag = monitor.latest(p, "consumer_lag")
        lat = monitor.latest(p, "processing_latency_ms")
        partition_metrics[p] = {"predicted_load": pred, "consumer_lag": lag, "processing_latency": lat}
        snapshot[p] = {"lag": lag, "throughput": latest_r, "pps": ppea.compute_pps(pred, lag, lat)}

    actions, pps_map, stddev = ppea.decide(partition_metrics)

    # process actions
    for act in actions:
        typ = act[0]
        target = act[1]
        score = act[2]
        action_key = f"{typ}:{target}"
        now = time.time()
        if now - recent_action_times.get(action_key, 0) < ACTION_COOLDOWN_SECONDS:
            continue

        success = False
        if typ == "split":
            success = evolution.split_partition(target)
        elif typ == "merge":
            p1, p2 = target
            success = evolution.merge_partitions(p1, p2)
        elif typ == "reassign":
            partition = target
            # choose a logical target broker (placeholder)
            target_broker = "broker-1"
            success = evolution.reassign_partition(partition, target_broker)

        recent_action_times[action_key] = now
        ev = {"ts": now, "action": typ, "target": target, "pps": score, "success": success}
        events.append(ev)
        try:
            ppea.log_action(typ, target, score, outcome_delta=None)
        except OSError:
            logger.exception("monitor_loop: failed to write action log, continuing without it")

        # schedule evaluation: store before snapshot and collect next 3 snapshots
        pending_evals.append({"id": len(pending_evals) + 1, "action": typ, "target": target, "before": copy.deepcopy(snapshot), "after": []})

    # advance pending evaluations: collect a snapshot for each pending and evaluate when enough
    for pe in list(pending_evals):
        # collect current snapshot
        curr = {}
        for p in parts:
            curr[p] = {"lag": monitor.latest(p, "consumer_lag"), "pps": pps_map.get(p, 0.0)}
        pe["after"].append(curr)
        if len(pe["after"]) >= 3:
            # evaluate
            improvements = feedback.evaluate_action(pe["before"], pe["after"])
            # decide if ineffective: simple rule: if max improvement <= 0.1 * before lag -> ineffective
            # pick metric to boost: w1 if predicted_load dominated initially
            # compute average before lag
            total_before_lag = sum(v.get("lag", 0) for v in pe["before"].values())
            total_after_lag = sum(v.get("lag", 0) for v in pe["after"][-1].values())
            if total_before_lag > 0:
                reduction = (total_before_lag - total_after_lag) / total_before_lag
            else:
                reduction = 0.0
            if reduction < 0.1:
                # aggressive simple heuristic: if pps change was mostly due to load, increase w1, else choose w2 or w3
                # find partition with highest delta absolute pps
                p_deltas = {p: pe["before"][p]["pps"] - pe["after"][-1].get(p, {}).get("pps", 0.0) for p in pe["before"]}
                if p_deltas:
                    maxp = max(p_deltas.items(), key=lambda x: abs(x[1]))[0]
                    # compare components by magnitude in compute_pps (approx): choose w1
                    ineffective = "w1"
                else:
                    ineffective = "w1"
                ppea.adaptive_update(ineffective, factor=0.1)
            # log evaluation result
            events.append({"ts": time.time(), "action": "eval", "target": pe["target"], "reduction": reduction})
            pending_evals.remove(pe)


def monitor_loop(interval: int = 5):
    """Background loop: run one engine cycle every `interval` seconds.

    A single cycle's failure (e.g. the volume-mounted action-log CSV hitting
    a transient I/O error) must not kill this thread permanently -- it's the
    only thing driving live PPEA decisions, and FastAPI keeps serving HTTP
    requests even after a background thread dies, so a dead engine here is a
    silent failure: the API looks healthy while nothing is actually deciding
    anything anymore.
    """
    while True:
        try:
            _monitor_cycle()
        except Exception:
            logger.exception("monitor_loop: cycle failed, will retry next interval")
        time.sleep(interval)


def kafka_consumer_loop(bootstrap: str, topic: str = "sedp-topic", window: float = 1.0):
    """Live ingestion: consume the Kafka topic and feed per-partition metrics to the
    LoadMonitor every `window` seconds. Each Kafka partition maps to an engine partition.

    Derived per partition, per window:
      records_per_sec     = messages / elapsed
      bytes_per_sec       = bytes / elapsed
      processing_latency  = mean (now - producer_ts), ms
      consumer_lag        = end_offset - current_position
    """
    from kafka import KafkaConsumer

    consumer = None
    while consumer is None:
        try:
            consumer = KafkaConsumer(
                topic,
                bootstrap_servers=bootstrap,
                group_id="sedp-engine",
                auto_offset_reset="latest",
                enable_auto_commit=True,
            )
        except Exception as e:
            print("kafka consumer: waiting for broker:", e)
            time.sleep(2)
    print("kafka consumer: subscribed to", topic, "via", bootstrap)

    counts = defaultdict(int)
    bytes_acc = defaultdict(int)
    lat_sum = defaultdict(float)
    last_flush = time.time()

    while True:
        try:
            batch = consumer.poll(timeout_ms=500)
            now = time.time()
            for tp, msgs in batch.items():
                for m in msgs:
                    counts[tp.partition] += 1
                    bytes_acc[tp.partition] += len(m.value or b"")
                    try:
                        ts = json.loads(m.value.decode()).get("ts", now)
                        lat_sum[tp.partition] += max(0.0, (now - ts) * 1000.0)
                    except Exception:
                        pass

            if now - last_flush >= window:
                elapsed = now - last_flush
                assigned = consumer.assignment()
                end_offsets = consumer.end_offsets(list(assigned)) if assigned else {}
                for tp in assigned:
                    p = tp.partition
                    c = counts.get(p, 0)
                    try:
                        pos = consumer.position(tp)
                        lag = max(0, end_offsets.get(tp, pos) - pos)
                    except Exception:
                        lag = 0
                    monitor.add_sample(p, {
                        "records_per_sec": c / elapsed,
                        "bytes_per_sec": bytes_acc.get(p, 0) / elapsed,
                        "processing_latency_ms": (lat_sum.get(p, 0.0) / c) if c else 0.0,
                        "consumer_lag": lag,
                        "queue_depth": lag,
                    })
                counts.clear(); bytes_acc.clear(); lat_sum.clear()
                last_flush = now
        except Exception as e:
            print("kafka consumer error:", e)
            time.sleep(1)


@app.on_event("startup")
def start_background_tasks():
    t = threading.Thread(target=monitor_loop, daemon=True)
    t.start()
    # only start live Kafka ingestion when a broker is configured
    if os.environ.get("SEDP_KAFKA"):
        k = threading.Thread(
            target=kafka_consumer_loop,
            args=(os.environ["SEDP_KAFKA"],),
            daemon=True,
        )
        k.start()

