import threading
import math
import csv
import time
from typing import Dict, List

class PPEA:
    """Predictive Partition Evolution Algorithm (PPEA)."""
    def __init__(self, weights=None, split_threshold=100.00,merge_threshold=20.0,reassign_threshold=0.1,log_csv=None):
        # weights: dict with w1 (predicted load), w2 (lag), w3 (latency)
        self.weights = weights or {"w1": 0.5, "w2": 0.3, "w3": 0.2}
        self.normalize_weights()
        self.split_threshold = split_threshold
        self.merge_threshold = merge_threshold
        self.reassign_threshold = reassign_threshold
        self.lock = threading.Lock()
        self.log_csv = log_csv
        if log_csv:
            with open(self.log_csv, "w", newline="") as f:
                writer = csv.writer(f)
                writer.writerow(["timestamp", "action", "partition", "pps", "weights", "outcome_delta"]) 

    def normalize_weights(self):
        s = sum(self.weights.values())
        if s == 0:
            s = 1.0
        for k in self.weights:
            self.weights[k] = self.weights[k] / s

    def compute_pps(self, predicted_load, consumer_lag, processing_latency):
        w1, w2, w3 = self.weights["w1"], self.weights["w2"], self.weights["w3"]
        return w1 * predicted_load + w2 * consumer_lag + w3 * processing_latency

    def decide(self, partition_metrics: Dict[int, Dict[str, float]]):
        # partition_metrics[p] = {predicted_load, consumer_lag, processing_latency}
        pps = {}
        for p, m in partition_metrics.items():
            pps[p] = self.compute_pps(m["predicted_load"], m.get("consumer_lag", 0.0), m.get("processing_latency", 0.0))

        vals = list(pps.values())
        mean = sum(vals) / len(vals) if vals else 0.0
        variance = sum((x - mean) ** 2 for x in vals) / len(vals) if vals else 0.0
        stddev = math.sqrt(variance)

        actions = []
        # split candidates
        for p, score in pps.items():
            if score > self.split_threshold:
                actions.append(("split", p, score))

        # merge candidates: find neighbors with both below threshold
        sorted_parts = sorted(pps.items(), key=lambda x: x[0])
        for i in range(len(sorted_parts) - 1):
            p1, s1 = sorted_parts[i]
            p2, s2 = sorted_parts[i + 1]
            if s1 < self.merge_threshold and s2 < self.merge_threshold:
                actions.append(("merge", (p1, p2), max(s1, s2)))

        if stddev > self.reassign_threshold * mean if mean>0 else False:
            # reassign: highest PPS
            high = max(pps.items(), key=lambda x: x[1])[0]
            actions.append(("reassign", high, pps[high]))

        return actions, pps, stddev

    def log_action(self, action, partition, pps_value, outcome_delta=None):
        if not self.log_csv:
            return
        with open(self.log_csv, "a", newline="") as f:
            writer = csv.writer(f)
            writer.writerow([time.time(), action, partition, pps_value, self.weights.copy(), outcome_delta])

    def adaptive_update(self, ineffective_metric_key: str, factor: float = 0.1):
        # increase weight of ineffective_metric_key by factor, renormalize
        with self.lock:
            if ineffective_metric_key not in ["w1", "w2", "w3"]:
                return
            self.weights[ineffective_metric_key] += factor
            self.normalize_weights()
