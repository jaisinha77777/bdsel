# SEDP — Self-Evolving Data Partitioning

This repository implements SEDP, a predictive partition evolution system for distributed stream processing. It contains the Predictive Partition Evolution Algorithm (PPEA), synthetic workload generator, a Streamlit dashboard, and integration hooks for Kafka and Spark.

See `paper.md` for research writeup and `docker-compose.yml` to run the local environment.

Quick start (requires Docker):

1. Build and start services:

```bash
docker-compose up --build
```

2. Install Python deps (for local scripts):

```bash
pip install -r requirements.txt
```

3. Run evaluation script:

```bash
python scripts/evaluate.py
```
