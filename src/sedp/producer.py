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
