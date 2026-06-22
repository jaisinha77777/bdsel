import logging
from kafka import KafkaAdminClient
from kafka.admin import NewPartitions
import time

logger = logging.getLogger("evolution")

class EvolutionEngine:
    def __init__(self, kafka_bootstrap_servers="localhost:9092", topic="sedp-topic", routing_table=None):
        self.kafka = None
        self.servers = kafka_bootstrap_servers
        self.topic = topic
        self.routing_table = routing_table or {}
        try:
            self.kafka = KafkaAdminClient(bootstrap_servers=self.servers)
        except Exception as e:
            logger.warning("Kafka admin client unavailable: %s", e)

    def split_partition(self, partition):
        """Increase topic partitions by 1 and update routing table. Uses Kafka create_partitions when available."""
        try:
            if self.kafka:
                # increase partitions by 1
                current = self._current_partitions()
                new_total = current + 1
                self.kafka.create_partitions({self.topic: NewPartitions(total_count=new_total)})
                logger.info("Increased partitions to %d", new_total)
            # update routing table: logical split mapping
            self._update_routing_on_split(partition)
            return True
        except Exception as e:
            logger.exception("Split failed: %s", e)
            return False

    def merge_partitions(self, p1, p2):
        try:
            # merging at application level: coalesce consumers; do not reduce Kafka partition count
            self._update_routing_on_merge(p1, p2)
            logger.info("Merged partitions %s and %s (logical)", p1, p2)
            return True
        except Exception as e:
            logger.exception("Merge failed: %s", e)
            return False

    def reassign_partition(self, partition, target_broker):
        try:
            # Attempt to call alter_partition_reassignments if supported. kafka-python currently lacks helper,
            # so we simulate by updating routing table and logging.
            self.routing_table[partition] = target_broker
            logger.info("Reassigned partition %s to broker %s (logical)", partition, target_broker)
            return True
        except Exception as e:
            logger.exception("Reassign failed: %s", e)
            return False

    def _current_partitions(self):
        # naive: get length of routing table or query metadata
        try:
            md = self.kafka.describe_topics([self.topic])
            return len(md[0].partitions)
        except Exception:
            return len(self.routing_table) or 1

    def _update_routing_on_split(self, partition):
        # split mapping: existing partition routes half of keys to new partition id = max+1
        maxp = max(self.routing_table.keys()) if self.routing_table else partition
        child = maxp + 1
        self.routing_table[child] = self.routing_table.get(partition, "broker-0")

    def _update_routing_on_merge(self, p1, p2):
        # route p2 keys into p1
        if p2 in self.routing_table:
            self.routing_table[p1] = self.routing_table[p2]
            del self.routing_table[p2]
