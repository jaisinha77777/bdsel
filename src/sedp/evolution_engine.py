import logging
from kafka import KafkaAdminClient
from kafka.admin import NewPartitions
import time

logger = logging.getLogger("evolution")

class EvolutionEngine:
    def __init__(self, kafka_bootstrap_servers="localhost:9092", topic="sedp-topic",
                 routing_table=None, max_partitions=16, initial_partitions=1):
        self.kafka = None
        self.servers = kafka_bootstrap_servers
        self.topic = topic
        self.routing_table = routing_table or {}
        # Hard cap on partitions (real Kafka or logical/no-broker). Splitting
        # changes hash(key) % N, which moves the hotspot and re-triggers a
        # split -> unbounded growth. The cap turns split into a no-op once
        # reached, breaking the feedback loop.
        self.max_partitions = max_partitions
        # Explicit logical partition counter. Used (and kept authoritative)
        # whenever no live broker is available, so the cap above is enforced
        # identically with or without Kafka -- previously it was only checked
        # inside the `if self.kafka:` branch, so no-broker runs (the default
        # docker-compose demo path) split without limit.
        self._partition_count = max(1, initial_partitions)
        # No eager _ensure_kafka() call here: this constructor runs at api.py
        # module-import time, before Kafka has any chance to be ready, and
        # every use site below (split_partition) already calls
        # _ensure_kafka() lazily before touching self.kafka -- exactly what
        # _ensure_kafka's own docstring says should happen. Calling it eagerly
        # here just guaranteed a "Kafka admin client unavailable" warning on
        # every cold start instead of letting the first real use retry once
        # Kafka has had time to come up.

    def _ensure_kafka(self):
        """(Re)connect the admin client lazily. The broker is often not ready at
        import time, so we retry on first use instead of failing permanently."""
        if self.kafka is not None:
            return self.kafka
        try:
            self.kafka = KafkaAdminClient(bootstrap_servers=self.servers)
        except Exception as e:
            logger.warning("Kafka admin client unavailable: %s", e)
            self.kafka = None
        return self.kafka

    def split_partition(self, partition):
        """Increase topic partitions by 1 and update routing table. Uses Kafka create_partitions when available."""
        try:
            self._ensure_kafka()
            # Cap applies whether or not a broker is connected.
            current = self._current_partitions()
            if current >= self.max_partitions:
                logger.info("Split skipped: at max_partitions cap (%d)", self.max_partitions)
                return False
            if self.kafka:
                new_total = current + 1
                self.kafka.create_partitions({self.topic: NewPartitions(total_count=new_total)})
                logger.info("Increased partitions to %d", new_total)
            # update routing table: logical split mapping
            self._update_routing_on_split(partition)
            self._partition_count = current + 1
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
        # query the broker for the real partition count when connected; otherwise
        # use the explicitly tracked logical count (not routing_table size, which
        # only grows on split and doesn't reflect the true starting partition count).
        if self.kafka:
            try:
                entry = self.kafka.describe_topics([self.topic])[0]
                parts = entry["partitions"] if isinstance(entry, dict) else entry.partitions
                return len(parts)
            except Exception:
                pass
        return self._partition_count

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
