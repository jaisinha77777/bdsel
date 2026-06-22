from fastapi import FastAPI
from pydantic import BaseModel
from typing import Dict, List
from .load_monitor import LoadMonitor
from .predictor import EWMAWithTrend
from .ppea import PPEA
from .evolution_engine import EvolutionEngine
from .feedback import FeedbackController
import threading
import time
import copy

app = FastAPI()
monitor = LoadMonitor()

# PPEA and helpers
ppea = PPEA(log_csv="sedp_actions.csv")
evolution = EvolutionEngine()
feedback = FeedbackController(log_csv="sedp_feedback.csv")

# per-partition predictors
predictors: Dict[int, EWMAWithTrend] = {}

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
        if p not in predictors:
            predictors[p] = EWMAWithTrend()
        # use latest records_per_sec
        r = monitor.latest(p, "records_per_sec")
        pred = predictors[p].update_and_predict(r)["predicted"]
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
        if p not in predictors:
            predictors[p] = EWMAWithTrend()

        records_per_sec = monitor.latest(p, "records_per_sec")
        lag = monitor.latest(p, "consumer_lag")
        latency = monitor.latest(p, "processing_latency_ms")
        predicted = predictors[p].update_and_predict(records_per_sec)["predicted"]

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


def monitor_loop(interval: int = 5):
    """Background loop: compute predictions, run PPEA, execute evolution actions, and schedule evaluations."""
    while True:
        parts = monitor.partitions()
        partition_metrics = {}
        # snapshot before decisions
        snapshot = {}
        for p in parts:
            if p not in predictors:
                predictors[p] = EWMAWithTrend()
            latest_r = monitor.latest(p, "records_per_sec")
            pred = predictors[p].update_and_predict(latest_r)["predicted"]
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
            ppea.log_action(typ, target, score, outcome_delta=None)

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

        time.sleep(interval)


@app.on_event("startup")
def start_background_tasks():
    t = threading.Thread(target=monitor_loop, daemon=True)
    t.start()

