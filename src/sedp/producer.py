import time
import random
from kafka import KafkaProducer
import json

class SyntheticProducer:
    def __init__(self, bootstrap_servers="localhost:9092", topic="sedp-topic", skew_ratio=0.8, partitions=4):
        self.producer = KafkaProducer(bootstrap_servers=bootstrap_servers, value_serializer=lambda v: json.dumps(v).encode())
        self.topic = topic
        self.skew_ratio = skew_ratio
        self.partitions = partitions

    def generate(self, rps=1000, message_size=100, duration_sec=10, burst=False):
        total = rps * duration_sec
        for i in range(total):
            val = "x" * message_size
            # choose partition: skew_ratio to partition 0
            if random.random() < self.skew_ratio:
                key = b"0"
            else:
                key = str(random.randint(1, self.partitions - 1)).encode()
            self.producer.send(self.topic, key=key, value={"msg": val, "ts": time.time()})
            if i % max(1, rps // 10) == 0:
                self.producer.flush()
            time.sleep(1.0 / rps)


if __name__ == "__main__":
    import os

    bootstrap = os.environ.get("SEDP_KAFKA", "localhost:9092")
    rps = int(os.environ.get("SEDP_RPS", "500"))

    prod = None
    while prod is None:
        try:
            prod = SyntheticProducer(bootstrap_servers=bootstrap)
        except Exception as e:
            print("producer: waiting for broker:", e)
            time.sleep(2)

    print(f"producer: streaming ~{rps} rps (skew 0.8 -> partition 0) to {bootstrap}")
    while True:
        prod.generate(rps=rps, duration_sec=10, burst=False)
