"""Spark Structured Streaming job placeholder.
Reads from Kafka topic and writes simple metrics to the LoadMonitor REST API.
"""
from pyspark.sql import SparkSession
from pyspark.sql.functions import expr, col
from pyspark.sql.streaming import StreamingQueryListener
import requests
import json
import time

API = "http://api:8000/ingest"


class StreamingMetricsListener(StreamingQueryListener):
    """Listener that extracts per-batch metrics and posts to SEDP API."""
    def __init__(self, api_url=API):
        self.api = api_url

    def onQueryStarted(self, event):
        # no-op
        pass

    def onQueryProgress(self, event):
        try:
            # event.progress may be a StreamingQueryProgress object; try to get dict
            progress = event.progress
            try:
                pjson = progress.json() if hasattr(progress, "json") else json.loads(progress)
            except Exception:
                pjson = json.loads(str(progress)) if progress is not None else {}
        except Exception:
            pjson = {}

        batch_ms = pjson.get("batchDuration", 0)
        input_rows = pjson.get("numInputRows", 0)
        rps = (input_rows / (batch_ms / 1000.0)) if batch_ms and batch_ms > 0 else float(input_rows)

        sources = pjson.get("sources", [])
        # attempt to derive partition IDs from source endOffsets / endOffset maps
        for src in sources:
            # try several known fields
            offset_map = src.get("endOffset") or src.get("endOffsets") or src.get("offsetRanges")
            partitions = []
            if isinstance(offset_map, dict):
                for k in offset_map.keys():
                    try:
                        partitions.append(int(k))
                    except Exception:
                        # some formats include topic partitions as 'topicName:partition'
                        try:
                            if ":" in k:
                                parts = k.split(":")
                                partitions.append(int(parts[-1]))
                        except Exception:
                            pass

            if not partitions:
                # fallback to single partition 0 when partition parsing fails
                partitions = [0]

            for p in partitions:
                sample = {
                    "records_per_sec": rps,
                    "consumer_lag": 0.0,
                    "processing_latency_ms": pjson.get("processingTime", 0),
                    "queue_depth": 0.0,
                    "bytes_per_sec": 0.0,
                }
                try:
                    requests.post(self.api, json={"partition": p, "metrics": sample}, timeout=2)
                except Exception:
                    # best-effort: do not raise on network errors
                    pass

    def onQueryTerminated(self, event):
        pass


def run(topic="sedp-topic", bootstrap_servers="kafka:9092"):
    spark = SparkSession.builder.appName("sedp-spark-job").getOrCreate()

    # Attach listener to push per-batch metrics to API
    listener = StreamingMetricsListener()
    try:
        spark.streams.addListener(listener)
    except Exception:
        # older/newer Spark versions may differ; ignore listener attachment failure
        pass

    df = (spark.readStream.format("kafka")
          .option("kafka.bootstrap.servers", bootstrap_servers)
          .option("subscribe", topic)
          .load())

    # start a trivial query so the stream runs; actual per-batch metrics are emitted via listener
    query = (df.writeStream.format("console").start())
    try:
        while True:
            time.sleep(5)
    except KeyboardInterrupt:
        query.stop()


if __name__ == "__main__":
    run()
