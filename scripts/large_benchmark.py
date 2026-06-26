"""Run the SEDP large-scale benchmark (>= 300k data points) and persist results.

Usage:
    python scripts/large_benchmark.py [n_points] [seed]

Writes benchmarks/large_scale_benchmark.json, which the evaluation dashboard
(📦 Large-Scale Benchmark tab) loads to show the system was tested at scale.
"""
import os
import sys
import json

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.sedp.evaluation import large_scale_benchmark

N = int(sys.argv[1]) if len(sys.argv) > 1 else 320_000
SEED = int(sys.argv[2]) if len(sys.argv) > 2 else 7


def _cli_progress(frac, msg):
    bar = "#" * int(frac * 30)
    sys.stdout.write(f"\r[{bar:<30}] {frac*100:5.1f}%  {msg:<45}")
    sys.stdout.flush()


def main():
    print(f"SEDP large-scale benchmark: target {N:,} points (seed {SEED})\n")
    res = large_scale_benchmark(n_points=N, seed=SEED, progress=_cli_progress)
    print("\n")

    out_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "benchmarks")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "large_scale_benchmark.json")
    with open(out_path, "w") as f:
        json.dump(res, f, indent=2)

    print(f"Tested on {res['data_points']:,} data points  "
          f"({res['partitions']} partitions x {res['cycles_per_partition']:,} cycles)")
    print(f"Python {res['environment']['python']} on {res['environment']['platform']}\n")
    print(f"{'algorithm':<26}{'throughput (pts/s)':>20}{'time(s)':>10}{'R2':>9}{'skill%':>9}")
    for r in sorted(res["results"], key=lambda x: x["throughput_pts_per_s"], reverse=True):
        print(f"{r['label']:<26}{r['throughput_pts_per_s']:>20,}{r['time_s']:>10}"
              f"{r['R2']:>9.4f}{r['skill']:>9.1f}")
    print(f"\nMost accurate (R2): {res['best_by_r2']}")
    print(f"PPEA decisions at scale: {res['ppea_decisions']}")
    print(f"\nSaved -> {out_path}")


if __name__ == "__main__":
    main()
