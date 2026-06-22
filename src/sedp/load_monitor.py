from collections import deque, defaultdict
from threading import Lock
import time

class LoadMonitor:
    """Collects per-partition metrics on a configurable interval and stores rolling windows."""
    def __init__(self, window_count=60):
        self.window_count = window_count
        self.data = defaultdict(lambda: defaultdict(lambda: deque(maxlen=window_count)))
        self.lock = Lock()

    def add_sample(self, partition, sample: dict, timestamp=None):
        """sample: dict with keys records_per_sec, consumer_lag, processing_latency_ms, queue_depth, bytes_per_sec"""
        ts = timestamp or time.time()
        with self.lock:
            for k, v in sample.items():
                self.data[partition][k].append((ts, v))

    def get_timeseries(self, partition, metric):
        with self.lock:
            return list(self.data[partition][metric])

    def latest(self, partition, metric, default=0.0):
        with self.lock:
            dq = self.data[partition][metric]
            return dq[-1][1] if dq else default

    def partitions(self):
        with self.lock:
            return list(self.data.keys())
