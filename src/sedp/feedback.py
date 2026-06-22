import time
import csv
from collections import deque

class FeedbackController:
    def __init__(self, log_csv="sedp_actions.csv"):
        self.log_csv = log_csv
        # store last metrics snapshots to compute deltas
        self.history = deque(maxlen=10)

    def record_snapshot(self, snapshot):
        # snapshot: {partition: {lag, throughput, pps}}
        self.history.append((time.time(), snapshot))

    def evaluate_action(self, before_snapshot, after_snapshots: list):
        # after_snapshots: list of snapshots over next cycles
        # compute delta in lag and pps
        before = before_snapshot
        after = after_snapshots[-1] if after_snapshots else before_snapshot
        deltas = {}
        for p in before:
            deltas[p] = {
                "lag_delta": before[p].get("lag", 0) - after.get(p, {}).get("lag", 0),
                "pps_delta": before[p].get("pps", 0) - after.get(p, {}).get("pps", 0),
            }
        # log summary
        with open(self.log_csv, "a", newline="") as f:
            writer = csv.writer(f)
            writer.writerow([time.time(), deltas])
        # return percent improvement for primary partition
        improvements = {p: (d["lag_delta"]) for p, d in deltas.items()}
        return improvements
