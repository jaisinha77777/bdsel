"""Evaluation harness for SEDP vs baseline.
This script runs scenarios (simulated) and collects metrics for plotting.
"""
import time
import csv
from src.sedp.predictor import EWMAWithTrend
from src.sedp.ppea import PPEA

def run_synthetic_scenario():
    # minimal runner to demonstrate PPEA decisions with synthetic metrics
    predictor = EWMAWithTrend()
    ppea = PPEA(log_csv="sedp_actions.csv")
    partition_metrics = {0: {"predicted_load": 900000, "consumer_lag": 10000, "processing_latency": 50},
                         1: {"predicted_load": 20000, "consumer_lag": 100, "processing_latency": 10},
                         2: {"predicted_load": 15000, "consumer_lag": 50, "processing_latency": 8},
                         3: {"predicted_load": 25000, "consumer_lag": 80, "processing_latency": 12}}
    actions, pps, stddev = ppea.decide(partition_metrics)
    print("Actions:", actions)

if __name__ == '__main__':
    run_synthetic_scenario()
