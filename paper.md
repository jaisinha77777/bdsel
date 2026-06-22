# Self-Evolving Data Partitioning (SEDP)

## Abstract
SEDP introduces a Predictive Partition Evolution Algorithm (PPEA) that predicts partition overload using EWMA + linear trend extrapolation and evolves partition topology proactively to mitigate skew in distributed stream processing.

## Problem Statement
Data skew and partition imbalance cause consumer lag, reduced throughput, and resource underutilization. Existing systems react after degradation. We propose a prediction-first continuous evolution approach.

## System Architecture
Incoming Stream (Kafka) → Load Monitor → Predictive Load Estimator → PPEA → Evolution Engine → Split/Merge/Reassign → Updated Topology → Feedback Controller → Load Monitor (loop).

## PPEA Algorithm
Compute Partition Pressure Score (PPS):

PPS(p) = w1 × Predicted_Load(p) + w2 × Consumer_Lag(p) + w3 × Processing_Latency(p)

Weights are normalized and adapt via feedback: if an action fails to reduce lag by at least 10% over 3 cycles, increase the weight of the metric that best predicted the failure.

## Experimental Setup
Docker Compose with Kafka, Zookeeper, Spark, API, and Streamlit. Synthetic producer injects skewed workloads. Baseline: static 4-partition round-robin.

## Results
Placeholders — run evaluation scripts to collect CSV logs for detailed charts.

## Novelty
Prediction-first split/merge/reassign with continuous topology evolution and adaptive weight tuning.

## Future Work
Full Kafka reassignments, integration tests with Spark Structured Streaming listeners, and extending predictors (ARIMA, LSTM).
